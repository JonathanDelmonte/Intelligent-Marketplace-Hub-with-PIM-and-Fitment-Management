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
import { sugerirClassificacao, type ResultadoDaSugestao } from '@/dominio/fiscal/classificador';
import { CAMPOS_FISCAIS, lerCodigoFiscal, type CampoFiscal } from '@/dominio/fiscal/codigos';
import { RepositorioFiscal, type CodigosParaGravar } from '@/dominio/fiscal/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { OrcamentoEstourado } from '@/infra/llm';
import { llmDoAmbiente } from '@/infra/llm/ambiente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import { ZERO, lerReaisDigitados } from '@/lib/dinheiro';
import type { CodigoDeAviso } from './apresentacao';
import { CAMINHO } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_fiscal' },
});

const esquemaDeId = z.string().trim().uuid();

/**
 * Para onde voltar, com o aviso — e com o foco, quando a tela estava focada num produto.
 *
 * O foco é como a ficha do catálogo abre esta tela ("Editar dados fiscais"). Perder o
 * foco depois de gravar jogaria a pessoa na lista inteira, longe do produto que ela
 * veio editar e do caminho de volta para ele.
 */
function paraOnde(codigo: CodigoDeAviso, foco?: string): string {
  const busca = new URLSearchParams({ r: codigo });
  if (foco !== undefined) busca.set('produto', foco);
  return `${CAMINHO}?${busca.toString()}`;
}

/** A falha da sugestão, com o motivo — que é a única coisa que diz o que fazer. */
function paraFalhaDeSugestao(motivo: string | undefined, foco?: string): string {
  const busca = new URLSearchParams({ r: 'sugestao_falhou' satisfies CodigoDeAviso });
  if (motivo !== undefined) busca.set('motivo', motivo);
  if (foco !== undefined) busca.set('produto', foco);
  return `${CAMINHO}?${busca.toString()}`;
}

/** O produto em foco, se o formulário veio da tela focada. Id que não é uuid é ignorado. */
function focoDo(dados: FormData): string | undefined {
  const lido = esquemaDeId.safeParse(dados.get('produto'));
  return lido.success ? lido.data : undefined;
}

function texto(valor: FormDataEntryValue | null): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * Grava os códigos de um SKU.
 *
 * Campo em branco **apaga** o código, de propósito: corrigir um NCM errado exige
 * poder tirá-lo, e a mensagem de confirmação diz isso.
 */
export async function gravarCodigos(dados: FormData): Promise<void> {
  const skuId = esquemaDeId.safeParse(dados.get('skuId'));
  if (!skuId.success) redirect(paraOnde('nao_encontrado'));
  const foco = focoDo(dados);

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
    redirect(paraOnde('formato', foco));
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
    redirect(paraOnde('falha', foco));
  }

  revalidatePath(CAMINHO);
  redirect(paraOnde(gravou ? 'gravado' : 'nao_encontrado', foco));
}

/**
 * Pede a sugestão de NCM e CEST para um item.
 *
 * **Não grava nada.** A sugestão volta pela URL e a tela a mostra nos campos, para a
 * pessoa confirmar ou descartar — é o "exige confirmação sua" da especificação, e é
 * por isso que esta ação não toca o SKU. NCM errado não dá erro na hora: dá nota
 * emitida com tributo errado, descoberta na fiscalização.
 */
export async function sugerirCodigos(dados: FormData): Promise<void> {
  const skuId = esquemaDeId.safeParse(dados.get('skuId'));
  if (!skuId.success) redirect(paraOnde('nao_encontrado'));
  const foco = focoDo(dados);

  // `null` é produto fora do perfil. O `redirect` desse caso fica **fora** do `try`: ele
  // funciona lançando, e dentro do `try` o `catch` o engolia e mandava para a falha.
  let resultado: ResultadoDaSugestao | null;
  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const produto = await new RepositorioFiscal(db).paraClassificar(perfil.id, skuId.data);
    if (produto === null) {
      resultado = null;
    } else {
      const { servico, modeloFiscal } = llmDoAmbiente(db);
      resultado = await sugerirClassificacao(produto, { llm: servico, modelo: modeloFiscal });
    }
  } catch (erro) {
    // `OrcamentoEstourado` é o único motivo daqui que vale mostrar; o resto é falha de
    // banco ou de código, e a tela não tem o que dizer sobre ela além de "não deu".
    log.erro('fiscal.sugestao_falhou', { skuId: skuId.data, erro });
    redirect(
      paraFalhaDeSugestao(
        erro instanceof OrcamentoEstourado ? 'o teto de gasto desta execução acabou.' : undefined,
        foco,
      ),
    );
  }

  if (resultado === null) redirect(paraOnde('nao_encontrado', foco));
  if (resultado.tipo === 'sem_chave') redirect(paraOnde('sem_chave', foco));
  if (resultado.tipo === 'nada_a_classificar') redirect(paraOnde('sem_texto', foco));
  if (resultado.tipo === 'falhou') {
    log.aviso('fiscal.sugestao_falhou', { skuId: skuId.data, motivo: resultado.motivo });
    redirect(paraFalhaDeSugestao(resultado.motivo, foco));
  }

  // A sugestão viaja na URL, e não em estado de servidor, pelo mesmo motivo da tela
  // de anúncio: o que a tela mostra fica reproduzível e o botão de voltar funciona.
  const busca = new URLSearchParams({ r: 'sugerido', sugerido: skuId.data });
  if (foco !== undefined) busca.set('produto', foco);
  const primeiro = resultado.candidatos[0];
  if (primeiro !== undefined) {
    busca.set('ncm', primeiro.ncm);
    if (primeiro.cest !== null) busca.set('cest', primeiro.cest);
    busca.set('porque', primeiro.justificativa);
  }

  revalidatePath(CAMINHO);
  redirect(`${CAMINHO}?${busca.toString()}`);
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
