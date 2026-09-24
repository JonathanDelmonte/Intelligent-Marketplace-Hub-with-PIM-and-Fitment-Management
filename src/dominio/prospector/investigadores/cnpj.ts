/**
 * A consulta de CNPJ do garimpo (M6, ferramenta `cnpj`), pela BrasilAPI.
 *
 * Gratuita e sem chave (CLAUDE.md, 3.7): a BrasilAPI republica o cadastro da Receita.
 * É a pergunta que elimina a maioria dos candidatos a fornecedor na primeira passada:
 * a empresa **existe**, está **ativa**, e é **atacadista** ou **fabricante** — ou é uma
 * loja de varejo com página bonita?
 *
 * ## O que vira achado
 *
 * - CNPJ ativo: razão social, desde quando, onde, e a atividade principal. Se alguma
 *   atividade é comércio atacadista, a hipótese "quem distribui" é confirmada; se é
 *   fabricação, "quem fabrica".
 * - CNPJ que não está ativo: achado também, e o mais útil de todos — fornecedor com
 *   CNPJ baixado ou inapto é descartado antes da primeira conversa.
 * - CNPJ que a Receita não conhece (404): achado, pelo mesmo motivo.
 *
 * Cota e falha do serviço viram `FalhaDeRede`: o passo não aconteceu, e o job espera.
 */
import { z } from 'zod';
import { formatarDocumento, lerDocumento } from '@/dominio/documento';
import { ZERO } from '@/lib/dinheiro';
import type { Achado } from '../fronteira';
import type { FamiliaDeHipotese } from '../hipoteses';
import type { Investigador, PedidoDeInvestigacao, RespostaDaInvestigacao } from '../motor';
import { FalhaDeRede, lerTexto, type OpcoesDaRede } from './rede';

export const ENDERECO_DA_BRASILAPI = 'https://brasilapi.com.br/api/cnpj/v1';

/** A resposta da BrasilAPI, só no que se lê. Fronteira HTTP valida com Zod. */
const esquemaDoCadastro = z.object({
  razao_social: z.string(),
  nome_fantasia: z.string().nullable().optional(),
  descricao_situacao_cadastral: z.string().nullable().optional(),
  data_inicio_atividade: z.string().nullable().optional(),
  cnae_fiscal_descricao: z.string().nullable().optional(),
  cnaes_secundarios: z
    .array(z.object({ descricao: z.string().nullable().optional() }))
    .nullable()
    .optional(),
  municipio: z.string().nullable().optional(),
  uf: z.string().nullable().optional(),
});
export type CadastroDoCnpj = z.infer<typeof esquemaDoCadastro>;

/** `2019-03-12` → `12/03/2019`. */
function diaLegivel(dia: string): string {
  const [ano, mes, d] = dia.slice(0, 10).split('-');
  return ano === undefined || mes === undefined || d === undefined ? dia : `${d}/${mes}/${ano}`;
}

/** As atividades do cadastro, principal primeiro. */
function atividades(cadastro: CadastroDoCnpj): readonly string[] {
  return [
    cadastro.cnae_fiscal_descricao ?? '',
    ...(cadastro.cnaes_secundarios ?? []).map((c) => c.descricao ?? ''),
  ].filter((a) => a.trim() !== '');
}

/** O que o cadastro diz, em uma frase, e quais hipóteses ele fecha. */
export function lerCadastro(
  cnpj: string,
  cadastro: CadastroDoCnpj,
): { readonly frase: string; readonly confirma: readonly FamiliaDeHipotese[] } {
  const nome =
    cadastro.nome_fantasia === null ||
    cadastro.nome_fantasia === undefined ||
    cadastro.nome_fantasia.trim() === ''
      ? cadastro.razao_social
      : `${cadastro.razao_social} (${cadastro.nome_fantasia})`;
  const documento = formatarDocumento({ tipo: 'cnpj', valor: cnpj });
  const situacao = (cadastro.descricao_situacao_cadastral ?? '').trim().toUpperCase();
  const lugar =
    cadastro.municipio === null || cadastro.municipio === undefined
      ? ''
      : `, ${cadastro.municipio}${cadastro.uf === null || cadastro.uf === undefined ? '' : `/${cadastro.uf}`}`;

  if (situacao !== '' && situacao !== 'ATIVA') {
    return {
      frase: `${nome}, CNPJ ${documento}: situação ${situacao.toLowerCase()} na Receita. Fornecedor com CNPJ fora de atividade fica de fora.`,
      confirma: [],
    };
  }

  const todas = atividades(cadastro);
  const atacadista = todas.some((a) => /atacadist/i.test(a));
  const fabricante = todas.some((a) => /fabrica[cç][aã]o/i.test(a));
  const desde =
    cadastro.data_inicio_atividade === null || cadastro.data_inicio_atividade === undefined
      ? ''
      : ` desde ${diaLegivel(cadastro.data_inicio_atividade)}`;
  const principal =
    todas[0] === undefined ? '' : ` Atividade principal: ${todas[0].toLowerCase()}.`;
  const papel = atacadista
    ? ' Tem comércio atacadista entre as atividades: é distribuidor de fato.'
    : fabricante
      ? ' Tem fabricação entre as atividades.'
      : ' Nenhuma atividade de atacado ou fabricação: provavelmente varejo.';

  return {
    frase: `${nome}, CNPJ ${documento}, ativo${desde}${lugar}.${principal}${papel}`,
    confirma: [
      ...(atacadista ? (['quem_distribui'] as const) : []),
      ...(fabricante ? (['quem_fabrica'] as const) : []),
    ],
  };
}

export interface OpcoesDaConsultaDeCnpj extends OpcoesDaRede {
  readonly endereco?: string | undefined;
  readonly agora?: (() => Date) | undefined;
}

export class InvestigadorDeCnpj implements Investigador {
  readonly ferramenta = 'cnpj' as const;

  constructor(private readonly opcoes: OpcoesDaConsultaDeCnpj = {}) {}

  async investigar(pedido: PedidoDeInvestigacao): Promise<RespostaDaInvestigacao> {
    // O item de CNPJ carrega o número; qualquer outra coisa — o alvo do dossiê, se a
    // fronteira mandar para cá — não tem o que consultar.
    const lido = lerDocumento(pedido.item.alvo);
    if (lido.tipo !== 'ok' || lido.documento.tipo !== 'cnpj') {
      return { achados: [], custoCentavos: ZERO };
    }
    const cnpj = lido.documento.valor;
    const endereco = `${this.opcoes.endereco ?? ENDERECO_DA_BRASILAPI}/${cnpj}`;

    const resposta = await lerTexto(endereco, { ...this.opcoes, aceitar: 'application/json' });
    const agora = (this.opcoes.agora?.() ?? new Date()).toISOString();

    if (resposta.status === 404) {
      const achado: Achado = {
        id: `cnpj:${cnpj}`,
        familia: pedido.item.familia,
        oQue: `O CNPJ ${formatarDocumento(lido.documento)} não consta no cadastro da Receita. Quem o apresenta não é fornecedor.`,
        origemUrl: endereco,
        achadoEm: agora,
      };
      return { achados: [achado], custoCentavos: ZERO };
    }
    if (resposta.status >= 400) {
      throw new FalhaDeRede(
        `a consulta de CNPJ respondeu ${String(resposta.status)}. O garimpo tenta de novo mais tarde.`,
        resposta.status,
      );
    }

    let bruto: unknown;
    try {
      bruto = JSON.parse(resposta.texto);
    } catch {
      throw new FalhaDeRede('a consulta de CNPJ respondeu algo que não é JSON.');
    }
    const cadastro = esquemaDoCadastro.safeParse(bruto);
    if (!cadastro.success) {
      throw new FalhaDeRede('a consulta de CNPJ respondeu num formato que não é o esperado.');
    }

    const { frase, confirma } = lerCadastro(cnpj, cadastro.data);
    return {
      achados: [
        {
          id: `cnpj:${cnpj}`,
          familia: confirma[0] ?? pedido.item.familia,
          oQue: frase,
          origemUrl: endereco,
          achadoEm: agora,
        },
      ],
      custoCentavos: ZERO,
      ...(confirma.length === 0 ? {} : { confirmadas: [...confirma] }),
    };
  }
}
