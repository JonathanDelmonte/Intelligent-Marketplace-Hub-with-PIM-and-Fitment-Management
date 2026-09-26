'use client';

/**
 * Restaurar uma cópia pela tela (ADR 0017), como num produto pronto: escolher o arquivo,
 * ver o que ele tem, confirmar.
 *
 * A conferência é aqui, no computador de quem usa, sem mandar um byte: de quando é a
 * cópia, de que versão, quantas tabelas e linhas, e se ela chegou inteira. É o que deixa
 * a pessoa saber que escolheu o arquivo certo antes de trocar os dados — e recusa o
 * download interrompido sem subir nada. O servidor confere tudo de novo: a conferência
 * daqui é para quem restaura, não para o servidor confiar.
 *
 * O envio é o arquivo cru, com o cabeçalho que só esta tela manda, para a rota que o lê
 * enquanto chega (`copia/restaurar/route.ts`). Fechar a aba no meio é seguro: a
 * restauração é uma transação só, e o que não chegou inteiro não muda nada.
 */
import { useRouter } from 'next/navigation';
import { useId, useState, type ChangeEvent } from 'react';
import {
  CopiaInvalida,
  conferirCopia,
  linhasDoArquivo,
  type ResumoDaCopia,
} from '@/infra/banco/formato-da-copia';
import { avisoDaRestauracao, descreverCopia, type AvisoDaRestauracao } from './apresentacao';
import { CABECALHO_DE_RESTAURAR, CAMINHO_DA_RESTAURACAO } from './constantes';
import estilo from './copia.module.css';

type Etapa =
  | { readonly tipo: 'escolher' }
  | { readonly tipo: 'conferindo'; readonly nome: string }
  | { readonly tipo: 'conferida'; readonly arquivo: File; readonly resumo: ResumoDaCopia }
  | { readonly tipo: 'invalida'; readonly motivo: string }
  | { readonly tipo: 'restaurando'; readonly resumo: ResumoDaCopia }
  | { readonly tipo: 'terminou'; readonly aviso: AvisoDaRestauracao };

const CLASSE_DO_AVISO: Readonly<Record<AvisoDaRestauracao['tipo'], string>> = {
  ok: estilo.aviso,
  atencao: estilo.avisoAtencao,
  erro: estilo.avisoErro,
};

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function RestaurarCopia() {
  const router = useRouter();
  const idDoArquivo = useId();
  const idDaConfirmacao = useId();
  const [etapa, setEtapa] = useState<Etapa>({ tipo: 'escolher' });
  const [entendi, setEntendi] = useState(false);

  async function escolher(evento: ChangeEvent<HTMLInputElement>) {
    const arquivo = evento.target.files?.[0];
    setEntendi(false);
    if (arquivo === undefined) {
      setEtapa({ tipo: 'escolher' });
      return;
    }
    setEtapa({ tipo: 'conferindo', nome: arquivo.name });
    try {
      const resumo = await conferirCopia(linhasDoArquivo(arquivo.stream()));
      setEtapa({ tipo: 'conferida', arquivo, resumo });
    } catch (erro) {
      setEtapa({
        tipo: 'invalida',
        motivo:
          erro instanceof CopiaInvalida
            ? primeiraMaiuscula(erro.message)
            : 'O arquivo não pôde ser lido. Confira se é a cópia baixada nesta tela.',
      });
    }
  }

  async function restaurar() {
    if (etapa.tipo !== 'conferida' || !entendi) return;
    setEtapa({ tipo: 'restaurando', resumo: etapa.resumo });
    let aviso: AvisoDaRestauracao;
    try {
      const resposta = await fetch(CAMINHO_DA_RESTAURACAO, {
        method: 'POST',
        headers: {
          [CABECALHO_DE_RESTAURAR]: 'sim',
          'Content-Type': 'application/octet-stream',
        },
        body: etapa.arquivo,
      });
      aviso = avisoDaRestauracao(await resposta.json().catch(() => null));
    } catch {
      aviso = {
        tipo: 'erro',
        titulo: 'A conexão caiu durante a restauração',
        corpo:
          'Se ela não chegou ao fim, nada mudou: a restauração é feita numa vez só. Confira os dados nas outras telas e tente de novo.',
      };
    }
    setEntendi(false);
    setEtapa({ tipo: 'terminou', aviso });
    // Os dados mudaram: a tela, e o que o navegador guardou dela, precisam ser lidos de novo.
    if (aviso.tipo !== 'erro') router.refresh();
  }

  const ocupado = etapa.tipo === 'conferindo' || etapa.tipo === 'restaurando';

  return (
    <div className={estilo.restaurar}>
      <div className={estilo.campo}>
        <label htmlFor={idDoArquivo}>Arquivo da cópia — o que termina em .sql.gz</label>
        <input
          accept=".gz,.sql,application/gzip"
          className={estilo.arquivo}
          disabled={ocupado}
          id={idDoArquivo}
          onChange={(evento) => void escolher(evento)}
          type="file"
        />
      </div>

      {etapa.tipo === 'conferindo' && (
        <p className={estilo.dica} role="status">
          Conferindo {etapa.nome} no seu computador…
        </p>
      )}

      {etapa.tipo === 'invalida' && (
        <div className={estilo.avisoErro} role="alert">
          <div className={estilo.avisoTitulo}>Este arquivo não serve para restaurar</div>
          <p className={estilo.avisoCorpo}>{etapa.motivo}</p>
        </div>
      )}

      {etapa.tipo === 'conferida' && (
        <div className={estilo.confirmacao}>
          <p className={estilo.resumoDaCopia}>
            <strong>{descreverCopia(etapa.resumo)}.</strong> O arquivo está inteiro.
          </p>
          <label className={estilo.caixa} htmlFor={idDaConfirmacao}>
            <input
              checked={entendi}
              id={idDaConfirmacao}
              onChange={(evento) => setEntendi(evento.target.checked)}
              type="checkbox"
            />
            Entendo que todos os dados de agora serão trocados pelos desta cópia.
          </label>
          <button
            className={estilo.botaoDeAcao}
            disabled={!entendi}
            onClick={() => void restaurar()}
            type="button"
          >
            Restaurar esta cópia
          </button>
        </div>
      )}

      {etapa.tipo === 'restaurando' && (
        <p className={estilo.dica} role="status">
          Restaurando — {descreverCopia(etapa.resumo)}. Numa cópia grande, leva alguns minutos.
        </p>
      )}

      {etapa.tipo === 'terminou' && (
        <div className={CLASSE_DO_AVISO[etapa.aviso.tipo]} role="status">
          <div className={estilo.avisoTitulo}>{etapa.aviso.titulo}</div>
          <p className={estilo.avisoCorpo}>{etapa.aviso.corpo}</p>
        </div>
      )}
    </div>
  );
}
