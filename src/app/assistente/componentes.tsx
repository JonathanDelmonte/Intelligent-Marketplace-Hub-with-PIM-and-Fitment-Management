/**
 * As peças da tela do assistente. Nenhuma decide texto: as frases vêm prontas de
 * `apresentacao.ts`, que tem teste.
 */
import Link from 'next/link';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { IconeDaPorta } from '../icones';
import { IDENTIDADE_DA_LOJA } from '../lojas/identidade';
import { Selo } from '../lojas/selo';
import type { AvisoDoAssistente, LinhaDaResposta, Resposta } from './apresentacao';
import { CAMINHO, caminhoDaPronta, PERGUNTAS_PRONTAS } from './constantes';
import estilo from './assistente.module.css';

/**
 * A caixa da pergunta. Formulário GET, de propósito: a pergunta fica na URL, e a
 * resposta pode ser recarregada, guardada nos favoritos e aberta de novo amanhã — com os
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
    <form action={CAMINHO} className={estilo.caixa} method="get">
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
  );
}

export function Prontas({ loja }: { readonly loja: Plataforma | undefined }) {
  return (
    <ul aria-label="Perguntas prontas" className={estilo.prontas}>
      {PERGUNTAS_PRONTAS.map((p) => (
        <li key={p.id}>
          <Link className={estilo.pronta} href={caminhoDaPronta(p.id, loja)}>
            {p.rotulo}
          </Link>
        </li>
      ))}
    </ul>
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

/** A pergunta como foi feita, no alto da resposta — é o que dá sentido ao resto. */
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
          <IconeDaPorta nome="assistente" tamanho={16} />
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
              <li key={nota}>{nota}</li>
            ))}
          </ul>
        )}

        {resposta.acao === null ? null : (
          <Link className={estilo.acao} href={resposta.acao.href}>
            {resposta.acao.rotulo}
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
