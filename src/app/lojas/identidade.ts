/**
 * Como cada loja se reconhece na tela: a sigla e as duas cores do selo.
 *
 * É dado do mundo, e não marca do vendedor (ADR 0003): as cores são as que o comprador
 * associa a cada plataforma, e é isso que faz a linha da loja ser achada de relance na
 * barra. O logo de verdade, quando entrar, entra aqui — como arquivo que o dono põe, e
 * não como desenho copiado.
 *
 * O par de cores foi escolhido pelo contraste, não só pela semelhança: a sigla precisa
 * de 4,5:1 sobre o fundo. O laranja da Shopee e o vermelho do AliExpress foram
 * escurecidos um ponto por isso — no tom da marca, o branco em cima não passa.
 */
import type { Plataforma } from '@/dominio/precificacao/tipos';

export interface IdentidadeDaLoja {
  readonly sigla: string;
  readonly fundo: string;
  readonly texto: string;
}

export const IDENTIDADE_DA_LOJA: Readonly<Record<Plataforma, IdentidadeDaLoja>> = {
  ml: { sigla: 'ML', fundo: '#ffe600', texto: '#2d3277' },
  shopee: { sigla: 'SP', fundo: '#d73211', texto: '#ffffff' },
  amazon: { sigla: 'AM', fundo: '#232f3e', texto: '#ff9900' },
};
