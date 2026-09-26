/**
 * Ações de acesso (ADR 0011): entrar, criar conta, trocar a senha esquecida, sair.
 *
 * As três primeiras recebem o estado anterior (`useActionState`) e devolvem o próximo,
 * com o erro em palavras. Formulário é fronteira externa, então tudo passa por Zod
 * (convenções, seção 4). E `redirect()` sinaliza por exceção: nenhum fica dentro de `try`.
 *
 * ## O que a tela de entrar não conta
 *
 * "E-mail ou senha não conferem", sempre a mesma frase, e a senha é conferida mesmo
 * quando o e-mail não tem conta — contra um hash de mentira, com o mesmo custo. Sem isso,
 * a resposta mais rápida diria a quem testa e-mails quais existem.
 */
'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { codigoConfere, modoDoCadastro } from '@/dominio/acesso/codigo';
import { normalizarEmail, RepositorioDeAcesso } from '@/dominio/acesso/repositorio';
import {
  conferirSenha,
  criarHashDeSenha,
  problemasDaSenhaNova,
  TAMANHO_MAXIMO_DA_SENHA,
} from '@/dominio/acesso/senha';
import { LimiteDeTentativas } from '@/dominio/acesso/tentativas';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { enderecoDeQuemPede, lerDestino } from './caminhos';
import { CAMINHO_DE_ENTRAR } from './constantes';
import type { EstadoDoFormulario } from './estado';
import { abrirSessao, encerrarSessaoAtual } from './sessao';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'acesso' },
});

/** Um limite por processo: o sistema roda num processo só por servidor (ADR 0010). */
const limite = new LimiteDeTentativas();

/**
 * Hash de uma senha que ninguém sabe, calculado uma vez, com o custo de verdade. É contra
 * ele que se confere quando o e-mail não tem conta.
 */
let hashDeMentira: Promise<string> | null = null;
function hashParaComparar(): Promise<string> {
  hashDeMentira ??= criarHashDeSenha(crypto.randomUUID());
  return hashDeMentira;
}

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor : '';
}

/** "às 14:32": quando o bloqueio acaba, no fuso de quem vende. */
function horaDeVolta(ate: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ate);
}

function bloqueado(ate: Date, estado: Omit<EstadoDoFormulario, 'erro'>): EstadoDoFormulario {
  return {
    ...estado,
    erro: `Tentativas demais. Por segurança, espere até as ${horaDeVolta(ate)} para tentar de novo.`,
  };
}

// ─── Entrar ──────────────────────────────────────────────────────────────────

export async function entrar(
  _anterior: EstadoDoFormulario,
  dados: FormData,
): Promise<EstadoDoFormulario> {
  const email = texto(dados.get('email')).trim();
  const senha = texto(dados.get('senha')).slice(0, TAMANHO_MAXIMO_DA_SENHA * 2);
  const destino = lerDestino(dados.get('volta'));
  const agora = new Date();
  const ip = enderecoDeQuemPede((await headers()).get('x-forwarded-for'));
  const chaves = [`entrar-email:${normalizarEmail(email)}`, `entrar-ip:${ip}`];
  const manter = { email, nome: '' };

  const ate = limite.bloqueadoAte(chaves, agora);
  if (ate !== null) return bloqueado(ate, manter);

  const repo = new RepositorioDeAcesso(banco());
  const conta = email === '' ? null : await repo.paraEntrar(email);
  const confere = await conferirSenha(senha, conta?.senhaHash ?? (await hashParaComparar()));
  if (conta === null || !confere) {
    limite.registrarFalha(chaves, agora);
    log.aviso('acesso.entrada_recusada', { ip });
    return { ...manter, erro: 'E-mail ou senha não conferem.' };
  }

  limite.limpar(chaves[0] ?? '');
  await abrirSessao({ id: conta.id, nome: conta.nome, email: conta.email }, agora);
  log.info('acesso.entrou', { conta: conta.id });
  redirect(destino);
}

// ─── Criar conta ─────────────────────────────────────────────────────────────

/** Sem código e com a primeira conta já criada (ADR 0014). */
const CADASTRO_FECHADO =
  'O cadastro está fechado: a primeira conta já foi criada. Para abrir para mais gente, ' +
  'configure o código de cadastro (CADASTRO_CODIGO).';

const esquemaDoCadastro = z.object({
  nome: z.string().trim().min(2, 'diga o seu nome').max(80, 'o nome pode ter até 80 letras'),
  email: z.email('o e-mail não parece um e-mail').max(200),
  senha: z.string(),
  confirmacao: z.string(),
  codigo: z.string().trim(),
});

/** A mensagem de um formulário recusado: a primeira falha, que é a que se corrige primeiro. */
function primeiroProblema(problemas: readonly string[]): string {
  const primeiro = problemas[0] ?? 'confira os campos';
  return `${primeiro.charAt(0).toUpperCase()}${primeiro.slice(1)}.`;
}

export async function cadastrar(
  _anterior: EstadoDoFormulario,
  dados: FormData,
): Promise<EstadoDoFormulario> {
  const lido = esquemaDoCadastro.safeParse({
    nome: texto(dados.get('nome')),
    email: texto(dados.get('email')).trim(),
    senha: texto(dados.get('senha')),
    confirmacao: texto(dados.get('confirmacao')),
    codigo: texto(dados.get('codigo')),
  });
  const manter = { email: texto(dados.get('email')).trim(), nome: texto(dados.get('nome')).trim() };
  if (!lido.success) {
    return { ...manter, erro: primeiroProblema(lido.error.issues.map((i) => i.message)) };
  }
  const { nome, email, senha, confirmacao, codigo } = lido.data;

  const problemas = [
    ...problemasDaSenhaNova(senha, email),
    ...(senha === confirmacao ? [] : ['a confirmação não é igual à senha']),
  ];
  if (problemas.length > 0) return { ...manter, erro: primeiroProblema(problemas) };

  const configurado = lerAmbiente().CADASTRO_CODIGO;
  const repo = new RepositorioDeAcesso(banco());
  const agora = new Date();
  const modo = modoDoCadastro(configurado, await repo.quantasContas());

  if (modo === 'fechado') return { ...manter, erro: CADASTRO_FECHADO };

  // Sem código, a primeira conta entra direto (ADR 0014). A contagem acima só escolhe a
  // tela; quem garante que é mesmo a primeira é a trava dentro do repositório.
  if (modo === 'primeira_conta') {
    const primeira = await repo.criarPrimeiraConta({
      nome,
      email,
      senhaHash: await criarHashDeSenha(senha),
    });
    if (primeira.tipo === 'ja_ha_conta') return { ...manter, erro: CADASTRO_FECHADO };
    await abrirSessao(primeira.usuario, agora);
    log.info('acesso.primeira_conta_criada', { conta: primeira.usuario.id });
    redirect('/');
  }

  // O código é o que protege o cadastro, então as tentativas dele também têm limite.
  const ip = enderecoDeQuemPede((await headers()).get('x-forwarded-for'));
  const chaves = [`codigo-ip:${ip}`];
  const ate = limite.bloqueadoAte(chaves, agora);
  if (ate !== null) return bloqueado(ate, manter);
  if (!codigoConfere(codigo, configurado)) {
    limite.registrarFalha(chaves, agora);
    return { ...manter, erro: 'O código de cadastro não confere.' };
  }

  const resultado = await repo.criarUsuario({
    nome,
    email,
    senhaHash: await criarHashDeSenha(senha),
  });
  if (resultado.tipo === 'email_em_uso') {
    return {
      ...manter,
      erro: 'Já existe uma conta com este e-mail. Entre com ela, ou troque a senha esquecida.',
    };
  }

  await abrirSessao(resultado.usuario, agora);
  log.info('acesso.conta_criada', { conta: resultado.usuario.id });
  redirect('/');
}

// ─── Trocar a senha esquecida ────────────────────────────────────────────────

const esquemaDaRecuperacao = z.object({
  email: z.email('o e-mail não parece um e-mail').max(200),
  senha: z.string(),
  confirmacao: z.string(),
  codigo: z.string().trim(),
});

/**
 * Troca a senha com o código de cadastro, e encerra as outras sessões da conta.
 *
 * Sem serviço de e-mail, o código é a prova de que é você: é o mesmo segredo que abre o
 * cadastro. Com permissões e mais de uma pessoa, isso muda — quem tem o código trocaria
 * a senha de qualquer conta —, e a troca passa a ser por e-mail (ADR 0011).
 */
export async function recuperar(
  _anterior: EstadoDoFormulario,
  dados: FormData,
): Promise<EstadoDoFormulario> {
  const lido = esquemaDaRecuperacao.safeParse({
    email: texto(dados.get('email')).trim(),
    senha: texto(dados.get('senha')),
    confirmacao: texto(dados.get('confirmacao')),
    codigo: texto(dados.get('codigo')),
  });
  const manter = { email: texto(dados.get('email')).trim(), nome: '' };
  if (!lido.success) {
    return { ...manter, erro: primeiroProblema(lido.error.issues.map((i) => i.message)) };
  }
  const { email, senha, confirmacao, codigo } = lido.data;

  const problemas = [
    ...problemasDaSenhaNova(senha, email),
    ...(senha === confirmacao ? [] : ['a confirmação não é igual à senha']),
  ];
  if (problemas.length > 0) return { ...manter, erro: primeiroProblema(problemas) };

  const configurado = lerAmbiente().CADASTRO_CODIGO;
  if (configurado === undefined) {
    return {
      ...manter,
      erro: 'A troca de senha está fechada: falta configurar o código de cadastro deste sistema.',
    };
  }

  const agora = new Date();
  const ip = enderecoDeQuemPede((await headers()).get('x-forwarded-for'));
  const chaves = [`codigo-ip:${ip}`];
  const ate = limite.bloqueadoAte(chaves, agora);
  if (ate !== null) return bloqueado(ate, manter);
  if (!codigoConfere(codigo, configurado)) {
    limite.registrarFalha(chaves, agora);
    return { ...manter, erro: 'O código de cadastro não confere.' };
  }

  const conta = await new RepositorioDeAcesso(banco()).trocarSenha(
    email,
    await criarHashDeSenha(senha),
    agora,
  );
  if (conta === null) return { ...manter, erro: 'Não há conta ativa com este e-mail.' };

  await abrirSessao(conta, agora);
  log.info('acesso.senha_trocada', { conta: conta.id });
  redirect('/');
}

// ─── Sair ────────────────────────────────────────────────────────────────────

export async function sair(): Promise<void> {
  await encerrarSessaoAtual(new Date());
  redirect(CAMINHO_DE_ENTRAR);
}
