/**
 * As portas do sistema, em uma lista só.
 *
 * Existia em dois lugares — a barra do `layout` e os cartões da página inicial — e
 * dois lugares divergem: a barra não tinha a tela de compatibilidade, então a tela
 * existia e só se chegava nela digitando a URL. Uma lista, duas leituras: `rotulo`
 * é o texto curto da barra, `descricao` é a linha que a página inicial mostra.
 *
 * Nenhum rótulo aqui é nome de marca — são nomes de função (ADR 0003).
 *
 * ## Os nomes internos saíram daqui
 *
 * "Jobs" era o nome da tabela e "Identidade" o nome do módulo, e o dono do
 * repositório disse que não entendia nenhum dos dois. Viraram "Importar" e "Juntar
 * iguais" — o nome do trabalho que cada tela faz —, e a rota acompanhou, porque a
 * URL também é texto que alguém lê. "Leitor" caía no mesmo teste ("leitor de quê?")
 * e virou "Bipar na loja".
 *
 * A rota `/leitor` ficou como estava, de propósito: é a tela instalável como
 * aplicativo, e trocar a rota de uma PWA já instalada quebra o atalho que está no
 * celular. Rótulo e rota não precisam coincidir; o que não pode é o rótulo mentir.
 */
export interface Porta {
  readonly href: string;
  /** Texto curto da barra de navegação. */
  readonly rotulo: string;
  /** Uma linha dizendo para que serve, na página inicial. `null` na própria. */
  readonly descricao: string | null;
}

export const PORTAS: readonly Porta[] = [
  { href: '/', rotulo: 'Início', descricao: null },
  {
    href: '/importar',
    rotulo: 'Importar',
    descricao:
      'Sobe a exportação do painel do marketplace ou uma planilha de fornecedor, e mostra o que o sistema está processando.',
  },
  {
    href: '/juntar-iguais',
    rotulo: 'Juntar iguais',
    descricao:
      'O mesmo produto, encontrado em lugares diferentes, vira um produto só do seu catálogo — e aí dá para comparar preço de fornecedor.',
  },
  {
    href: '/postagem',
    rotulo: 'Postar hoje',
    descricao:
      'O que postar hoje, em ordem de prazo. É a tela do dia a dia, e no fim dela a conferência do que a plataforma repassou.',
  },
  {
    href: '/anuncios',
    rotulo: 'Montar anúncio',
    descricao:
      'Título com os códigos que o comprador busca, descrição com a tabela de onde serve, e o arquivo de importação da plataforma.',
  },
  {
    href: '/consignacao',
    rotulo: 'Consignação',
    descricao:
      'Peça de parceiro que você anuncia como sua, e a conferência que impede vender o que já saiu no balcão dele.',
  },
  {
    href: '/compatibilidade',
    rotulo: 'Onde serve',
    descricao:
      'Em que aparelhos cada peça serve, com a fonte de cada afirmação. É o que responde “serve no meu modelo?”.',
  },
  {
    href: '/fornecedores',
    rotulo: 'Fornecedores',
    descricao:
      'As cinco perguntas que eliminam a maioria dos candidatos — e quem vende na mesma vitrine é descartado na hora.',
  },
  {
    href: '/fiscal',
    rotulo: 'Fiscal',
    descricao:
      'O que a virada de janeiro de 2027 vai exigir: prazos, teto do ano, e o NCM e o cClassTrib de cada produto.',
  },
  {
    href: '/leitor',
    rotulo: 'Bipar na loja',
    descricao:
      'Aponta a câmera para o código de barras na prateleira e diz se vale comprar, com o preço de mercado.',
  },
];
