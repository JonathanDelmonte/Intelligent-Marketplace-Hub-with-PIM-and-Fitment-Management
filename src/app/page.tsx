/**
 * Visão geral: todas as lojas somadas, cada loja ao lado, e o que precisa de você.
 *
 * Refeita em 24/09 com a navegação por loja (ADR 0009). Antes era "O que precisa de
 * você", um painel genérico que o dono leu como "alguém que não vende nessas lojas pode
 * usar". Agora o alto é o negócio: os números dos últimos 30 dias com todas as lojas
 * somadas, e um cartão por loja com a fatia dela. Embaixo continua o que fazer hoje, que
 * é regra de negócio testada em `apresentacao.ts`.
 *
 * Duas garantias desta tela, e as duas são de propósito:
 *
 * 1. **Não tem porta de conexão** (ADR 0002, regra 1). Nenhuma plataforma ligada, e a
 *    tela funciona igual — loja sem dado diz o caminho, em vez de mostrar zero.
 * 2. **Não quebra.** Cada leitura falha sozinha e vira "não deu para ler" naquele
 *    lugar. A porta de entrada mostrando erro de servidor faz parecer que o sistema
 *    todo caiu, quando o que caiu foi uma contagem.
 */
import type { Metadata } from 'next';
import { DIAS_DO_PAINEL } from '@/dominio/lojas/painel';
import {
  cartoesDasLojas,
  montarPendencias,
  resumoDaCasa,
  separarCalmas,
} from './inicio/apresentacao';
import { Calmas, Cartoes, Lojas, PergunteAIA, Portas } from './inicio/componentes';
import { lerCasa, lerLojas } from './inicio/dados';
import { numerosDoPainel } from './lojas/apresentacao';
import { Numeros } from './lojas/componentes';
import { formatarDataEHora } from './ui/tempo';
import estilo from './inicio/inicio.module.css';

export const metadata: Metadata = { title: 'Visão geral' };

/** Sempre dinâmica: são números de agora, e pré-renderizar os congelaria. */
export const dynamic = 'force-dynamic';

export default async function Pagina() {
  // Um `agora` para a tela inteira: duas leituras de relógio na mesma renderização
  // podem cair em lados diferentes da virada do dia, e aí a fila do dia e o prazo
  // fiscal contariam dias diferentes lado a lado.
  const agora = new Date();

  const [casa, lojas] = await Promise.all([lerCasa(agora), lerLojas(agora)]);
  const pendencias = montarPendencias(casa);
  const { ativas, calmas } = separarCalmas(pendencias);

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <div className={estilo.linhaDoTitulo}>
          <h1 className={estilo.titulo}>Visão geral</h1>
          {/*
            A hora da leitura, porque estes números são de um instante e a aba fica
            aberta o dia todo.
          */}
          <span className={estilo.lido}>última leitura: {formatarDataEHora(agora)}</span>
        </div>
        <p className={estilo.subtitulo}>
          Todas as lojas somadas, nos últimos {DIAS_DO_PAINEL} dias.
        </p>
      </header>

      <PergunteAIA />

      {lojas === null ? (
        <p className={estilo.avisoDeLeitura} role="status">
          Não deu para ler os números das lojas agora. O resto da tela continua valendo, e o que
          está gravado está gravado.
        </p>
      ) : (
        <>
          <Numeros
            numeros={numerosDoPainel(lojas.total, lojas.totalAnterior, DIAS_DO_PAINEL)}
            titulo={`Todas as lojas nos últimos ${String(DIAS_DO_PAINEL)} dias`}
          />
          <section aria-labelledby="lojas-titulo" className={estilo.secao}>
            <h2 className={estilo.secaoTitulo} id="lojas-titulo">
              Por loja
            </h2>
            <Lojas cartoes={cartoesDasLojas(lojas.lojas)} />
          </section>
        </>
      )}

      <section aria-labelledby="hoje-titulo" className={estilo.secao}>
        <h2 className={estilo.secaoTitulo} id="hoje-titulo">
          O que fazer hoje
        </h2>
        <p className={estilo.secaoSub}>{resumoDaCasa(pendencias)}</p>
        <Cartoes itens={ativas} />
        <Calmas itens={calmas} />
      </section>

      {/*
        O índice fica recolhido porque a lateral já lista as mesmas portas nos mesmos
        grupos, logo ao lado. O que ele tem de próprio é a descrição de cada tela, que
        ensina — então continua aqui, para quem está aprendendo abrir.
      */}
      <details className={estilo.indice}>
        <summary className={estilo.indiceResumo}>O que cada tela faz</summary>
        <p className={estilo.secaoSub}>
          O de cima é o negócio e o que está cobrando você agora. Isto é o que o sistema faz, para
          quando a pergunta é outra.
        </p>
        <Portas />
      </details>
    </main>
  );
}
