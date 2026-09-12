/**
 * Identidade visual e textual, resolvida em runtime.
 *
 * **Nenhum componente do sistema escreve o nome do sistema, do construtor ou do
 * vendedor como string literal.** Tudo passa por aqui. Ver ADR 0003 e a seção
 * 1.2 da especificação: o dia em que houver um segundo perfil — ou um segundo
 * cliente — deve ser um `INSERT`, não um branch.
 *
 * Três coisas diferentes, que costumam ser confundidas e que este módulo mantém
 * separadas:
 *
 * - **Quem constrói:** a empresa de tecnologia.
 * - **O sistema:** o nome do software.
 * - **Quem opera dentro dele:** o perfil de vendedor, que é dado em
 *   `perfil_vendedor` e pode ser vários.
 */
import { z } from 'zod';
import type { Ambiente, Papel } from './ambiente';

/**
 * Identidade visual do perfil. Vem de `perfil_vendedor.marca_visual` (jsonb),
 * não de CSS compilado — um segundo perfil tem outra cor sem rebuild.
 */
export const esquemaMarcaVisual = z.object({
  corPrimaria: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'cor precisa ser hex de 6 dígitos')
    .default('#1d4ed8'),
  corAcento: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#0f766e'),
  logoUrl: z.string().url().nullable().default(null),
  /** Nome curto do perfil, como aparece no cabeçalho. */
  nomeExibicao: z.string().min(1),
});

export type MarcaVisual = z.infer<typeof esquemaMarcaVisual>;

/** Identidade completa, pronta para a UI consumir. */
export interface Marca {
  /** Nome do sistema. Codinome de projeto, não marca registrada. */
  readonly nomeSistema: string;
  /** Empresa que constrói. */
  readonly construtor: string;
  /** Papel do construtor nesta instalação, que decide onde o nome aparece. */
  readonly papel: Papel;
  /** Linha de copyright pronta. */
  readonly copyright: string;
  /** Valor do `<meta name="author">`. */
  readonly metaAutor: string;
  /**
   * Crédito de rodapé, ou `null` quando não há leitor externo.
   *
   * A lógica dos três casos da seção 1.2:
   * - `interno`: o construtor é dono, não fornecedor. Não há cliente para quem
   *   assinar, e por isso não há crédito — só o copyright.
   * - `cliente`: "desenvolvido por" no rodapé é o padrão, e funciona como
   *   captação, porque quem vê a ferramenta pergunta quem fez.
   * - `produto`: o nome do produto domina a interface; o do construtor aparece
   *   no rodapé, na página "sobre", nos termos e na nota fiscal.
   */
  readonly creditoRodape: string | null;
  /** Identidade visual do perfil ativo, quando há perfil carregado. */
  readonly visual: MarcaVisual | null;
}

/**
 * Monta a marca a partir do ambiente e, quando houver, do perfil ativo.
 *
 * Função pura: recebe o ambiente já validado em vez de ler `process.env`, o que
 * a torna testável e utilizável tanto em Server Component quanto em script.
 */
export function montarMarca(ambiente: Ambiente, visual: MarcaVisual | null = null): Marca {
  const nomeSistema = ambiente.BANCADA_NOME_SISTEMA;
  const construtor = ambiente.BANCADA_CONSTRUTOR;
  const papel = ambiente.BANCADA_PAPEL;
  const ano = ambiente.BANCADA_ANO_COPYRIGHT;

  return {
    nomeSistema,
    construtor,
    papel,
    copyright: `© ${String(ano)} ${construtor}`,
    metaAutor: construtor,
    creditoRodape: creditoPara(papel, construtor),
    visual,
  };
}

function creditoPara(papel: Papel, construtor: string): string | null {
  switch (papel) {
    case 'interno':
      return null;
    case 'cliente':
      return `desenvolvido por ${construtor}`;
    case 'produto':
      return `um produto ${construtor}`;
  }
}

/** Variáveis CSS do tema do perfil, para injetar no `<html style>`. */
export function variaveisCssDaMarca(visual: MarcaVisual | null): Record<string, string> {
  if (visual === null) return {};
  return {
    '--cor-primaria': visual.corPrimaria,
    '--cor-acento': visual.corAcento,
  };
}
