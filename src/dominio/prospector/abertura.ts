/**
 * Abrir um alvo: o estado inicial de uma investigação (M6).
 *
 * A fase 10 entregou a máquina (fronteira, orçamento, saturação, dossiê salvável) e o
 * que ela recebia era um `EstadoDaBusca` montado à mão em teste. Faltava o começo: dado
 * um alvo, **quais hipóteses valem levantar e o que entra na fronteira**.
 *
 * Isto é máquina, e não julgamento. As sete famílias são declaradas (10.3), o valor de
 * cada uma também, e a ordenação da fronteira é valor por custo — nada aqui exige
 * decidir sobre evidência incompleta. O que é julgamento é o que vem depois: levantar
 * hipótese **nova** a partir do que a página dizia, e escolher em quem acreditar quando
 * as fontes discordam. Isso é do agente, e o agente não existe ainda.
 *
 * ## Uma hipótese por família, e todas entram
 *
 * Inclusive as que hoje não dá para investigar. Hipótese que não dá para verificar
 * continua podendo ser verdade, e apagá-la da lista esconderia o plano: o que filtra por
 * ferramenta é `escolherDaFronteira`, no momento de gastar o passo, que é onde a falta
 * de ferramenta importa.
 *
 * ## Id é o nome da família, de propósito
 *
 * Um dossiê tem no máximo uma hipótese inicial por família, e id legível é o que faz o
 * dossiê ser auditável por quem lê o `jsonb` — `onde_e_mais_barato` diz o que é;
 * `a3f1-...` não diz nada. Reabrir o mesmo alvo não duplica, porque `aplicarInvestigacao`
 * não duplica id na fronteira.
 */
import { ESTADO_INICIAL, itemDaFamilia } from './fronteira';
import type { EstadoDaBusca, Hipotese, ItemDaFronteira } from './fronteira';
import { DEFINICOES, definicaoDaFamilia } from './hipoteses';
import type { FamiliaDeHipotese, Ferramenta } from './hipoteses';

/**
 * A hipótese inicial de cada família, sobre um alvo.
 *
 * Afirmação, e não pergunta: hipótese é o que pode ser **verdade**, e o que se faz com
 * ela é confirmar ou descartar. A pergunta da família continua em `DEFINICOES`, para a
 * tela explicar de onde a hipótese veio.
 */
const ENUNCIADO: Readonly<Record<FamiliaDeHipotese, (alvo: string) => string>> = {
  onde_e_mais_barato: (a) =>
    `Existe fornecedor de ${a} com custo desembarcado menor que o de hoje.`,
  quem_distribui: (a) => `Existe distribuidor nacional de ${a}, com prazo curto e sem importação.`,
  quem_fabrica: (a) => `Dá para identificar quem fabrica ${a}, e chegar ao distribuidor dele.`,
  que_outras_pecas: (a) => `O aparelho que usa ${a} consome outras peças que dá para vender.`,
  em_que_mais_serve: (a) => `${a} serve em mais aparelhos do que a ficha diz hoje.`,
  demanda_publica: (a) => `Existe compra pública de ${a}, com preço de referência aberto.`,
  quem_ja_vende: (a) => `A concorrência em ${a} é fraca o bastante para valer entrar.`,
};

/**
 * A ferramenta com que a família entra na fronteira.
 *
 * A primeira **disponível** da família, e a primeira declarada quando nenhuma está: o
 * item guarda o que ele precisaria, e é isso que faz a tela conseguir dizer "este passo
 * espera tal ferramenta" em vez de só omitir o item.
 *
 * Escolher a disponível importa: `em_que_mais_serve` aceita `busca_web`, `ler_pagina` e
 * `base_local`, e gravar `busca_web` nela faria a fronteira recusar um item que dava
 * para investigar aqui dentro.
 */
function ferramentaDaFamilia(
  familia: FamiliaDeHipotese,
  disponiveis: readonly Ferramenta[],
): Ferramenta {
  const declaradas = definicaoDaFamilia(familia).ferramentas;
  const tem = new Set(disponiveis);
  const escolhida = declaradas.find((f) => tem.has(f)) ?? declaradas[0];

  // Não pode acontecer: toda definição declara ao menos uma ferramenta, e há teste.
  if (escolhida === undefined) {
    throw new Error(`família de hipótese sem ferramenta declarada: ${familia}`);
  }
  return escolhida;
}

/**
 * O estado inicial da investigação de um alvo.
 *
 * Em ordem de valor decrescente (a ordem de `DEFINICOES`), porque é a ordem em que a
 * fronteira vai ser consumida e é a ordem em que o plano se lê.
 */
export function abrirAlvo(alvo: string, disponiveis: readonly Ferramenta[]): EstadoDaBusca {
  const limpo = alvo.trim();

  const hipoteses = DEFINICOES.map((d): Hipotese => ({
    id: d.familia,
    familia: d.familia,
    enunciado: ENUNCIADO[d.familia](limpo),
    estado: 'aberta',
  }));

  const fronteira = DEFINICOES.map((d): ItemDaFronteira =>
    itemDaFamilia({
      id: d.familia,
      familia: d.familia,
      alvo: limpo,
      ferramenta: ferramentaDaFamilia(d.familia, disponiveis),
    }),
  );

  return { ...ESTADO_INICIAL, hipoteses, fronteira };
}
