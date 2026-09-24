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
 * ## O grupo existe porque dez portas em fila não são uma navegação
 *
 * Com dez itens numa linha só, a barra era uma lista de palavras: não dizia o que vem
 * antes de quê, nem qual delas é a do dia a dia. Os grupos são os momentos em que alguém
 * abre este sistema — despachar o que vendeu, alimentar o catálogo, procurar dinheiro
 * novo, e cuidar de fornecedor e obrigação. Dentro de `catalogo` a ordem é a do fluxo:
 * importar, juntar, dizer onde serve, montar anúncio.
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
export const GRUPOS = ['hoje', 'catalogo', 'oportunidade', 'protecao'] as const;

export type Grupo = (typeof GRUPOS)[number];

/** Título do grupo, na barra e na página inicial. */
export const TITULO_DO_GRUPO: Readonly<Record<Grupo, string>> = {
  hoje: 'Hoje',
  catalogo: 'Catálogo',
  oportunidade: 'Oportunidade',
  protecao: 'Fornecedor e obrigação',
};

export interface Porta {
  readonly href: string;
  /** Texto curto da barra de navegação. */
  readonly rotulo: string;
  /** Uma linha dizendo para que serve, na página inicial. `null` na própria. */
  readonly descricao: string | null;
  /** Momento de trabalho. `null` só na página inicial, que não é um momento. */
  readonly grupo: Grupo | null;
}

export const PORTAS: readonly Porta[] = [
  { href: '/', rotulo: 'Início', descricao: null, grupo: null },
  {
    href: '/postagem',
    rotulo: 'Postar hoje',
    descricao:
      'O que postar hoje, em ordem de prazo. É a tela do dia a dia, e no fim dela a conferência do que a plataforma repassou.',
    grupo: 'hoje',
  },
  {
    href: '/leitor',
    rotulo: 'Bipar na loja',
    descricao:
      'Aponta a câmera para o código de barras na prateleira e diz se vale comprar, com o preço de mercado.',
    grupo: 'hoje',
  },
  {
    href: '/perguntas',
    rotulo: 'Perguntas',
    descricao:
      'A mesma dúvida repetida é o anúncio pedindo conserto. Guarda as perguntas e diz o que acrescentar na descrição.',
    grupo: 'hoje',
  },
  {
    href: '/catalogo',
    rotulo: 'Produtos e custo',
    descricao:
      'O que você vende, com o custo de cada peça — e quanto cobrar por ela, com a conta aberta linha por linha.',
    grupo: 'catalogo',
  },
  {
    href: '/importar',
    rotulo: 'Importar',
    descricao:
      'Sobe a exportação do painel do marketplace ou uma planilha de fornecedor, e mostra o que o sistema está processando.',
    grupo: 'catalogo',
  },
  {
    href: '/juntar-iguais',
    rotulo: 'Juntar iguais',
    descricao:
      'O mesmo produto, encontrado em lugares diferentes, vira um produto só do seu catálogo — e aí dá para comparar preço de fornecedor.',
    grupo: 'catalogo',
  },
  {
    href: '/compatibilidade',
    rotulo: 'Onde serve',
    descricao:
      'Em que aparelhos cada peça serve, com a fonte de cada afirmação. É o que responde “serve no meu modelo?”.',
    grupo: 'catalogo',
  },
  {
    href: '/anuncios',
    rotulo: 'Montar anúncio',
    descricao:
      'Título com os códigos que o comprador busca, descrição com a tabela de onde serve, e o arquivo de importação da plataforma.',
    grupo: 'catalogo',
  },
  {
    href: '/monitor',
    rotulo: 'Monitor de preço',
    descricao:
      'O que mudou no mercado desde a última vez que você olhou, agrupado por vendedor e semana — e o que vale publicar hoje.',
    grupo: 'oportunidade',
  },
  {
    href: '/garimpo',
    rotulo: 'Garimpo',
    descricao:
      'Investigação dirigida a um alvo, com teto declarado antes de começar: quem fabrica, quem distribui, onde é mais barato — e o dossiê com a fonte de cada achado.',
    grupo: 'oportunidade',
  },
  {
    href: '/afiliados',
    rotulo: 'Afiliados',
    descricao:
      'Oferta de terceiro publicada com a sua tag, com teto por dia e intervalo entre uma e a próxima — grupo que posta demais é silenciado pelos membros.',
    grupo: 'oportunidade',
  },
  {
    href: '/fornecedores',
    rotulo: 'Fornecedores',
    descricao:
      'As cinco perguntas que eliminam a maioria dos candidatos — e quem vende na mesma vitrine é descartado na hora.',
    grupo: 'protecao',
  },
  {
    href: '/consignacao',
    rotulo: 'Consignação',
    descricao:
      'Peça de parceiro que você anuncia como sua, e a conferência que impede vender o que já saiu no balcão dele.',
    grupo: 'protecao',
  },
  {
    href: '/fiscal',
    rotulo: 'Fiscal',
    descricao:
      'O que a virada de janeiro de 2027 vai exigir: prazos, teto do ano, o emissor de nota, e o NCM e o cClassTrib de cada produto.',
    grupo: 'protecao',
  },
  {
    href: '/negocio',
    rotulo: 'Meu negócio',
    descricao:
      'Regime, CNPJ, estado, certificado e DAS — o que muda a margem, o teto e o emissor de nota. Preenchido aqui, e as vendas do mês o sistema conta sozinho.',
    grupo: 'protecao',
  },
];

export interface GrupoDePortas {
  readonly grupo: Grupo;
  readonly titulo: string;
  readonly portas: readonly Porta[];
}

/**
 * As portas agrupadas, na ordem de `GRUPOS` e, dentro de cada grupo, na ordem de
 * `PORTAS`.
 *
 * Derivado, e não uma segunda lista escrita à mão — foi assim que a barra ficou sem a
 * tela de compatibilidade a primeira vez. Grupo sem porta nenhuma não aparece: título
 * de seção vazia é pior que seção ausente.
 */
export function portasPorGrupo(portas: readonly Porta[] = PORTAS): readonly GrupoDePortas[] {
  return GRUPOS.map((grupo) => ({
    grupo,
    titulo: TITULO_DO_GRUPO[grupo],
    portas: portas.filter((porta) => porta.grupo === grupo),
  })).filter((g) => g.portas.length > 0);
}

/**
 * A porta do caminho atual, para a barra poder dizer onde você está.
 *
 * Casa por prefixo além da igualdade, porque `/importar/<id>` é a tela de importação
 * vista de perto — marcar "Importar" ali é a resposta certa. A raiz é caso especial:
 * todo caminho começa com `/`, então ela casa só por igualdade.
 *
 * Empate vai para a porta mais específica. Hoje não há duas portas onde uma seja
 * prefixo da outra, e a ordenação existe para o dia em que houver: sem ela a resposta
 * dependeria da ordem de `PORTAS`, que é ordem de menu e não de especificidade.
 */
export function portaAtual(caminho: string, portas: readonly Porta[] = PORTAS): Porta | null {
  const exata = portas.find((porta) => porta.href === caminho);
  if (exata !== undefined) return exata;

  return (
    portas
      .filter((porta) => porta.href !== '/' && caminho.startsWith(`${porta.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}
