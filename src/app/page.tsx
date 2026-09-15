/**
 * Tela inicial: o que precisa de você, e depois todas as telas.
 *
 * Começou como o mínimo para o shell do App Router ser verificável na fase 0, virou
 * índice quando as telas passaram de uma, e agora mostra estado — porque índice não
 * responde a pergunta que se faz ao abrir o sistema de manhã. Nove cartões iguais
 * obrigam a abrir nove telas para descobrir que oito não têm nada.
 *
 * Duas garantias desta tela, e as duas são de propósito:
 *
 * 1. **Não tem porta de conexão** (ADR 0002, regra 1). Nenhuma plataforma ligada, e a
 *    tela funciona igual.
 * 2. **Não quebra.** Cada leitura falha sozinha e vira "não deu para ler" naquela
 *    linha. A porta de entrada mostrando erro de servidor faz parecer que o sistema
 *    todo caiu, quando o que caiu foi uma contagem.
 */
import type { Metadata } from 'next';
import { montarPendencias, resumoDaCasa } from './inicio/apresentacao';
import { Pendencias, Portas } from './inicio/componentes';
import { lerCasa } from './inicio/dados';
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

  return (
    <main className={estilo.pagina}>
      <h1 className={estilo.titulo}>O que precisa de você</h1>
      <p className={estilo.subtitulo}>{resumoDaCasa(pendencias)}</p>

      <Pendencias itens={pendencias} />

      <h2 className={estilo.todas}>Todas as telas</h2>
      <Portas />
    </main>
  );
}
