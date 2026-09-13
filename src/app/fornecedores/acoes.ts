/**
 * Ações da tela de fornecedores.
 *
 * Duas: cadastrar e responder. Nenhuma faz trabalho de domínio — traduzem
 * formulário em chamada e voltam.
 *
 * `redirect()` do Next sinaliza por exceção (`NEXT_REDIRECT`), então **nenhum
 * `redirect` deste arquivo está dentro de `try`**.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  CANAIS,
  ORIGENS,
  RepositorioDeFornecedores,
  type RespostasInformadas,
} from '@/dominio/fornecedores/repositorio';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { reaisParaCentavos } from '@/lib/dinheiro';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_de_fornecedores' },
});

function paraOnde(codigo: CodigoDeAviso): string {
  return `${CAMINHO}?r=${codigo}`;
}

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

function ouNulo(valor: FormDataEntryValue | null): string | null {
  const t = texto(valor);
  return t === '' ? null : t;
}

/**
 * Formulário é fronteira externa, então valida — não converte de tipo.
 *
 * `as Canal` compilaria e deixaria um `canal: "qualquer coisa"` chegar ao banco,
 * onde o enum recusaria com erro de driver no meio da ação. Zod devolve `null` para
 * o que não é opção, que é o comportamento certo para um campo opcional.
 */
const esquemaCanal = z.enum(CANAIS);
const esquemaOrigem = z.enum(ORIGENS);

function opcaoValida<T extends string>(
  esquema: z.ZodType<T>,
  valor: FormDataEntryValue | null,
): T | null {
  const r = esquema.safeParse(texto(valor));
  return r.success ? r.data : null;
}

/**
 * Lê uma resposta de sim/não de três estados.
 *
 * `''` é "não mexeu" e devolve `undefined`, que o repositório entende como "deixa
 * como estava". `'nao_sei'` apaga a resposta de propósito. Sem os três estados, um
 * formulário que manda todos os campos apagaria o que não foi editado.
 */
function simNaoTalvez(valor: FormDataEntryValue | null): boolean | null | undefined {
  const t = texto(valor);
  if (t === 'sim') return true;
  if (t === 'nao') return false;
  if (t === 'nao_sei') return null;
  return undefined;
}

/** Lê um número, distinguindo "vazio" de "zero" — zero é resposta. */
function inteiroOuNada(valor: FormDataEntryValue | null): number | null | undefined {
  const t = texto(valor);
  if (t === '') return undefined;
  if (t === 'nao_sei') return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function cadastrarFornecedor(dados: FormData): Promise<void> {
  const nome = texto(dados.get('nome'));
  if (nome === '') redirect(paraOnde('sem_nome'));

  try {
    const repo = new RepositorioDeFornecedores(banco());
    await repo.criar({
      nome,
      cnpj: ouNulo(dados.get('cnpj')),
      site: ouNulo(dados.get('site')),
      contato: ouNulo(dados.get('contato')),
      canal: opcaoValida(esquemaCanal, dados.get('canal')),
      origem: opcaoValida(esquemaOrigem, dados.get('origem')),
      notas: ouNulo(dados.get('notas')),
      fonte: 'manual',
    });
  } catch (erro) {
    log.erro('fornecedor.cadastro_falhou', { nome, erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde('criado'));
}

export async function responderPerguntas(dados: FormData): Promise<void> {
  const id = texto(dados.get('id'));
  if (id === '') redirect(paraOnde('falha'));

  const vendeDireto = simNaoTalvez(dados.get('vendeDiretoMarketplace'));
  let destino: CodigoDeAviso = vendeDireto === true ? 'descartado' : 'respondido';

  const posta = simNaoTalvez(dados.get('postaComEtiqueta'));
  const nf = simNaoTalvez(dados.get('emiteNf'));
  const prazo = inteiroOuNada(dados.get('prazoPostagemDias'));
  const minimoUn = inteiroOuNada(dados.get('pedidoMinimoUn'));
  const minimoReaisBruto = texto(dados.get('pedidoMinimoReais'));

  // A espalhada condicional existe porque `exactOptionalPropertyTypes` distingue
  // "ausente" de "presente e undefined", e aqui a diferença é semântica: ausente é
  // "não mexi neste campo", e o repositório precisa disso para não apagar resposta.
  const respostas: RespostasInformadas = {
    ...(posta === undefined ? {} : { postaComEtiqueta: posta }),
    ...(nf === undefined ? {} : { emiteNf: nf }),
    ...(prazo === undefined ? {} : { prazoPostagemDias: prazo }),
    ...(minimoUn === undefined ? {} : { pedidoMinimoUn: minimoUn }),
    ...(minimoReaisBruto === ''
      ? {}
      : {
          pedidoMinimoReais: minimoReaisBruto === 'nao_sei' ? null : lerDinheiro(minimoReaisBruto),
        }),
    ...(vendeDireto === undefined ? {} : { vendeDiretoMarketplace: vendeDireto }),
  };

  try {
    const repo = new RepositorioDeFornecedores(banco());
    const atualizado = await repo.responder(id, respostas);
    if (atualizado === null) destino = 'nao_encontrado';
  } catch (erro) {
    log.erro('fornecedor.resposta_falhou', { id, erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(destino));
}

/**
 * Lê dinheiro do formulário, aceitando as duas grafias brasileiras.
 *
 * `reaisParaCentavos` lança para texto que não é valor, e aqui isso viraria falha
 * de tela em vez de campo ignorado — então o que não se entende vira `null`, que é
 * "não sei", e a pessoa vê o campo ainda em branco.
 */
function lerDinheiro(bruto: string): ReturnType<typeof reaisParaCentavos> | null {
  try {
    return reaisParaCentavos(bruto.replace(/\./g, '').replace(',', '.'));
  } catch {
    return null;
  }
}
