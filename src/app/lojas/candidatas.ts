/**
 * As lojas a caminho: as que o dono citou e o sistema ainda não atende (ADR 0009).
 *
 * Plataforma nova é entrega, e não chave: cada uma precisa de tabela de comissão, das
 * colunas da planilha, do limite de título e do formato do arquivo de importação — e
 * nada disso dá para inventar. A lista existe para a tela dizer isso com o nome de cada
 * loja, em vez de um botão "adicionar" que criaria uma área sem margem certa.
 *
 * Quando uma delas entrar, ela sai daqui e vai para `PLATAFORMAS`: a área dela aparece
 * na barra sem tela nova.
 */
import type { IdentidadeDaLoja } from './identidade';

export interface LojaACaminho {
  readonly id: string;
  readonly nome: string;
  readonly identidade: IdentidadeDaLoja;
}

export const LOJAS_A_CAMINHO: readonly LojaACaminho[] = [
  { id: 'shein', nome: 'Shein', identidade: { sigla: 'SH', fundo: '#111111', texto: '#ffffff' } },
  {
    id: 'aliexpress',
    nome: 'AliExpress',
    identidade: { sigla: 'AE', fundo: '#d42a04', texto: '#ffffff' },
  },
  { id: 'magalu', nome: 'Magalu', identidade: { sigla: 'MG', fundo: '#0a6fd6', texto: '#ffffff' } },
  {
    id: 'tiktok',
    nome: 'TikTok Shop',
    identidade: { sigla: 'TT', fundo: '#111111', texto: '#25f4ee' },
  },
];

/** O que uma loja nova precisa ter no sistema para entrar, na ordem em que se consegue. */
export const O_QUE_UMA_LOJA_NOVA_PRECISA: readonly string[] = [
  'as colunas da planilha de pedidos, tiradas de uma exportação de verdade do painel dela;',
  'a tabela de comissão e de taxa por item, conferida na página de tarifas dela;',
  'o limite de caracteres do título do anúncio;',
  'o formato do arquivo de importação de anúncios.',
];
