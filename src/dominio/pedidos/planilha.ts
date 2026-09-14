/**
 * Leitura de planilha de vendas (M10 — 8.6).
 *
 * O importador da fase 3 já lê planilha e casa nomes de coluna por sinônimo; o
 * mapeamento já conhece as colunas de pedido — data, comissão, taxa fixa, frete,
 * repasse, comprador, rastreio. O que faltava era **decidir se a planilha é de
 * anúncio ou de venda**, e converter a linha num pedido.
 *
 * ## Como se distingue, e por que não pelo nome do arquivo
 *
 * Pelo conteúdo: planilha de venda traz **data da venda** e alguma coluna de
 * dinheiro que só existe depois de vender — repasse, comissão, comprador. Planilha
 * de anúncio traz estoque e status. Nome de arquivo não serve porque o painel de
 * cada plataforma nomeia como quer, e o dono renomeia — e um arquivo classificado
 * errado grava venda como anúncio, ou pior, anúncio como venda com receita
 * inventada.
 *
 * A decisão é explícita e tem `indefinido`: melhor mandar para revisão do que
 * chutar entre duas coisas que gravam em tabelas diferentes.
 *
 * ## Data sem hora vira o começo do dia, no fuso do vendedor
 *
 * Planilha brasileira traz `14/09/2026` sem hora. Interpretar como meia-noite UTC
 * jogaria a venda para o dia anterior às 21h de Brasília — e a fila do dia, que é
 * ordenada por prazo, começaria errada. Ver `fila-do-dia.ts`, onde a mesma
 * cuidado aparece do outro lado.
 */
import type { Campo } from '@/dominio/ingestao/planilha/mapeamento';
import { FUSO_PADRAO } from './fila-do-dia';

/** Colunas que só existem em planilha de venda. */
const SINAIS_DE_VENDA: readonly Campo[] = [
  'repasse_liquido',
  'comissao',
  'comprador',
  'rastreio',
  'taxa_fixa',
];

/** Colunas que só existem em planilha de anúncio. */
const SINAIS_DE_ANUNCIO: readonly Campo[] = ['quantidade', 'status', 'tipo_anuncio'];

export const TIPOS_DE_PLANILHA = ['pedidos', 'anuncios', 'indefinido'] as const;
export type TipoDePlanilha = (typeof TIPOS_DE_PLANILHA)[number];

export interface Classificacao {
  readonly tipo: TipoDePlanilha;
  readonly motivo: string;
}

/**
 * Classifica a planilha pelos campos que o mapeador reconheceu.
 *
 * `data` sozinha não decide: planilha de anúncio às vezes traz data de criação. O
 * que decide é **data mais um sinal de venda**, ou sinal de venda em quantidade
 * suficiente para não haver dúvida.
 */
export function classificarPlanilha(campos: readonly Campo[]): Classificacao {
  const presentes = new Set(campos);
  const sinaisDeVenda = SINAIS_DE_VENDA.filter((c) => presentes.has(c));
  const sinaisDeAnuncio = SINAIS_DE_ANUNCIO.filter((c) => presentes.has(c));
  const temData = presentes.has('data');

  if (sinaisDeVenda.length >= 2 || (temData && sinaisDeVenda.length >= 1)) {
    return {
      tipo: 'pedidos',
      motivo: `colunas de venda reconhecidas: ${sinaisDeVenda.join(', ')}${temData ? ' e data' : ''}`,
    };
  }
  if (sinaisDeAnuncio.length >= 1 && sinaisDeVenda.length === 0) {
    return {
      tipo: 'anuncios',
      motivo: `colunas de anúncio reconhecidas: ${sinaisDeAnuncio.join(', ')}`,
    };
  }
  return {
    tipo: 'indefinido',
    motivo:
      'sem coluna que distinga venda de anúncio. Planilha de venda tem data e repasse ou comissão; de anúncio, estoque ou status.',
  };
}

/**
 * Interpreta data de planilha brasileira.
 *
 * Aceita `dd/mm/aaaa`, `aaaa-mm-dd` e as duas com hora. Sem hora, o instante é o
 * começo do dia **no fuso do vendedor**, e não meia-noite UTC — que jogaria a
 * venda para o dia anterior às 21h de Brasília.
 *
 * Devolve `null` para o que não se entende, em vez de `new Date('lixo')`, que
 * produz `Invalid Date` e contamina tudo depois sem erro nenhum.
 */
export function interpretarData(bruto: string | undefined, fuso = FUSO_PADRAO): Date | null {
  if (bruto === undefined) return null;
  const texto = bruto.trim();
  if (texto === '') return null;

  const brasileira = /^(\d{2})\/(\d{2})\/(\d{4})(?:[\s,T]+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    texto,
  );
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[\sT]+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(texto);

  let ano: string;
  let mes: string;
  let dia: string;
  let hora: string;
  let minuto: string;
  let segundo: string;

  if (brasileira !== null) {
    [, dia = '', mes = '', ano = '', hora = '00', minuto = '00', segundo = '00'] = brasileira;
  } else if (iso !== null) {
    [, ano = '', mes = '', dia = '', hora = '00', minuto = '00', segundo = '00'] = iso;
  } else {
    return null;
  }

  const deslocamento = deslocamentoDoFuso(Number(ano), Number(mes), Number(dia), fuso);
  const instante = Date.parse(
    `${ano}-${mes}-${dia}T${hora.padStart(2, '0')}:${minuto.padStart(2, '0')}:${segundo.padStart(2, '0')}${deslocamento}`,
  );
  return Number.isNaN(instante) ? null : new Date(instante);
}

/**
 * Deslocamento do fuso naquela data, como `-03:00`.
 *
 * Calculado a partir do próprio `Intl` em vez de escrito à mão porque horário de
 * verão existe: o Brasil não tem hoje, e já teve — uma constante `-03:00` estaria
 * errada em dado histórico de 2017.
 */
function deslocamentoDoFuso(ano: number, mes: number, dia: number, fuso: string): string {
  const meioDiaUtc = Date.UTC(ano, mes - 1, dia, 12, 0, 0);
  const formatador = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    timeZoneName: 'longOffset',
  });
  const parte = formatador
    .formatToParts(new Date(meioDiaUtc))
    .find((p) => p.type === 'timeZoneName');
  const bruto = parte?.value ?? 'GMT+00:00';
  const casado = /GMT([+-]\d{2}:\d{2})/.exec(bruto);
  return casado?.[1] ?? '+00:00';
}
