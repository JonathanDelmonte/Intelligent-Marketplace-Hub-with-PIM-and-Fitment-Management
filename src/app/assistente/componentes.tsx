/**
 * As peças da tela do assistente. Nenhuma decide texto: as frases vêm prontas de
 * `apresentacao.ts`, que tem teste.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import {
  SinalAlerta,
  SinalAvancar,
  SinalCaixa,
  SinalCarteira,
  SinalFaisca,
  SinalGrafico,
  SinalMoedas,
  SinalPercentual,
  SinalRelogio,
  SinalSacola,
} from '../ui/sinais';
import {
  O_QUE_EU_RESPONDO,
  type AvisoDoAssistente,
  type LinhaDaResposta,
  type Resposta,
} from './apresentacao';
import { CAMINHO, caminhoDaPronta, PERGUNTAS_PRONTAS, type IdDaPergunta } from './constantes';
import estilo from './assistente.module.css';

/**
 * A caixa da pergunta. Formulário GET, de propósito: a pergunta fica na URL, e a
 * resposta pode ser recarregada, guardada nos favoritos e aberta de novo amanhã, com os
 * números de amanhã.
 */
export function CaixaDePergunta({
  texto,
  loja,
}: {
  readonly texto: string;
  readonly loja: Plataforma | undefined;
}) {
  return (
    <section aria-labelledby="pergunta-titulo" className={estilo.caixa}>
      <div className={estilo.caixaTopo}>
        <span aria-hidden="true" className={estilo.caixaIcone}>
          <SinalFaisca />
        </span>
        <h2 className={estilo.caixaTitulo} id="pergunta-titulo">
          O que você quer saber?
        </h2>
      </div>
      <form action={CAMINHO} className={estilo.caixaLinha} method="get">
        <label className="sr-only" htmlFor="pergunta">
          Sua pergunta
        </label>
        <input
          autoComplete="off"
          className={estilo.campo}
          defaultValue={texto}
          id="pergunta"
          maxLength={300}
          name="pergunta"
          placeholder="Ex.: quanto vendi no Mercado Livre este mês?"
          type="text"
        />
        {loja === undefined ? null : <input name="loja" type="hidden" value={loja} />}
        <button className={estilo.botao} type="submit">
          Perguntar
        </button>
      </form>
    </section>
  );
}

/** O desenho de cada pronta: o que ela responde, num relance. */
const SINAL_DA_PRONTA: Readonly<Record<IdDaPergunta, ReactNode>> = {
  faturamento_por_loja: <SinalMoedas />,
  postar_hoje: <SinalCaixa />,
  margem_por_loja: <SinalPercentual />,
  mais_vendidos: <SinalSacola />,
  vendas_hoje: <SinalRelogio />,
  resumo_do_mes: <SinalGrafico />,
  repasse: <SinalCarteira />,
};

/**
 * As perguntas prontas, num cartão ao lado. Eram cápsulas arredondadas embaixo da caixa;
 * numa lista com o desenho de cada uma, dá para achar a pergunta pelo olho, e o "não
 * usam IA" fica dito uma vez só, no alto.
 */
export function Prontas({ loja }: { readonly loja: Plataforma | undefined }) {
  return (
    <section aria-labelledby="prontas-titulo" className={estilo.bloco}>
      <h2 className={estilo.blocoTitulo} id="prontas-titulo">
        Perguntas prontas
      </h2>
      <p className={estilo.blocoTexto}>Respondem na hora, e nenhuma gasta a cota de IA.</p>
      <ul className={estilo.prontas}>
        {PERGUNTAS_PRONTAS.map((p) => (
          <li key={p.id}>
            <Link className={estilo.pronta} href={caminhoDaPronta(p.id, loja)}>
              <span aria-hidden="true" className={estilo.prontaIcone}>
                {SINAL_DA_PRONTA[p.id]}
              </span>
              <span className={estilo.prontaRotulo}>{p.rotulo}</span>
              <span aria-hidden="true" className={estilo.prontaSeta}>
                <SinalAvancar tamanho={12} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** O que o assistente faz com a pergunta, no pé da coluna do lado. */
export function ComoEuRespondo() {
  return (
    <section aria-labelledby="como-titulo" className={estilo.bloco}>
      <h2 className={estilo.blocoTitulo} id="como-titulo">
        Como eu respondo
      </h2>
      <ol className={estilo.passos}>
        <li>
          Sei responder sobre {O_QUE_EU_RESPONDO} Pergunta sem período é sobre os últimos 30 dias.
        </li>
        <li>
          Primeiro tento entender pelas palavras, sem IA. Só quando não entendo a pergunta ela vai
          para a IA gratuita, que a traduz numa dessas consultas. A IA nunca vê nem calcula número.
        </li>
        <li>
          Os números são os mesmos da área de cada loja e da visão geral: pedidos gravados, por
          planilha ou pela API. Quando a planilha de uma loja para antes do período, a resposta diz
          até quando ela vai.
        </li>
        <li>
          A IA gratuita tem cota. Quando ela acaba, as perguntas prontas e as que eu entendo pelas
          palavras continuam respondendo.
        </li>
      </ol>
    </section>
  );
}

/** Antes da primeira pergunta: o que dá para perguntar, em exemplos. */
export function Comeco() {
  return (
    <section aria-label="Antes da primeira pergunta" className={estilo.comeco}>
      <span aria-hidden="true" className={estilo.comecoIcone}>
        <SinalFaisca tamanho={20} />
      </span>
      <p className={estilo.comecoTitulo}>Faça uma pergunta, ou comece por uma pronta.</p>
      <p className={estilo.comecoTexto}>
        Por exemplo: quanto vendi ontem na Shopee, qual produto mais vendeu este mês, ou qual loja
        deu mais margem nos últimos 90 dias.
      </p>
    </section>
  );
}

function Linha({ linha }: { readonly linha: LinhaDaResposta }) {
  return (
    <li className={estilo.linha}>
      {linha.loja === null ? null : (
        <Selo identidade={IDENTIDADE_DA_LOJA[linha.loja]} tamanho={24} />
      )}
      <span className={estilo.linhaTextos}>
        <span className={estilo.linhaRotulo}>{linha.rotulo}</span>
        {linha.nota === null ? null : <span className={estilo.linhaNota}>{linha.nota}</span>}
      </span>
      <span className={estilo.linhaValor}>{linha.valor}</span>
    </li>
  );
}

/** A pergunta como foi feita, no alto da resposta: é o que dá sentido ao resto. */
function Perguntado({ texto }: { readonly texto: string }) {
  return (
    <p className={estilo.perguntado}>
      <span className="sr-only">Você perguntou: </span>
      {texto}
    </p>
  );
}

export function CartaoDaResposta({
  pergunta,
  resposta,
  rodape,
}: {
  readonly pergunta: string;
  readonly resposta: Resposta;
  readonly rodape: string;
}) {
  return (
    <section aria-labelledby="resposta-titulo" className={estilo.resposta}>
      <Perguntado texto={pergunta} />
      <div className={estilo.corpo}>
        <p className={estilo.entendido}>
          <SinalFaisca tamanho={14} />
          <span>
            Entendi assim: <strong>{resposta.entendido}</strong>
          </span>
        </p>
        <h2 className={estilo.lead} id="resposta-titulo">
          {resposta.lead}
        </h2>
        {resposta.complemento === null ? null : (
          <p className={estilo.complemento}>{resposta.complemento}</p>
        )}

        {resposta.secoes.map((secao, i) => (
          <div className={estilo.secao} key={secao.titulo ?? `secao-${String(i)}`}>
            {secao.titulo === null ? null : <h3 className={estilo.secaoTitulo}>{secao.titulo}</h3>}
            <ul className={estilo.linhas}>
              {secao.linhas.map((linha, j) => (
                // A posição entra na chave: dois pedidos do mesmo produto são duas
                // linhas com o mesmo rótulo, e a lista é montada uma vez, no servidor.
                <Linha key={`${String(j)}-${linha.rotulo}`} linha={linha} />
              ))}
            </ul>
          </div>
        ))}

        {resposta.notas.length === 0 ? null : (
          <ul aria-label="O que falta nestes números" className={estilo.notas}>
            {resposta.notas.map((nota) => (
              <li className={estilo.nota} key={nota}>
                <span aria-hidden="true" className={estilo.notaSinal}>
                  <SinalAlerta tamanho={14} />
                </span>
                {nota}
              </li>
            ))}
          </ul>
        )}

        {resposta.acao === null ? null : (
          <Link className={estilo.acao} href={resposta.acao.href}>
            {resposta.acao.rotulo}
            <SinalAvancar tamanho={12} />
          </Link>
        )}
      </div>
      <p className={estilo.rodape}>{rodape}</p>
    </section>
  );
}

const CLASSE_DO_TOM: Readonly<Record<AvisoDoAssistente['tom'], string>> = {
  neutro: estilo.avisoNeutro,
  atencao: estilo.avisoAtencao,
  erro: estilo.avisoErro,
};

export function SemResposta({
  pergunta,
  aviso,
}: {
  readonly pergunta: string;
  readonly aviso: AvisoDoAssistente;
}) {
  return (
    <section aria-labelledby="resposta-titulo" className={estilo.resposta}>
      <Perguntado texto={pergunta} />
      <div className={`${estilo.corpo} ${CLASSE_DO_TOM[aviso.tom]}`} role="status">
        <h2 className={estilo.avisoTitulo} id="resposta-titulo">
          {aviso.titulo}
        </h2>
        <p className={estilo.avisoCorpo}>{aviso.corpo}</p>
        {aviso.detalhe === null ? null : <p className={estilo.detalhe}>{aviso.detalhe}</p>}
      </div>
    </section>
  );
}
