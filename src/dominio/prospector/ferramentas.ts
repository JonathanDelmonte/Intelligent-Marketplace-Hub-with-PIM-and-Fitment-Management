/**
 * O estado de cada ferramenta do prospector (M6).
 *
 * A fronteira já sabia recusar item cuja ferramenta falta — `escolherDaFronteira` filtra
 * por `limites.ferramentas`. O que não existia é **quem responde a essa pergunta**, e
 * sem isso a tela não conseguia dizer por que um dossiê não avança.
 *
 * ## "Disponível" é ter investigador, e não ter configuração
 *
 * A primeira versão deste arquivo declarava o estado de cada ferramenta e derivava a
 * visão da chave de LLM no ambiente. Estava errado do jeito que engana: a tela dizia
 * "falta chave" para a visão, o que implica que pôr a chave a faria rodar — e não
 * faria, porque ninguém a chama. Agora a fonte da verdade é o registro de
 * investigadores (`registro.ts`), e o que sobra aqui é o **texto**: o que cada
 * ferramenta faz e o que falta para ela existir.
 *
 * ## O que isto não diz
 *
 * Não diz que a investigação vai achar algo. Diz que a chamada existe.
 */
import { FERRAMENTAS, type Ferramenta } from './hipoteses';

export type EstadoDaFerramenta =
  { readonly tipo: 'disponivel' } | { readonly tipo: 'falta'; readonly oQueFalta: string };

/** O que cada ferramenta faz, em uma linha. É o que a tela mostra. */
export const O_QUE_A_FERRAMENTA_FAZ: Readonly<Record<Ferramenta, string>> = {
  busca_web: 'Procura por termo na web e devolve endereços para investigar.',
  ler_pagina: 'Abre uma página e extrai preço, contato e especificação.',
  visao: 'Lê print de tabela de preços e foto de etiqueta.',
  cnpj: 'Confere se o candidato é distribuidor de verdade, e se está ativo.',
  pncp: 'Consulta compra pública: demanda em volume e preço de referência abertos.',
  base_local: 'Procura no que já está aqui: anúncio e ocorrência já coletados.',
};

/**
 * O que falta para cada ferramenta existir.
 *
 * Texto com o nome da coisa que alguém tem de escrever ou ligar, e não "indisponível":
 * a diferença entre as duas é que a segunda manda a pessoa procurar.
 */
export const O_QUE_FALTA_PARA_A_FERRAMENTA: Readonly<Record<Ferramenta, string>> = {
  busca_web: 'Rede de saída para o buscador (html.duckduckgo.com).',
  ler_pagina: 'Rede de saída para as páginas que a busca aponta.',
  visao: 'Nenhum investigador de visão, e o garimpo não tem de onde receber imagem.',
  cnpj: 'Rede de saída para a consulta de CNPJ (brasilapi.com.br).',
  pncp: 'Rede de saída para o PNCP (pncp.gov.br).',
  base_local: 'Nenhum investigador de base local registrado.',
};

/**
 * O estado de uma ferramenta, dado o que a instalação sabe chamar.
 *
 * `prontas` vem do registro de investigadores, e não de configuração. Sem parâmetro
 * padrão de propósito: um padrão que importasse o registro puxaria banco e executor
 * para dentro de um módulo de texto.
 */
export function estadoDaFerramenta(
  ferramenta: Ferramenta,
  prontas: readonly Ferramenta[],
): EstadoDaFerramenta {
  return prontas.includes(ferramenta)
    ? { tipo: 'disponivel' }
    : { tipo: 'falta', oQueFalta: O_QUE_FALTA_PARA_A_FERRAMENTA[ferramenta] };
}

/** As que faltam, na ordem de `FERRAMENTAS`. */
export function ferramentasQueFaltam(prontas: readonly Ferramenta[]): readonly Ferramenta[] {
  return FERRAMENTAS.filter((f) => !prontas.includes(f));
}
