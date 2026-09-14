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
 * **Os rótulos "Jobs" e "Identidade" são nomes internos e o dono do repositório já
 * disse que não entende nenhum dos dois.** Ficam como estão nesta passada por
 * decisão dele — a revisão de vocabulário e de navegação é uma tarefa própria,
 * depois das fases, e meia renomeação seria pior que nenhuma. Está anotado em
 * `docs/pendencias.md`.
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
    href: '/jobs',
    rotulo: 'Jobs',
    descricao:
      'Sobe a exportação do painel do marketplace ou uma planilha de fornecedor, e mostra o que o sistema está processando.',
  },
  {
    href: '/identidade',
    rotulo: 'Identidade',
    descricao:
      'O mesmo produto, anunciado em lugares diferentes, junta num só — e aí dá para comparar preço de fornecedor.',
  },
  {
    href: '/postagem',
    rotulo: 'Postar hoje',
    descricao:
      'O que postar hoje, em ordem de prazo. É a tela do dia a dia, e no fim dela a conferência do que a plataforma repassou.',
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
    href: '/leitor',
    rotulo: 'Leitor',
    descricao:
      'Aponta a câmera para o código de barras na prateleira e diz se vale comprar, com o preço de mercado.',
  },
];
