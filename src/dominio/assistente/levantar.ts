/**
 * Os números que respondem uma consulta do assistente (ADR 0009).
 *
 * Aqui não há IA nem texto: só a leitura de cada métrica, com as mesmas somas da área da
 * loja e da visão geral. É por isso que o assistente não pode discordar do painel — os
 * dois leem `somarPainel` sobre `RepositorioDeLojas.somas`, e o "R$ 4.321" da resposta é
 * o mesmo do cartão.
 *
 * As leituras chegam por `FontesDoAssistente`, e não pelos repositórios direto: a tela
 * liga os repositórios com o perfil ativo (ADR 0003), e o teste liga dados fixos.
 */
import { estadoDaLoja, type EstadoDaLoja, type NumerosDaLoja } from '@/dominio/lojas/estado';
import { somarPainel, type Janela, type Painel, type SomaDaLoja } from '@/dominio/lojas/painel';
import type { MaisVendido } from '@/dominio/lojas/repositorio';
import { FUSO_PADRAO, type FilaDoDia } from '@/dominio/pedidos/fila-do-dia';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { Centavos } from '@/lib/dinheiro';
import {
  janelasDoPeriodo,
  lojasDaConsulta,
  type Consulta,
  type JanelasDoPeriodo,
} from './consulta';

/** Quantos produtos entram na lista dos mais vendidos: cinco de uma loja, três de cada. */
export const MAIS_VENDIDOS_DE_UMA = 5;
export const MAIS_VENDIDOS_DE_CADA = 3;

/** Um repasse que a loja informou diferente do que as taxas explicam, ainda não conferido. */
export interface RepasseDivergente {
  readonly idExterno: string;
  /** Negativo: a loja repassa menos do que as taxas explicam. */
  readonly divergencia: Centavos;
}

export interface FontesDoAssistente {
  numeros(): Promise<readonly NumerosDaLoja[]>;
  somas(janela: Janela): Promise<readonly SomaDaLoja[]>;
  /** `plataforma` indefinida é todas as lojas juntas. */
  maisVendidos(
    janela: Janela,
    plataforma: Plataforma | undefined,
    limite: number,
  ): Promise<readonly MaisVendido[]>;
  filaDoDia(plataforma: Plataforma): Promise<FilaDoDia>;
  repassesDivergentes(plataforma: Plataforma): Promise<readonly RepasseDivergente[]>;
}

/** Em que pé está uma loja da resposta: diz até quando os números dela vão. */
export interface FrescorDaLoja {
  readonly plataforma: Plataforma;
  readonly estado: EstadoDaLoja;
  readonly ultimoPedidoEm: Date | null;
}

export interface PainelDaLoja {
  readonly plataforma: Plataforma;
  readonly atual: Painel;
  readonly anterior: Painel;
}

/** Os mais vendidos de uma loja, ou de todas juntas (`plataforma` nula). */
export interface GrupoDeMaisVendidos {
  readonly plataforma: Plataforma | null;
  readonly produtos: readonly MaisVendido[];
}

interface Comum {
  readonly consulta: Consulta;
  /** As lojas que a resposta cobre, na ordem do domínio. */
  readonly lojas: readonly Plataforma[];
  readonly frescor: readonly FrescorDaLoja[];
}

export type Levantamento =
  | (Comum & {
      readonly tipo: 'painel';
      readonly janelas: JanelasDoPeriodo;
      readonly porLoja: readonly PainelDaLoja[];
      readonly total: Painel;
      readonly totalAnterior: Painel;
    })
  | (Comum & {
      readonly tipo: 'mais_vendidos';
      readonly janelas: JanelasDoPeriodo;
      readonly grupos: readonly GrupoDeMaisVendidos[];
    })
  | (Comum & {
      readonly tipo: 'fila';
      readonly porLoja: readonly { readonly plataforma: Plataforma; readonly fila: FilaDoDia }[];
    })
  | (Comum & {
      readonly tipo: 'repasse';
      readonly porLoja: readonly {
        readonly plataforma: Plataforma;
        readonly divergentes: readonly RepasseDivergente[];
      }[];
    });

/** As somas só das lojas dadas. */
function somasDe(somas: readonly SomaDaLoja[], lojas: readonly Plataforma[]): SomaDaLoja[] {
  return somas.filter((s) => lojas.includes(s.plataforma));
}

/**
 * Lê os números de uma consulta.
 *
 * `agora` vem de fora, lido uma vez: a janela de "hoje" e a fila do dia precisam cair no
 * mesmo dia.
 */
export async function levantar(
  consulta: Consulta,
  fontes: FontesDoAssistente,
  agora: Date,
  fuso: string = FUSO_PADRAO,
): Promise<Levantamento> {
  const lojas = lojasDaConsulta(consulta);
  const numeros = await fontes.numeros();
  const frescor = lojas.map((plataforma): FrescorDaLoja => {
    const n = numeros.find((x) => x.plataforma === plataforma) ?? {
      plataforma,
      pedidos: 0,
      ultimoPedidoEm: null,
      conectada: false,
    };
    return { plataforma, estado: estadoDaLoja(n, fuso), ultimoPedidoEm: n.ultimoPedidoEm };
  });
  const comum: Comum = { consulta, lojas, frescor };

  switch (consulta.metrica) {
    case 'postar_hoje':
      return {
        ...comum,
        tipo: 'fila',
        porLoja: await Promise.all(
          lojas.map(async (plataforma) => ({
            plataforma,
            fila: await fontes.filaDoDia(plataforma),
          })),
        ),
      };

    case 'repasse_divergente':
      return {
        ...comum,
        tipo: 'repasse',
        porLoja: await Promise.all(
          lojas.map(async (plataforma) => ({
            plataforma,
            divergentes: await fontes.repassesDivergentes(plataforma),
          })),
        ),
      };

    case 'mais_vendidos': {
      const janelas = janelasDoPeriodo(consulta.periodo, agora, fuso);
      // Todas juntas quando a pergunta é do negócio; uma lista por loja quando compara.
      if (consulta.lojas.length === 0 && !consulta.porLoja) {
        const produtos = await fontes.maisVendidos(janelas.atual, undefined, MAIS_VENDIDOS_DE_UMA);
        return {
          ...comum,
          tipo: 'mais_vendidos',
          janelas,
          grupos: [{ plataforma: null, produtos }],
        };
      }
      const limite = lojas.length === 1 ? MAIS_VENDIDOS_DE_UMA : MAIS_VENDIDOS_DE_CADA;
      return {
        ...comum,
        tipo: 'mais_vendidos',
        janelas,
        grupos: await Promise.all(
          lojas.map(async (plataforma) => ({
            plataforma,
            produtos: await fontes.maisVendidos(janelas.atual, plataforma, limite),
          })),
        ),
      };
    }

    case 'resumo':
    case 'faturamento':
    case 'pedidos':
    case 'ticket_medio':
    case 'margem': {
      const janelas = janelasDoPeriodo(consulta.periodo, agora, fuso);
      const [atuais, anteriores] = await Promise.all([
        fontes.somas(janelas.atual),
        fontes.somas(janelas.anterior),
      ]);
      return {
        ...comum,
        tipo: 'painel',
        janelas,
        porLoja: lojas.map((plataforma) => ({
          plataforma,
          atual: somarPainel(somasDe(atuais, [plataforma])),
          anterior: somarPainel(somasDe(anteriores, [plataforma])),
        })),
        total: somarPainel(somasDe(atuais, lojas)),
        totalAnterior: somarPainel(somasDe(anteriores, lojas)),
      };
    }
  }
}
