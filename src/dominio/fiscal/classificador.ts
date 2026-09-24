/**
 * Classificador de NCM e CEST (M12 — 9.1). 🧠
 *
 * A especificação é explícita sobre o que isto é e o que não é: "sugere com base na
 * descrição e nos atributos, mostra as alternativas com justificativa, e **exige
 * confirmação sua**. Não é para confiar cegamente — é para transformar uma hora de
 * pesquisa em trinta segundos de revisão."
 *
 * ## É um dos poucos lugares em que LLM se justifica
 *
 * A entrada é texto livre heterogêneo — título de anúncio, descrição de
 * distribuidor, atributo extraído — e a saída é uma classificação numa árvore de
 * milhares de códigos. Regra determinística sobre isso seria uma tabela de palavras
 * que erra em silêncio (convenções, 3.5, que nomeia M12 como caso de IA).
 *
 * ## A sugestão nunca grava
 *
 * `sugerir` devolve candidatos ordenados; quem grava é a pessoa, pela tela. Não há
 * caminho neste arquivo que escreva em `sku`, e isso é proposital: NCM errado não
 * dá erro na hora — dá nota emitida com tributo errado, descoberta na fiscalização.
 *
 * ## Sem chave, o caminho é previsto e dito
 *
 * Como em M3: `sem_chave` não é falha, é estado. A tela mostra "nenhuma sugestão
 * porque não há chave de LLM", e o campo continua preenchível à mão — nada aqui é
 * pré-requisito para o cadastro fiscal ficar pronto.
 *
 * ## Disciplina de custo (ADR 0005)
 *
 * A pergunta é o que define o cache: mesma descrição, mesma resposta, sem segunda
 * chamada. O `ServicoDeLlm` já grava entrada, saída, custo e modelo em `llm_call` e
 * respeita o teto de orçamento — aqui só se declara o propósito `fiscal`, que é a
 * chave do relatório de custo por finalidade.
 */
import { z } from 'zod';
import { OrcamentoEstourado, type Proposito, type ServicoDeLlm } from '@/infra/llm';
import { lerCodigoFiscal } from './codigos';

/** Propósito da chamada, para o cache e para o relatório de custo por finalidade. */
export const PROPOSITO_FISCAL: Proposito = 'fiscal';

/** Quantos candidatos a tela mostra. Três: o suficiente para comparar, pouco para ler. */
export const CANDIDATOS_NA_TELA = 3;

/**
 * O que o modelo deve fazer.
 *
 * Mora aqui, ao lado do schema, porque as duas coisas mudam juntas. As regras são as
 * que a revisão de trinta segundos precisa: posição da NCM citada na justificativa,
 * certeza rebaixada quando falta dado, e nada de CEST inventado — CEST existe só para
 * segmento com substituição tributária, e um CEST errado na nota é pior que nenhum.
 */
export const INSTRUCOES_FISCAIS = `Você classifica produtos para nota fiscal eletrônica no Brasil. Recebe os dados de um produto vendido em marketplace — título, tipo, marca, descrição e modelos de aparelho em que ele serve — e sugere o código NCM (8 dígitos, conforme a TIPI vigente) e, quando houver, o CEST.

Regras:
- Sugira de 1 a 3 candidatos, do mais provável ao menos provável. Mais de um só quando houver dúvida real — por exemplo, quando o texto não deixa claro se é peça ou aparelho completo.
- NCM com os 8 dígitos, sem pontos.
- CEST (7 dígitos, sem pontos) só quando o produto estiver em segmento sujeito a substituição tributária e o código corresponder a esse NCM. Caso contrário, cest = null. Não invente CEST.
- Na justificativa, diga em uma ou duas frases a posição da NCM em que o produto se encaixa e por quê — por exemplo, "parte de aparelho de uso doméstico, e não o aparelho completo".
- Use só o que os dados dizem. Não invente material, voltagem ou uso; quando faltar informação decisiva, diga na justificativa o que falta.
- Certeza: "alta" só quando o texto não deixa dúvida; "media" quando o código é o mais provável, mas depende de um detalhe não informado; "baixa" quando é palpite.`;

/**
 * Certeza declarada pelo modelo, e a confiança que cada nível vale.
 *
 * Números escolhidos e não medidos, como os de M3 — e pelo mesmo motivo: não há base
 * classificada para calibrar. Ficam nomeados aqui para o ajuste ser em um lugar.
 */
export const CONFIANCA_POR_CERTEZA: Readonly<Record<'alta' | 'media' | 'baixa', number>> = {
  alta: 9_000,
  media: 7_000,
  baixa: 5_000,
};

/**
 * O que o modelo deve devolver.
 *
 * A **justificativa é obrigatória** e tem tamanho mínimo, porque é ela que torna a
 * revisão de trinta segundos possível: "84212100" sozinho não dá para conferir, e
 * "aparelho para filtrar líquidos, posição de partes e peças" dá.
 */
export const esquemaSugestaoFiscal = z.object({
  candidatos: z
    .array(
      z.object({
        ncm: z.string().trim().min(8).max(10),
        cest: z.string().trim().min(7).max(9).nullable().default(null),
        justificativa: z.string().trim().min(20),
        certeza: z.enum(['alta', 'media', 'baixa']),
      }),
    )
    .min(1)
    .max(5),
});
export type SugestaoBruta = z.infer<typeof esquemaSugestaoFiscal>;

export interface ProdutoParaClassificar {
  readonly tituloInterno: string;
  readonly tipoProduto?: string | null;
  readonly marca?: string | null;
  readonly descricao?: string | null;
  /** Modelos de aparelho em que serve. Ajuda a distinguir peça de aparelho. */
  readonly modelosCompativeis?: readonly string[];
}

export interface Candidato {
  readonly ncm: string;
  readonly cest: string | null;
  readonly justificativa: string;
  readonly certeza: 'alta' | 'media' | 'baixa';
  readonly confiancaBp: number;
}

export type ResultadoDaSugestao =
  | {
      readonly tipo: 'sugerido';
      readonly candidatos: readonly Candidato[];
      readonly deCache: boolean;
    }
  | { readonly tipo: 'sem_chave' }
  | { readonly tipo: 'nada_a_classificar'; readonly motivo: string }
  | { readonly tipo: 'falhou'; readonly motivo: string };

/**
 * A pergunta que vai ao modelo, e **define o cache**.
 *
 * Montada em função própria e normalizada, para que duas chamadas do mesmo produto
 * gerem o mesmo hash: espaço a mais no título não pode custar uma segunda chamada.
 */
export function perguntaDeClassificacao(produto: ProdutoParaClassificar): unknown {
  const limpar = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim().replace(/\s+/g, ' ');
    return t === '' ? null : t;
  };

  return {
    titulo: limpar(produto.tituloInterno),
    tipoProduto: limpar(produto.tipoProduto),
    marca: limpar(produto.marca),
    descricao: limpar(produto.descricao),
    // Ordenado: a ordem em que os modelos foram coletados não deve mudar o hash.
    modelosCompativeis: [...(produto.modelosCompativeis ?? [])]
      .map((m) => m.trim())
      .filter((m) => m !== '')
      .sort(),
  };
}

/** Sinal suficiente para valer uma chamada? Título vazio não vale. */
export function temSinalParaClassificar(produto: ProdutoParaClassificar): boolean {
  const titulo = produto.tituloInterno.trim();
  // Três caracteres é o piso: "EF-ELX-21" classifica, "x" não — e pagar por uma
  // chamada que não tem chance de acertar é o desperdício que o ADR 0005 evita.
  return titulo.length >= 3;
}

export interface OpcoesDoClassificador {
  readonly llm?: ServicoDeLlm | undefined;
  readonly modelo?: string | undefined;
  readonly jobId?: string | undefined;
}

/**
 * Sugere NCM e CEST para um produto.
 *
 * Nunca grava, nunca lança — exceto `OrcamentoEstourado`, que é a única situação em
 * que continuar é sempre errado (um laço que a trata como "esse item falhou" segue
 * para o próximo e estoura de novo, uma vez por item).
 */
export async function sugerirClassificacao(
  produto: ProdutoParaClassificar,
  opcoes: OpcoesDoClassificador = {},
): Promise<ResultadoDaSugestao> {
  if (!temSinalParaClassificar(produto)) {
    return {
      tipo: 'nada_a_classificar',
      motivo:
        'o título é curto demais para classificar. Dê um nome ao produto antes — a sugestão sai do texto, e não há texto.',
    };
  }

  const { llm, modelo } = opcoes;
  if (llm === undefined || modelo === undefined) return { tipo: 'sem_chave' };

  let resultado;
  try {
    resultado = await llm.pedir({
      proposito: PROPOSITO_FISCAL,
      modelo,
      instrucoes: INSTRUCOES_FISCAIS,
      entrada: perguntaDeClassificacao(produto),
      esquema: esquemaSugestaoFiscal,
      ...(opcoes.jobId === undefined ? {} : { jobId: opcoes.jobId }),
    });
  } catch (erro) {
    // Orçamento sobe; o resto é tratado como valor.
    if (erro instanceof OrcamentoEstourado) throw erro;
    return { tipo: 'falhou', motivo: erro instanceof Error ? erro.message : String(erro) };
  }

  switch (resultado.tipo) {
    case 'sem_chave':
      return { tipo: 'sem_chave' };
    case 'erro':
      return { tipo: 'falhou', motivo: resultado.mensagem };
    case 'pendente_revisao':
      return {
        tipo: 'falhou',
        motivo: `resposta fora do formato esperado: ${resultado.problemas.join('; ')}`,
      };
    case 'ok':
      return {
        tipo: 'sugerido',
        candidatos: ordenarCandidatos(resultado.valor),
        deCache: resultado.deCache,
      };
  }
}

/**
 * Limpa e ordena os candidatos.
 *
 * Duas coisas acontecem aqui, e as duas existem porque o modelo erra de formas
 * conhecidas. Códigos são passados por `lerCodigoFiscal`, que tira ponto e recusa
 * forma errada — candidato com NCM de sete dígitos é descartado em vez de oferecido,
 * porque oferecer um código que a nota vai recusar é pior que oferecer menos.
 *
 * E a ordem é por certeza declarada, cortada em `CANDIDATOS_NA_TELA`: a lista existe
 * para comparar duas ou três opções, não para rolar.
 */
export function ordenarCandidatos(bruta: SugestaoBruta): readonly Candidato[] {
  const ordem = { alta: 0, media: 1, baixa: 2 } as const;

  return bruta.candidatos
    .flatMap((c): readonly Candidato[] => {
      const ncm = lerCodigoFiscal('ncm', c.ncm);
      if (!ncm.aceito || ncm.valor === null) return [];

      const cest = lerCodigoFiscal('cest', c.cest);

      return [
        {
          ncm: ncm.valor,
          // CEST fora de forma vira ausente, não descarta o candidato: o NCM é o que
          // a nota exige, e o CEST só vale em substituição tributária.
          cest: cest.aceito ? cest.valor : null,
          justificativa: c.justificativa,
          certeza: c.certeza,
          confiancaBp: CONFIANCA_POR_CERTEZA[c.certeza],
        },
      ];
    })
    .sort((a, b) => ordem[a.certeza] - ordem[b.certeza])
    .slice(0, CANDIDATOS_NA_TELA);
}
