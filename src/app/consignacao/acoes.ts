/**
 * Ações da tela de consignação.
 *
 * Duas: cadastrar item em consignação e registrar conferência. As duas validam com
 * Zod, porque formulário é fronteira externa (convenções, seção 4).
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está
 * dentro de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeConsignacao } from '@/dominio/consignacao/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { lerReaisDigitados } from '@/lib/dinheiro';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_de_consignacao' },
});

function paraOnde(codigo: CodigoDeAviso): string {
  return `${CAMINHO}?r=${codigo}`;
}

/** Inteiro não negativo vindo de `<input type="number">`, que chega como texto. */
const quantidade = z.coerce.number().int().nonnegative();

/**
 * Preço em reais, do jeito que a pessoa digita: `40`, `40,50` ou `40.50`.
 *
 * Entrega **texto** para `reaisParaCentavos`, que já aceita vírgula e recusa mais de
 * duas casas em vez de arredondar. Passar por `Number` antes seria uma volta pelo
 * ponto flutuante sem ganho nenhum — e é exatamente o caminho que aquela função
 * existe para evitar.
 *
 * Vazio é `null` e não zero: repasse não combinado é diferente de repasse de graça, e
 * é essa diferença que o fechamento usa para não pagar errado.
 */
const precoEmReais = z
  .string()
  .trim()
  .refine((v) => v === '' || lerReaisDigitados(v) !== null, {
    message: 'use um valor como 40 ou 40,50',
  });

const esquemaDeCadastro = z.object({
  parceiroNome: z.string().trim().min(1),
  parceiroContato: z.string().trim(),
  skuId: z.string().trim().uuid(),
  qtdDisponivel: quantidade,
  precoAcordadoRepasse: precoEmReais,
});

const esquemaDeConferencia = z.object({
  consignacaoId: z.string().trim().uuid(),
  qtdContada: quantidade,
});

export async function cadastrarConsignacao(dados: FormData): Promise<void> {
  const lido = esquemaDeCadastro.safeParse({
    parceiroNome: dados.get('parceiroNome') ?? '',
    parceiroContato: dados.get('parceiroContato') ?? '',
    skuId: dados.get('skuId') ?? '',
    qtdDisponivel: dados.get('qtdDisponivel') ?? '',
    precoAcordadoRepasse: dados.get('precoAcordadoRepasse') ?? '',
  });

  if (!lido.success) {
    log.aviso('consignacao.cadastro_invalido', { erro: lido.error.message });
    redirect(paraOnde('sem_dados'));
  }

  const entrada = lido.data;

  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    await new RepositorioDeConsignacao(db).registrar(perfil.id, {
      parceiroNome: entrada.parceiroNome,
      parceiroContato: entrada.parceiroContato === '' ? null : entrada.parceiroContato,
      skuId: entrada.skuId,
      qtdDisponivel: entrada.qtdDisponivel,
      precoAcordadoRepasse: lerReaisDigitados(entrada.precoAcordadoRepasse),
    });
  } catch (erro) {
    log.erro('consignacao.cadastro_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde('cadastrado'));
}

/**
 * Registra a conferência com a contagem do parceiro.
 *
 * A contagem é obrigatória, inclusive quando é zero: um botão "conferi" sem número
 * apagaria o alerta sem corrigir o estoque, que é o pior resultado possível aqui.
 */
export async function registrarConferencia(dados: FormData): Promise<void> {
  const lido = esquemaDeConferencia.safeParse({
    consignacaoId: dados.get('consignacaoId') ?? '',
    qtdContada: dados.get('qtdContada') ?? '',
  });

  if (!lido.success) {
    log.aviso('consignacao.conferencia_invalida', { erro: lido.error.message });
    redirect(paraOnde('sem_dados'));
  }

  let destino: CodigoDeAviso = 'conferido';

  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const gravou = await new RepositorioDeConsignacao(db).registrarConferencia(
      perfil.id,
      lido.data.consignacaoId,
      lido.data.qtdContada,
      new Date(),
    );
    if (!gravou) destino = 'nao_encontrado';
  } catch (erro) {
    log.erro('consignacao.conferencia_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(destino));
}
