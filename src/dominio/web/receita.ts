/**
 * A consulta do cadastro da Receita, pela BrasilAPI.
 *
 * Gratuita e sem chave (CLAUDE.md, 3.7): a BrasilAPI republica o cadastro de CNPJ. Usam
 * o garimpo (M6), que confere o candidato a distribuidor, e a conferência de fornecedor
 * (M5), que confere quem já está cadastrado.
 */
import { z } from 'zod';
import { formatarDocumento } from '@/dominio/documento';
import { FalhaDeRede, lerTexto, type OpcoesDaRede } from '@/infra/web/rede';

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

export interface LeituraDoCadastro {
  /** O cadastro em uma frase, para o dossiê e para a tela. */
  readonly frase: string;
  readonly ativo: boolean;
  /** Alguma atividade é comércio atacadista. */
  readonly atacadista: boolean;
  /** Alguma atividade é fabricação. */
  readonly fabricante: boolean;
  /** O nome pelo qual o negócio aparece para o público: o fantasia, ou a razão social. */
  readonly nomeParaBusca: string;
}

function nomeParaBusca(cadastro: CadastroDoCnpj): string {
  const fantasia = cadastro.nome_fantasia?.trim() ?? '';
  return fantasia === '' ? cadastro.razao_social : fantasia;
}

/** O que o cadastro diz, em uma frase: se existe, se está ativo, e se é atacado ou fábrica. */
export function lerCadastro(cnpj: string, cadastro: CadastroDoCnpj): LeituraDoCadastro {
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
      ativo: false,
      atacadista: false,
      fabricante: false,
      nomeParaBusca: nomeParaBusca(cadastro),
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
    ativo: true,
    atacadista,
    fabricante,
    nomeParaBusca: nomeParaBusca(cadastro),
  };
}

export interface OpcoesDaReceita extends OpcoesDaRede {
  readonly endereco?: string | undefined;
}

export type ConsultaDeCnpj =
  | { readonly tipo: 'ok'; readonly cadastro: CadastroDoCnpj; readonly fonte: string }
  | { readonly tipo: 'inexistente'; readonly fonte: string };

/**
 * Consulta um CNPJ (só os catorze caracteres, já conferidos). `inexistente` é o 404 — a
 * Receita não conhece o número. Cota, serviço fora e formato inesperado lançam
 * `FalhaDeRede`: não é resposta sobre o CNPJ, e quem chama decide esperar.
 */
export async function consultarCnpj(
  cnpj: string,
  opcoes: OpcoesDaReceita = {},
): Promise<ConsultaDeCnpj> {
  const fonte = `${opcoes.endereco ?? ENDERECO_DA_BRASILAPI}/${cnpj}`;
  const resposta = await lerTexto(fonte, { ...opcoes, aceitar: 'application/json' });
  if (resposta.status === 404) return { tipo: 'inexistente', fonte };
  if (resposta.status >= 400) {
    throw new FalhaDeRede(
      `a consulta de CNPJ respondeu ${String(resposta.status)}. Tente de novo mais tarde.`,
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
  return { tipo: 'ok', cadastro: cadastro.data, fonte };
}

/** O CNPJ que a Receita não conhece, em uma frase. */
export function fraseDeInexistente(cnpj: string): string {
  return `O CNPJ ${formatarDocumento({ tipo: 'cnpj', valor: cnpj })} não consta no cadastro da Receita.`;
}
