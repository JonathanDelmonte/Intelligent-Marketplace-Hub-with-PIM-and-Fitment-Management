/**
 * A demanda pública no garimpo (M6, ferramenta `pncp`): o Portal Nacional de
 * Contratações Públicas, pelas duas APIs abertas dele.
 *
 * Gratuito e sem chave (CLAUDE.md, 3.7). Órgão público compra refil e peça em volume, e
 * os preços são dado aberto — quase nenhum vendedor de marketplace olha para lá
 * (`hipoteses.ts`, "existe demanda pública?").
 *
 * ## Duas chamadas
 *
 * 1. `/api/search` acha os editais que citam o termo — a mesma busca do site do PNCP.
 * 2. Para cada edital, `/api/pncp/v1/orgaos/{cnpj}/compras/{ano}/{sequencial}/itens`
 *    traz os itens com descrição, quantidade e valor unitário.
 *
 * O item cujo texto casa com o termo entra na referência de preço (`pncp.ts`, que já
 * existia e fazia a conta sobre um sensor que ninguém tinha escrito).
 *
 * Os nomes de campo foram conferidos contra o código de quem já consome essas APIs
 * (o formato não pôde ser testado daqui: a rede deste ambiente recusa o pncp.gov.br).
 * A validação é Zod: formato diferente vira "indisponível" com o motivo, e não número
 * inventado.
 */
import { z } from 'zod';
import type { EstadoDaCapacidade } from '@/plataformas/capacidades';
import { ZERO, formatarBRL } from '@/lib/dinheiro';
import { contagem } from '@/lib/texto';
import type { Investigador, PedidoDeInvestigacao, RespostaDaInvestigacao } from '../motor';
import {
  medirDemandaPublica,
  type ConsultaAoPncp,
  type ItemDoPncp,
  type SensorDePncp,
} from '../pncp';
import { FalhaDeRede, lerTexto, type OpcoesDaRede } from './rede';

export const ENDERECO_DO_PNCP = 'https://pncp.gov.br';

/** Editais lidos por consulta. Cada um é uma chamada a mais: cinco dão referência. */
export const EDITAIS_POR_CONSULTA = 5;

/** Janela da busca, em dias para trás. Um ano pega o ciclo de compra de um órgão. */
export const DIAS_DA_JANELA = 365;

const esquemaDaBusca = z.object({
  items: z.array(
    z.object({
      orgao_cnpj: z.string(),
      ano: z.union([z.string(), z.number()]),
      numero_sequencial: z.union([z.string(), z.number()]),
      orgao_nome: z.string().nullable().optional(),
      data_publicacao_pncp: z.string().nullable().optional(),
    }),
  ),
});

const esquemaDosItens = z.array(
  z.object({
    descricao: z.string().nullable().optional(),
    quantidade: z.number().nullable().optional(),
    valorUnitarioEstimado: z.number().nullable().optional(),
    valorUnitarioHomologado: z.number().nullable().optional(),
  }),
);

/** `20260924`: o formato de data das duas APIs. */
function diaCompacto(data: Date): string {
  return data.toISOString().slice(0, 10).replace(/-/g, '');
}

async function lerJson(url: string, opcoes: OpcoesDaRede): Promise<unknown> {
  const resposta = await lerTexto(url, { ...opcoes, aceitar: 'application/json' });
  if (resposta.status >= 400) {
    throw new FalhaDeRede(`o PNCP respondeu ${String(resposta.status)}.`, resposta.status);
  }
  try {
    return JSON.parse(resposta.texto);
  } catch {
    throw new FalhaDeRede('o PNCP respondeu algo que não é JSON.');
  }
}

export interface OpcoesDoPncp extends OpcoesDaRede {
  readonly endereco?: string | undefined;
  readonly agora?: (() => Date) | undefined;
}

/** O sensor de verdade, que a interface de `pncp.ts` esperava desde a fase 10. */
export class SensorDePncpHttp implements SensorDePncp {
  readonly nome = 'pncp.gov.br';

  constructor(private readonly opcoes: OpcoesDoPncp = {}) {}

  /** Presumido: não há credencial a conferir, e a primeira consulta é o teste. */
  estadoDaConsulta(): EstadoDaCapacidade {
    return { tipo: 'presumido', modo: 'm2_publico' };
  }

  async consultar(consulta: ConsultaAoPncp): Promise<readonly ItemDoPncp[]> {
    const base = this.opcoes.endereco ?? ENDERECO_DO_PNCP;
    const fim = this.opcoes.agora?.() ?? new Date();
    const inicio = new Date(fim.getTime() - consulta.diasParaTras * 86_400_000);
    const parametros = new URLSearchParams({
      q: consulta.termo,
      tipos_documento: 'edital',
      data_inicial: diaCompacto(inicio),
      data_final: diaCompacto(fim),
      pagina: '1',
      tam_pagina: String(EDITAIS_POR_CONSULTA),
    });

    const busca = esquemaDaBusca.safeParse(
      await lerJson(`${base}/api/search/?${parametros.toString()}`, this.opcoes),
    );
    if (!busca.success)
      throw new FalhaDeRede('a busca do PNCP respondeu num formato que não é o esperado.');

    const itens: ItemDoPncp[] = [];
    for (const edital of busca.data.items.slice(0, EDITAIS_POR_CONSULTA)) {
      const cnpj = edital.orgao_cnpj.replace(/\D/g, '');
      const ano = String(edital.ano);
      const sequencial = String(edital.numero_sequencial);
      const lidos = esquemaDosItens.safeParse(
        await lerJson(
          `${base}/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${sequencial}/itens?pagina=1&tamanhoPagina=100`,
          this.opcoes,
        ),
      );
      if (!lidos.success) continue;

      const data = (edital.data_publicacao_pncp ?? '').slice(0, 10);
      for (const item of lidos.data) {
        // Homologado quando há — é o preço que o órgão pagou —, e estimado quando não.
        const valor = item.valorUnitarioHomologado ?? item.valorUnitarioEstimado ?? null;
        const quantidade = item.quantidade ?? null;
        const descricao = item.descricao?.trim() ?? '';
        if (valor === null || quantidade === null || quantidade <= 0 || descricao === '') continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
        itens.push({
          descricao,
          quantidade,
          valorUnitario: valor,
          orgao: edital.orgao_nome?.trim() ?? cnpj,
          data,
          urlOrigem: `${base}/app/editais/${cnpj}/${ano}/${sequencial}`,
        });
      }
    }
    return itens;
  }
}

export class InvestigadorDeDemandaPublica implements Investigador {
  readonly ferramenta = 'pncp' as const;

  constructor(
    private readonly sensor: SensorDePncp = new SensorDePncpHttp(),
    private readonly agora: () => Date = () => new Date(),
  ) {}

  async investigar(pedido: PedidoDeInvestigacao): Promise<RespostaDaInvestigacao> {
    const resultado = await medirDemandaPublica(this.sensor, {
      termo: pedido.item.alvo,
      diasParaTras: DIAS_DA_JANELA,
    });

    if (resultado.tipo === 'sem_demanda') {
      // O PNCP respondeu, e não há compra pública deste item: a hipótese cai.
      return { achados: [], custoCentavos: ZERO, descartadas: ['demanda_publica'] };
    }
    if (resultado.tipo === 'indisponivel') {
      // Não deu para olhar: o passo acontece sem achado, e a hipótese continua aberta —
      // "não consegui olhar" não é "não existe".
      return { achados: [], custoCentavos: ZERO };
    }

    const r = resultado.referencia;
    const fonte = resultado.itens[0]?.urlOrigem ?? `${ENDERECO_DO_PNCP}/app/editais`;
    return {
      achados: [
        {
          id: `demanda_publica:${pedido.item.alvo.toLowerCase()}`,
          familia: 'demanda_publica',
          oQue: `Compra pública no último ano: ${contagem(r.itens, 'item', 'itens')} em ${contagem(r.orgaos, 'órgão', 'órgãos')}, ${contagem(r.unidades, 'unidade', 'unidades')}. Valor unitário mediano de ${formatarBRL(r.medianaUnitario)} (de ${formatarBRL(r.menorUnitario)} a ${formatarBRL(r.maiorUnitario)}).`,
          origemUrl: fonte,
          achadoEm: this.agora().toISOString(),
        },
      ],
      custoCentavos: ZERO,
      confirmadas: ['demanda_publica'],
    };
  }
}
