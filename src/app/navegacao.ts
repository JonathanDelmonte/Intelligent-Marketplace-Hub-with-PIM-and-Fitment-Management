/**
 * As portas do sistema, em uma lista só.
 *
 * Existia em dois lugares — a barra do `layout` e os cartões da página inicial — e
 * dois lugares divergem: a barra não tinha a tela de compatibilidade, então a tela
 * existia e só se chegava nela digitando a URL. Uma lista, duas leituras: `rotulo`
 * é o texto curto da barra, `descricao` é a linha que a página inicial mostra.
 *
 * Nenhum rótulo aqui é nome de marca do vendedor — são nomes de função (ADR 0003). Os
 * nomes das plataformas entram pelas lojas, e são dado do mundo.
 *
 * ## Os grupos separam o que é de uma loja do que serve a todas (ADR 0009)
 *
 * O desenho anterior agrupava por momento de trabalho — hoje, catálogo, oportunidade,
 * obrigação — e o dono lia um painel genérico, que "alguém que não vende nessas lojas
 * pode usar". Agora a barra tem um grupo só para as lojas, cada uma com a área dela, e
 * o que serve a qualquer loja aparece uma vez, fora delas: produtos, oportunidades,
 * fornecimento e empresa. O topo, sem título, é o que se usa todo dia.
 *
 * ## Duas telas moram dentro de outras
 *
 * Juntar iguais saiu da barra e mora no catálogo (`tambem`): é manutenção do catálogo,
 * e porta própria competia com as que se usam todo dia. Perguntas e repasse moram na
 * área de cada loja, porque vêm de uma loja só.
 *
 * ## Rótulo e rota não precisam coincidir
 *
 * A rota `/leitor` ficou como estava, de propósito: é a tela instalável como
 * aplicativo, e trocar a rota de uma PWA já instalada quebra o atalho que está no
 * celular. O que não pode é o rótulo mentir.
 */
import { PLATAFORMAS, type Plataforma } from '@/dominio/precificacao/tipos';
import { ROTULO_DA_PLATAFORMA } from './ui/rotulos';

export const GRUPOS = [
  'topo',
  'lojas',
  'produtos',
  'oportunidades',
  'fornecimento',
  'empresa',
] as const;

export type Grupo = (typeof GRUPOS)[number];

/**
 * Título do grupo, na barra e na página inicial.
 *
 * O topo não tem título: são as quatro portas do dia a dia, e um rótulo em cima delas
 * seria uma linha gasta para dizer o óbvio.
 */
export const TITULO_DO_GRUPO: Readonly<Record<Grupo, string | null>> = {
  topo: null,
  lojas: 'Minhas lojas',
  produtos: 'Produtos',
  oportunidades: 'Oportunidades',
  fornecimento: 'Fornecimento',
  empresa: 'Empresa',
};

/** Os ícones da barra. Os desenhos estão em `icones.tsx`. */
export const ICONES = [
  'importar',
  'visao',
  'assistente',
  'postar',
  'adicionar',
  'catalogo',
  'ondeserve',
  'publicar',
  'garimpo',
  'monitor',
  'bipar',
  'afiliados',
  'fornecedores',
  'consignacao',
  'fiscal',
  'negocio',
  'copia',
] as const;

export type Icone = (typeof ICONES)[number];

export interface Porta {
  readonly href: string;
  /** Texto curto da barra de navegação. */
  readonly rotulo: string;
  /** Uma linha dizendo para que serve, na página inicial. `null` na própria. */
  readonly descricao: string | null;
  readonly grupo: Grupo;
  readonly icone: Icone;
  /** Outras telas que moram dentro desta porta: nelas, a barra marca esta. */
  readonly tambem: readonly string[];
  /** Porta que é ação e não lugar: vira o botão do alto da barra. */
  readonly destaque: boolean;
}

type PortaEscrita = Omit<Porta, 'tambem' | 'destaque'> &
  Partial<Pick<Porta, 'tambem' | 'destaque'>>;

function porta(escrita: PortaEscrita): Porta {
  return { tambem: [], destaque: false, ...escrita };
}

export const CAMINHO_DAS_LOJAS = '/lojas';

export const PORTAS: readonly Porta[] = [
  porta({
    href: '/importar',
    rotulo: 'Importar arquivo',
    descricao:
      'Sobe a exportação do painel da loja, a tabela do fornecedor, um link, um PDF ou um print — e mostra o que o sistema está lendo.',
    grupo: 'topo',
    icone: 'importar',
    destaque: true,
  }),
  porta({ href: '/', rotulo: 'Visão geral', descricao: null, grupo: 'topo', icone: 'visao' }),
  porta({
    href: '/assistente',
    rotulo: 'Assistente IA',
    descricao:
      'Pergunte em português sobre as suas lojas: faturamento, pedidos, o que postar. A conta é do sistema, e a resposta diz de onde veio o número.',
    grupo: 'topo',
    icone: 'assistente',
  }),
  porta({
    href: '/postagem',
    rotulo: 'Postar hoje',
    descricao: 'O que postar hoje, de todas as lojas, em ordem de prazo. É a tela do dia a dia.',
    grupo: 'topo',
    icone: 'postar',
  }),
  porta({
    href: CAMINHO_DAS_LOJAS,
    rotulo: 'Adicionar loja',
    descricao:
      'As lojas que o sistema atende e as que estão a caminho, com o que falta para cada uma entrar.',
    grupo: 'lojas',
    icone: 'adicionar',
  }),
  porta({
    href: '/catalogo',
    rotulo: 'Catálogo e preço',
    descricao:
      'O que você vende, com o custo de cada peça e quanto cobrar por ela, com a conta aberta linha por linha. Juntar iguais mora aqui dentro.',
    grupo: 'produtos',
    icone: 'catalogo',
    tambem: ['/juntar-iguais'],
  }),
  porta({
    href: '/compatibilidade',
    rotulo: 'Onde serve',
    descricao:
      'Em que aparelhos cada peça serve, com a fonte de cada afirmação. É o que responde “serve no meu modelo?”.',
    grupo: 'produtos',
    icone: 'ondeserve',
  }),
  porta({
    href: '/anuncios',
    rotulo: 'Publicar anúncio',
    descricao:
      'Título com os códigos que o comprador busca, descrição com a tabela de onde serve, e o arquivo de importação de cada loja.',
    grupo: 'produtos',
    icone: 'publicar',
  }),
  porta({
    href: '/garimpo',
    rotulo: 'Garimpo',
    descricao:
      'Investigação dirigida a um alvo, com teto declarado antes de começar: quem fabrica, quem distribui, onde é mais barato — e o dossiê com a fonte de cada achado.',
    grupo: 'oportunidades',
    icone: 'garimpo',
  }),
  porta({
    href: '/monitor',
    rotulo: 'Monitor de preço',
    descricao:
      'O que mudou no mercado desde a última vez que você olhou, agrupado por vendedor e semana — e o que vale publicar hoje.',
    grupo: 'oportunidades',
    icone: 'monitor',
  }),
  porta({
    href: '/leitor',
    rotulo: 'Bipar na loja',
    descricao:
      'Aponta a câmera para o código de barras na prateleira e diz se vale comprar, com o preço de mercado.',
    grupo: 'oportunidades',
    icone: 'bipar',
  }),
  porta({
    href: '/afiliados',
    rotulo: 'Afiliados',
    descricao:
      'Oferta de terceiro publicada com a sua tag, com teto por dia e intervalo entre uma e a próxima — grupo que posta demais é silenciado pelos membros.',
    grupo: 'oportunidades',
    icone: 'afiliados',
  }),
  porta({
    href: '/fornecedores',
    rotulo: 'Fornecedores',
    descricao:
      'As cinco perguntas que eliminam a maioria dos candidatos — e quem vende na mesma vitrine é descartado na hora.',
    grupo: 'fornecimento',
    icone: 'fornecedores',
  }),
  porta({
    href: '/consignacao',
    rotulo: 'Consignação',
    descricao:
      'Peça de parceiro que você anuncia como sua, e a conferência que impede vender o que já saiu no balcão dele.',
    grupo: 'fornecimento',
    icone: 'consignacao',
  }),
  porta({
    href: '/fiscal',
    rotulo: 'Fiscal',
    descricao:
      'O que a virada de janeiro de 2027 vai exigir: prazos, teto do ano, o emissor de nota, e o NCM e o cClassTrib de cada produto.',
    grupo: 'empresa',
    icone: 'fiscal',
  }),
  porta({
    href: '/negocio',
    rotulo: 'Meu negócio',
    descricao:
      'Regime, CNPJ, estado, certificado e DAS — o que muda a margem, o teto e o emissor de nota. As vendas do mês o sistema conta sozinho.',
    grupo: 'empresa',
    icone: 'negocio',
  }),
  porta({
    href: '/copia',
    rotulo: 'Cópia dos dados',
    descricao:
      'O banco inteiro num arquivo, guardado no seu computador — a cópia de segurança que a nuvem gratuita não faz.',
    grupo: 'empresa',
    icone: 'copia',
  }),
];

/** A área de uma loja. */
export function caminhoDaLoja(plataforma: Plataforma): string {
  return `${CAMINHO_DAS_LOJAS}/${plataforma}`;
}

export interface PortaDeLoja {
  readonly plataforma: Plataforma;
  readonly href: string;
  readonly rotulo: string;
}

/**
 * As portas das lojas, uma por plataforma, na ordem canônica do domínio.
 *
 * Derivadas da lista de plataformas, e não escritas à mão: loja nova entra no
 * domínio e ganha a área dela sem tela nova (ADR 0009).
 */
export function portasDasLojas(
  plataformas: readonly Plataforma[] = PLATAFORMAS,
): readonly PortaDeLoja[] {
  return plataformas.map((plataforma) => ({
    plataforma,
    href: caminhoDaLoja(plataforma),
    rotulo: ROTULO_DA_PLATAFORMA[plataforma],
  }));
}

export interface GrupoDePortas {
  readonly grupo: Grupo;
  readonly titulo: string | null;
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
    portas: portas.filter((p) => p.grupo === grupo),
  })).filter((g) => g.portas.length > 0);
}

/**
 * O endereço da porta que a barra deve marcar no caminho atual.
 *
 * Casa por igualdade com a porta ou com uma tela que mora nela (`tambem`) e, na falta,
 * por prefixo: `/importar/<id>` é a tela de importação vista de perto, e marcar
 * "Importar" ali é a resposta certa. A raiz casa só por igualdade — todo caminho começa
 * com `/`.
 *
 * Empate vai para a porta mais específica, e aqui isso acontece de verdade: a área da
 * Shopee, `/lojas/shopee`, começa com `/lojas`, que é a porta de adicionar loja. Sem a
 * ordenação a resposta dependeria da ordem da lista, que é ordem de menu e não de
 * especificidade.
 */
export function hrefAtual(
  caminho: string,
  portas: readonly Porta[] = PORTAS,
  lojas: readonly PortaDeLoja[] = portasDasLojas(),
): string | null {
  const alvos = [
    ...portas.flatMap((p) => [p.href, ...p.tambem].map((prefixo) => ({ href: p.href, prefixo }))),
    ...lojas.map((l) => ({ href: l.href, prefixo: l.href })),
  ];

  const exato = alvos.find((a) => a.prefixo === caminho);
  if (exato !== undefined) return exato.href;

  return (
    alvos
      .filter((a) => a.prefixo !== '/' && caminho.startsWith(`${a.prefixo}/`))
      .sort((a, b) => b.prefixo.length - a.prefixo.length)[0]?.href ?? null
  );
}
