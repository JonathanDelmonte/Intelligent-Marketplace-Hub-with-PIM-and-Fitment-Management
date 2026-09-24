/**
 * Tela inicial: o que precisa de você, e depois todas as telas.
 *
 * Começou como o mínimo para o shell do App Router ser verificável na fase 0, virou
 * índice quando as telas passaram de uma, passou a mostrar estado quando nove cartões
 * iguais obrigavam a abrir nove telas para descobrir que oito não tinham nada, e em
 * 16/09 ganhou o desenho novo — cartão com gravidade, pílula por momento de trabalho, e
 * o que está zerado recolhido em uma linha. O porquê de cada forma está no cabeçalho de
 * `inicio.module.css`.
 *
 * Duas garantias desta tela, e as duas são de propósito:
 *
 * 1. **Não tem porta de conexão** (ADR 0002, regra 1). Nenhuma plataforma ligada, e a
 *    tela funciona igual.
 * 2. **Não quebra.** Cada leitura falha sozinha e vira "não deu para ler" naquele
 *    cartão. A porta de entrada mostrando erro de servidor faz parecer que o sistema
 *    todo caiu, quando o que caiu foi uma contagem.
 */
import type { Metadata } from 'next';
import { montarPendencias, resumoDaCasa, separarCalmas } from './inicio/apresentacao';
import { Calmas, Cartoes, Portas } from './inicio/componentes';
import { lerCasa } from './inicio/dados';
import { formatarDataEHora } from './ui/tempo';
import estilo from './inicio/inicio.module.css';

export const metadata: Metadata = { title: 'Início' };

/** Sempre dinâmica: são contagens de agora, e pré-renderizar as congelaria. */
export const dynamic = 'force-dynamic';

export default async function Pagina() {
  // Um `agora` para a tela inteira: duas leituras de relógio na mesma renderização
  // podem cair em lados diferentes da virada do dia, e aí a fila do dia e o prazo
  // fiscal contariam dias diferentes lado a lado.
  const agora = new Date();

  const pendencias = montarPendencias(await lerCasa(agora));

  const { ativas, calmas } = separarCalmas(pendencias);

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <div className={estilo.linhaDoTitulo}>
          <h1 className={estilo.titulo}>O que precisa de você</h1>
          {/*
            A hora da leitura, porque estes números são de um instante e a aba fica
            aberta o dia todo. "Nada esperando você" às 18h pode ser a verdade das 8h.
          */}
          <span className={estilo.lido}>última leitura: {formatarDataEHora(agora)}</span>
        </div>
        <p className={estilo.subtitulo}>{resumoDaCasa(pendencias)}</p>
      </header>

      <Cartoes itens={ativas} />
      <Calmas itens={calmas} />

      {/*
        O índice fica recolhido porque a lateral já lista as mesmas quinze portas nos
        mesmos quatro grupos, logo ao lado. O que ele tem de próprio é a descrição de cada
        tela, que ensina — então continua aqui, para quem está aprendendo abrir.
      */}
      <details className={estilo.indice}>
        <summary className={estilo.indiceResumo}>O que cada tela faz</summary>
        <p className={estilo.secaoSub}>
          O de cima é o que está cobrando você agora. Isto é o que o sistema faz, para quando a
          pergunta é outra.
        </p>
        <Portas />
      </details>
    </main>
  );
}
