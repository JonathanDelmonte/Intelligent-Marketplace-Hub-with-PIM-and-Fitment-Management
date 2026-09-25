/**
 * O que a barra mostra ao lado das lojas: em que pé cada uma está e quantos pedidos
 * dela esperam postagem.
 *
 * ## Por que a barra busca isto, em vez de receber do `layout`
 *
 * O `layout` é de servidor e **não se refaz** na navegação entre telas: o App Router
 * só busca o que muda abaixo dele. Números entregues por ele ficariam congelados na
 * primeira tela aberta — "7 para postar" continuaria 7 depois de postar os sete. A
 * barra pede o estado de novo a cada troca de tela, e o que a tela mostra é o de agora.
 *
 * A leitura do lado do navegador é conferida campo a campo (`lerEstadoDaBarra`): é o
 * nosso servidor, mas é fronteira, e resposta torta vira barra sem números, nunca barra
 * quebrada.
 */
import {
  ESTADOS_DA_LOJA,
  estadoDaLoja,
  type NumerosDaLoja,
  type TipoDeEstadoDaLoja,
} from '@/dominio/lojas/estado';
import type { FilaDoDia, Urgencia } from '@/dominio/pedidos/fila-do-dia';
import { ehPlataforma, type Plataforma } from '@/dominio/precificacao/tipos';

/** O caminho da leitura. Uma constante, para a rota e a barra não divergirem. */
export const CAMINHO_DO_ESTADO_DA_BARRA = '/barra';

/** Urgências que contam como "postar hoje" — as mesmas da tela inicial. */
const URGENTES: readonly Urgencia[] = ['atrasado', 'hoje', 'sem_prazo'];

export interface EstadoDaLojaNaBarra {
  readonly plataforma: Plataforma;
  readonly tipo: TipoDeEstadoDaLoja;
  readonly legenda: string;
  readonly paraPostar: number;
}

/** Quem está usando (ADR 0011): o nome vai ao pé da barra, junto do botão de sair. */
export interface ContaNaBarra {
  readonly nome: string;
}

export interface EstadoDaBarra {
  readonly postarHoje: number;
  readonly lojas: readonly EstadoDaLojaNaBarra[];
  readonly conta: ContaNaBarra | null;
}

export function montarEstadoDaBarra(
  numeros: readonly NumerosDaLoja[],
  fila: FilaDoDia,
  conta: ContaNaBarra | null,
  fuso?: string,
): EstadoDaBarra {
  const urgentes = fila.itens.filter((i) => URGENTES.includes(i.urgencia));
  const lojas = numeros.map((n) => {
    const estado = estadoDaLoja(n, fuso);
    return {
      plataforma: n.plataforma,
      tipo: estado.tipo,
      legenda: estado.legenda,
      paraPostar: urgentes.filter((i) => i.plataforma === n.plataforma).length,
    };
  });
  return { postarHoje: urgentes.length, lojas, conta };
}

function ehTipoDeEstado(valor: unknown): valor is TipoDeEstadoDaLoja {
  return ESTADOS_DA_LOJA.some((t) => t === valor);
}

function ehContagem(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0;
}

function lerLoja(valor: unknown): EstadoDaLojaNaBarra | null {
  if (typeof valor !== 'object' || valor === null) return null;
  if (!('plataforma' in valor) || !ehPlataforma(valor.plataforma)) return null;
  if (!('tipo' in valor) || !ehTipoDeEstado(valor.tipo)) return null;
  if (!('legenda' in valor) || typeof valor.legenda !== 'string') return null;
  if (!('paraPostar' in valor) || !ehContagem(valor.paraPostar)) return null;
  return {
    plataforma: valor.plataforma,
    tipo: valor.tipo,
    legenda: valor.legenda,
    paraPostar: valor.paraPostar,
  };
}

/** O nome é enfeite: conta torta vira barra sem nome, e os números continuam. */
function lerConta(valor: unknown): ContaNaBarra | null {
  if (typeof valor !== 'object' || valor === null) return null;
  if (!('nome' in valor) || typeof valor.nome !== 'string' || valor.nome === '') return null;
  return { nome: valor.nome };
}

/** Confere a resposta da rota. Qualquer campo torto devolve `null`, e a barra fica sem números. */
export function lerEstadoDaBarra(valor: unknown): EstadoDaBarra | null {
  if (typeof valor !== 'object' || valor === null) return null;
  if (!('postarHoje' in valor) || !ehContagem(valor.postarHoje)) return null;
  if (!('lojas' in valor) || !Array.isArray(valor.lojas)) return null;

  const brutas: readonly unknown[] = valor.lojas;
  const lojas: EstadoDaLojaNaBarra[] = [];
  for (const bruta of brutas) {
    const loja = lerLoja(bruta);
    if (loja === null) return null;
    lojas.push(loja);
  }
  const conta = 'conta' in valor ? lerConta(valor.conta) : null;
  return { postarHoje: valor.postarHoje, lojas, conta };
}
