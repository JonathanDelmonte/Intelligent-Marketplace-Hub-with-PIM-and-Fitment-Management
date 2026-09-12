/**
 * A matriz de capacidades, em forma executável.
 *
 * `docs/matriz-capacidades.md` é a leitura humana deste arquivo, e as duas não
 * podem divergir — há teste que falha se divergirem.
 *
 * **Todo valor aqui começa como `presumido`.** A especificação é explícita sobre
 * isso: os valores da seção 2.2 são a expectativa, não o resultado, e o resultado
 * do teste real "é um arquivo de configuração, não uma surpresa em produção". A
 * sonda (`npm run sondar:capacidades`) é o que promove `presumido` a `disponivel`
 * ou rebaixa para `bloqueado`.
 *
 * A única exceção é `/sites/MLB/search`, que entra como `bloqueado` com data e
 * evidência, porque isso **é** fato apurado.
 */
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { CAPACIDADES, CAPACIDADE_SEMPRE_SUPORTADA } from './capacidades';
import type { Capacidade, EstadoDaCapacidade } from './capacidades';

export type MatrizDaPlataforma = Readonly<Record<Capacidade, EstadoDaCapacidade>>;
export type Matriz = Readonly<Record<Plataforma, MatrizDaPlataforma>>;

const sempreSuportada: EstadoDaCapacidade = {
  tipo: 'disponivel',
  modo: 'm1_planilha',
  rotulo: 'gera o arquivo de importação da plataforma',
};

/**
 * O 403 do endpoint de busca do Mercado Livre.
 *
 * Fato apurado, não expectativa. Nenhum módulo do sistema depende disto: a
 * medição de concorrência do prospector usa página pública e comparador, e o
 * volume do scanner vem de M0/M2. Se um dia o acesso for liberado, entra como
 * fonte adicional atrás da mesma interface — não como habilitador de
 * funcionalidade que estava esperando.
 */
const BUSCA_ML_BLOQUEADA: EstadoDaCapacidade = {
  tipo: 'bloqueado',
  desde: '2025-12',
  evidencia:
    'GET /sites/MLB/search responde 403 Forbidden com token válido, escopo e site_id corretos. ' +
    'Volume grande de reclamações formais de desenvolvedores desde dez/2025, sem resolução e ' +
    'sem critério de liberação publicado.',
};

export const MATRIZ_INICIAL: Matriz = {
  ml: {
    ler_anuncios: { tipo: 'presumido', modo: 'm3_api' },
    ler_pedidos: { tipo: 'presumido', modo: 'm3_api' },
    ler_taxas: { tipo: 'presumido', modo: 'm3_api' },
    publicar_anuncio: { tipo: 'presumido', modo: 'm3_api' },
    gerar_etiqueta: { tipo: 'presumido', modo: 'm3_api' },
    buscar_terceiros: BUSCA_ML_BLOQUEADA,
    ler_item_terceiro: { tipo: 'presumido', modo: 'm3_api' },
    responder_pergunta: { tipo: 'presumido', modo: 'm3_api' },
    exportar_para_importacao: sempreSuportada,
  },

  shopee: {
    // A Open Platform exige aprovação de partner. Até sair, tudo por M0 e M1 — e
    // isso é suficiente para o painel ser útil.
    ler_anuncios: { tipo: 'presumido', modo: 'm1_planilha' },
    ler_pedidos: { tipo: 'presumido', modo: 'm1_planilha' },
    ler_taxas: { tipo: 'presumido', modo: 'm0_link' },
    publicar_anuncio: {
      tipo: 'inexistente',
      alternativa: 'gere o arquivo de importação e suba no painel',
    },
    gerar_etiqueta: { tipo: 'inexistente', alternativa: 'gere a etiqueta no painel da Shopee' },
    buscar_terceiros: { tipo: 'presumido', modo: 'm0_link' },
    ler_item_terceiro: { tipo: 'presumido', modo: 'm0_link' },
    responder_pergunta: { tipo: 'inexistente', alternativa: 'responda no aplicativo da Shopee' },
    exportar_para_importacao: sempreSuportada,
  },

  amazon: {
    // SP-API exige plano profissional e registro de developer.
    ler_anuncios: { tipo: 'presumido', modo: 'm1_planilha' },
    ler_pedidos: { tipo: 'presumido', modo: 'm1_planilha' },
    ler_taxas: {
      tipo: 'inexistente',
      alternativa: 'a comissão por categoria vem da tabela manual de M8',
    },
    publicar_anuncio: {
      tipo: 'inexistente',
      alternativa: 'gere o arquivo de importação e suba no Seller Central',
    },
    gerar_etiqueta: { tipo: 'inexistente', alternativa: 'gere a etiqueta no Seller Central' },
    buscar_terceiros: { tipo: 'presumido', modo: 'm0_link' },
    ler_item_terceiro: { tipo: 'presumido', modo: 'm0_link' },
    responder_pergunta: { tipo: 'inexistente', alternativa: 'responda no Seller Central' },
    exportar_para_importacao: sempreSuportada,
  },
};

/**
 * Toda capacidade de toda plataforma tem estado declarado.
 *
 * Chamado pelo teste da matriz. Uma capacidade sem estado seria `undefined` no
 * lugar de um valor, e a UI trataria como indisponível em silêncio — que é pior
 * que falhar, porque não se descobre.
 */
export function capacidadesSemEstado(matriz: Matriz): readonly string[] {
  const faltando: string[] = [];
  for (const [plataforma, daPlataforma] of Object.entries(matriz)) {
    for (const capacidade of CAPACIDADES) {
      if (daPlataforma[capacidade] === undefined) {
        faltando.push(`${plataforma}.${capacidade}`);
      }
    }
  }
  return faltando;
}

/** `exportar_para_importacao` precisa estar disponível em toda plataforma. */
export function plataformasSemOPiso(matriz: Matriz): readonly string[] {
  return Object.entries(matriz)
    .filter(([, daPlataforma]) => daPlataforma[CAPACIDADE_SEMPRE_SUPORTADA].tipo !== 'disponivel')
    .map(([plataforma]) => plataforma);
}
