/**
 * Assistente IA (ADR 0009): pergunta em português, resposta com número de verdade.
 *
 * A pergunta chega pela URL — `?pergunta=`, `?pronta=` e, da área de uma loja, `?loja=`
 * —, e a resposta é montada no servidor, a cada abertura. Não há conversa guardada: a
 * mesma URL amanhã responde com os números de amanhã, que é o que se quer de "quanto
 * vendi este mês".
 *
 * A regra que segura a tela é do ADR: **o número nunca sai da IA.** Ela, quando entra, só
 * traduz a pergunta numa consulta de uma lista fechada; quem soma é o código, com as
 * leituras da área da loja. A resposta mostra como a pergunta foi entendida, para o
 * engano de leitura aparecer na hora, e diz o que falta nos números.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { TAMANHO_MAXIMO_DA_PERGUNTA } from '@/dominio/assistente/ia';
import { ehPlataforma, type Plataforma } from '@/dominio/precificacao/tipos';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import { naLoja } from '../ui/rotulos';
import { avisoSemResposta, O_QUE_EU_RESPONDO, textoDeComoEntendi } from './apresentacao';
import { CaixaDePergunta, CartaoDaResposta, Prontas, SemResposta } from './componentes';
import { CAMINHO, lerPronta } from './constantes';
import { responder } from './dados';
import estilo from './assistente.module.css';

export const metadata: Metadata = { title: 'Assistente IA' };

/** Sempre dinâmica: a resposta é de agora. */
export const dynamic = 'force-dynamic';

function primeiro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

function lerLoja(valor: string | string[] | undefined): Plataforma | undefined {
  const texto = primeiro(valor);
  return ehPlataforma(texto) ? texto : undefined;
}

/** A pergunta digitada, aparada e cortada no tamanho de uma pergunta. */
function lerPergunta(valor: string | string[] | undefined): string {
  return (primeiro(valor) ?? '').trim().slice(0, TAMANHO_MAXIMO_DA_PERGUNTA);
}

export default async function PaginaDoAssistente({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const busca = await searchParams;
  const loja = lerLoja(busca['loja']);
  const pronta = lerPronta(busca['pronta']);
  const texto = pronta?.pergunta ?? lerPergunta(busca['pergunta']);

  // Um `agora` para a resposta inteira: a janela de "hoje" e a fila do dia contam o
  // mesmo dia.
  const agora = new Date();
  const resultado = texto === '' ? null : await responder({ texto, pronta, loja }, agora);

  return (
    <main className={estilo.pagina}>
      <header className={estilo.cabecalho}>
        <h1 className={estilo.titulo}>Assistente IA</h1>
        <p className={estilo.subtitulo}>
          Pergunte em português sobre as suas lojas. Quem soma é o sistema; a IA, quando entra, só
          entende a pergunta.
        </p>
        {loja === undefined ? null : (
          <p className={estilo.contexto}>
            <Selo identidade={IDENTIDADE_DA_LOJA[loja]} tamanho={20} />
            <span>
              Perguntando {naLoja(loja)}: pergunta sem loja é sobre ela.{' '}
              <Link href={CAMINHO}>Perguntar sobre todas</Link>
            </span>
          </p>
        )}
      </header>

      <CaixaDePergunta loja={loja} texto={texto} />
      <Prontas loja={loja} />

      {resultado === null ? (
        <p className={estilo.vazio}>
          Faça uma pergunta, ou comece por uma pronta — as prontas respondem na hora e não usam IA.
        </p>
      ) : resultado.tipo === 'resposta' ? (
        <CartaoDaResposta
          pergunta={texto}
          resposta={resultado.resposta}
          rodape={textoDeComoEntendi(resultado.como)}
        />
      ) : (
        <SemResposta aviso={avisoSemResposta(resultado.motivo, agora)} pergunta={texto} />
      )}

      <details className={estilo.como}>
        <summary className={estilo.comoResumo}>Como eu respondo</summary>
        <ul className={estilo.comoLista}>
          <li>
            Eu sei responder sobre {O_QUE_EU_RESPONDO} Pergunta sem período é sobre os últimos 30
            dias.
          </li>
          <li>
            Primeiro tento entender pelas palavras, sem IA. Só quando não entendo a pergunta vai
            para a IA gratuita, que a traduz numa dessas consultas — ela nunca vê nem calcula
            número.
          </li>
          <li>
            Os números são os mesmos da área de cada loja e da visão geral: pedidos gravados, por
            planilha ou pela API. Quando a planilha de uma loja para antes do período, a resposta
            diz até quando ela vai.
          </li>
          <li>
            A IA gratuita tem cota. Quando ela acaba, as perguntas prontas e as que eu entendo pelas
            palavras continuam respondendo.
          </li>
        </ul>
      </details>
    </main>
  );
}
