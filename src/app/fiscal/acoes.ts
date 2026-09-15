/**
 * Ações da tela fiscal.
 *
 * Duas: gravar os códigos de um SKU e informar a receita de fora das plataformas.
 * As duas validam com Zod, porque formulário é fronteira externa (convenções,
 * seção 4) — e aqui a validação de forma é a própria entrega: dígito a menos hoje é
 * nota rejeitada em janeiro.
 *
 * `redirect()` do Next sinaliza por exceção, então nenhum `redirect` daqui está
 * dentro de `try`.
 */
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { lerAmbiente } from '@/config/ambiente';
import { CAMPOS_FISCAIS, lerCodigoFiscal, type CampoFiscal } from '@/dominio/fiscal/codigos';
import { RepositorioFiscal, type CodigosParaGravar } from '@/dominio/fiscal/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { ZERO, lerReaisDigitados } from '@/lib/dinheiro';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_fiscal' },
});

function paraOnde(codigo: CodigoDeAviso): string {
  return `${CAMINHO}?r=${codigo}`;
}

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

const esquemaDeId = z.string().trim().uuid();

/**
 * Grava os códigos de um SKU.
 *
 * Campo em branco **apaga** o código, de propósito: corrigir um NCM errado exige
 * poder tirá-lo, e a mensagem de confirmação diz isso.
 */
export async function gravarCodigos(dados: FormData): Promise<void> {
  const skuId = esquemaDeId.safeParse(dados.get('skuId'));
  if (!skuId.success) redirect(paraOnde('nao_encontrado'));

  const codigos: CodigosParaGravar = {};
  const foraDeFormato: CampoFiscal[] = [];

  for (const campo of CAMPOS_FISCAIS) {
    const bruto = texto(dados.get(campo));
    const leitura = lerCodigoFiscal(campo, bruto);
    if (!leitura.aceito) {
      foraDeFormato.push(campo);
      continue;
    }
    codigos[campo] = leitura.valor;
  }

  // Um campo fora de forma recusa o formulário inteiro, e não grava o resto: gravar
  // metade deixaria a pessoa achando que o item está pronto.
  if (foraDeFormato.length > 0) {
    log.aviso('fiscal.formato_invalido', { campos: foraDeFormato });
    redirect(paraOnde('formato'));
  }

  const regulada = texto(dados.get('categoriaRegulada'));
  codigos.categoriaRegulada = regulada === '' ? null : regulada;

  let gravou = false;
  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    gravou = await new RepositorioFiscal(db).gravarCodigos(perfil.id, skuId.data, codigos);
  } catch (erro) {
    log.erro('fiscal.gravacao_falhou', { skuId: skuId.data, erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(gravou ? 'gravado' : 'nao_encontrado'));
}

/**
 * Receita de fora das plataformas integradas.
 *
 * Existe porque o teto do MEI olha **receita bruta do regime**, e o sistema só
 * conhece o que passou pelas planilhas importadas. Sem este campo o controle de teto
 * daria folga que não existe.
 */
const esquemaDeReceita = z.object({
  ano: z.coerce.number().int().min(2020).max(2100),
  valor: z
    .string()
    .trim()
    .refine((v) => lerReaisDigitados(v) !== null, {
      message: 'use um valor como 1000 ou 1000,50',
    }),
});

export async function informarReceitaExterna(dados: FormData): Promise<void> {
  const lido = esquemaDeReceita.safeParse({
    ano: dados.get('ano') ?? '',
    valor: dados.get('valor') ?? '',
  });

  if (!lido.success) {
    log.aviso('fiscal.receita_invalida', { erro: lido.error.message });
    redirect(paraOnde('formato'));
  }

  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    // `refine` já garantiu que dá para ler; o `?? ZERO` existe porque o tipo não
    // sabe disso, e inventar um `as` para calar o compilador é o que as convenções
    // proíbem (seção 4).
    await new RepositorioFiscal(db).informarReceitaExterna(
      perfil.id,
      lido.data.ano,
      lerReaisDigitados(lido.data.valor) ?? ZERO,
    );
  } catch (erro) {
    log.erro('fiscal.receita_falhou', { erro });
    redirect(paraOnde('falha'));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde('gravado'));
}
