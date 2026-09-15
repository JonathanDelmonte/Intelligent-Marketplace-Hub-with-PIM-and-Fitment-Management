/**
 * Quais ferramentas do prospector existem nesta instalação (M6).
 *
 * A fronteira já sabe recusar item cuja ferramenta falta — `escolherDaFronteira` filtra
 * por `limites.ferramentas`. O que não existia é **quem responde a essa pergunta**, e
 * sem isso a tela não conseguia dizer por que um dossiê não avança.
 *
 * ## Declaração, e não sonda
 *
 * O mesmo desenho de `plataformas/capacidades.ts`: cada ferramenta declara o que faz e
 * o que lhe falta. Sondar aqui seria pior — descobrir no meio do passo que a rede
 * recusa o domínio é exatamente o que gasta orçamento para nada, e a especificação põe
 * o teto justamente para isso não acontecer.
 *
 * Só uma linha é derivada de configuração (`visao`, que precisa de chave de LLM). As
 * outras são fato sobre **este código**: não há buscador, não há leitor de página, não
 * há consulta de CNPJ e não há sensor de PNCP implementado. Enquanto não houver, dizer
 * "disponível" seria mentir para o próprio agente.
 *
 * ## O que isto não diz
 *
 * Não diz que a investigação vai rodar. O executor — o laço que gasta passo e chama
 * ferramenta — não existe (ver roadmap, fase 10). Isto responde "o que **poderia** ser
 * chamado", que é a metade da pergunta que dá para responder com honestidade.
 */
import { FERRAMENTAS, type Ferramenta } from './hipoteses';

export type EstadoDaFerramenta =
  | { readonly tipo: 'disponivel' }
  | { readonly tipo: 'falta_chave'; readonly variavel: string }
  | { readonly tipo: 'sem_adaptador'; readonly oQueFalta: string };

/** O que cada ferramenta faz, em uma linha. É o que a tela mostra. */
export const O_QUE_A_FERRAMENTA_FAZ: Readonly<Record<Ferramenta, string>> = {
  busca_web: 'Procura por termo na web e devolve endereços para investigar.',
  ler_pagina: 'Abre uma página e extrai preço, contato e especificação.',
  visao: 'Lê print de tabela de preços e foto de etiqueta.',
  cnpj: 'Confere se o candidato é distribuidor de verdade, e se está ativo.',
  pncp: 'Consulta compra pública: demanda em volume e preço de referência abertos.',
  base_local: 'Procura no que já está aqui: catálogo, compatibilidade e fornecedores.',
};

export interface ContextoDasFerramentas {
  readonly temChaveDeLlm: boolean;
}

/**
 * O estado de uma ferramenta.
 *
 * `base_local` é a única disponível sem nada de fora, e é por isso que ela importa mais
 * do que o valor base das famílias dela sugere: é a única investigação que este
 * ambiente consegue pagar hoje.
 */
export function estadoDaFerramenta(
  ferramenta: Ferramenta,
  contexto: ContextoDasFerramentas,
): EstadoDaFerramenta {
  switch (ferramenta) {
    case 'base_local':
      return { tipo: 'disponivel' };

    case 'visao':
      return contexto.temChaveDeLlm
        ? { tipo: 'disponivel' }
        : { tipo: 'falta_chave', variavel: 'LLM_API_KEY' };

    case 'busca_web':
      return {
        tipo: 'sem_adaptador',
        oQueFalta: 'Nenhum buscador implementado, e rede de saída para o buscador.',
      };

    case 'ler_pagina':
      return {
        tipo: 'sem_adaptador',
        oQueFalta: 'Nenhum leitor de página implementado, e rede de saída.',
      };

    case 'cnpj':
      return {
        tipo: 'sem_adaptador',
        oQueFalta: 'Nenhuma consulta de CNPJ implementada, e rede de saída.',
      };

    case 'pncp':
      return {
        tipo: 'sem_adaptador',
        // `SensorDePncpAusente` já é o estado correto disto no domínio: a política de
        // rede deste ambiente recusa `pncp.gov.br` com CONNECT 403.
        oQueFalta: 'Sensor de PNCP ausente, e a rede daqui recusa pncp.gov.br.',
      };
  }
}

/** As ferramentas que dão para chamar. Entra direto em `LimitesDaBusca.ferramentas`. */
export function ferramentasDisponiveis(contexto: ContextoDasFerramentas): readonly Ferramenta[] {
  return FERRAMENTAS.filter((f) => estadoDaFerramenta(f, contexto).tipo === 'disponivel');
}
