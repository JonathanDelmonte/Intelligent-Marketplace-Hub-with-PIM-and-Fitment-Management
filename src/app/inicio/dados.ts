/**
 * As leituras da tela inicial.
 *
 * Cada número vem de um repositório diferente, e **cada leitura falha sozinha**: uma
 * consulta que engasga devolve `null` para aquela linha e não derruba a tela. É a
 * única tela do sistema com essa garantia, e ela é de propósito — a porta de entrada
 * que mostra erro de servidor faz parecer que o sistema todo caiu, quando o que caiu
 * foi uma contagem.
 *
 * A camada é fina por escolha: aqui só há leitura e captura de falha. Quem decide o
 * que é urgente, em que ordem aparece e o que está escrito é `apresentacao.ts`, que
 * tem teste e não toca em banco.
 */
import { lerAmbiente } from '@/config/ambiente';
import { RepositorioDeCompatibilidade } from '@/dominio/compatibilidade/repositorio';
import { RepositorioDeConsignacao } from '@/dominio/consignacao/repositorio';
import { avaliarPrazos, prazoQueImporta } from '@/dominio/fiscal/prazos';
import { RepositorioFiscal } from '@/dominio/fiscal/repositorio';
import { RepositorioDePares } from '@/dominio/identidade/pares';
import { estadoDaLoja } from '@/dominio/lojas/estado';
import { janelasDoPainel, somarPainel, type Painel } from '@/dominio/lojas/painel';
import { RepositorioDeLojas } from '@/dominio/lojas/repositorio';
import { RepositorioDePedidos } from '@/dominio/pedidos/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import { banco } from '@/infra/banco/cliente';
import { Fila } from '@/infra/fila/fila';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import type { LeituraDaLoja, LeiturasDaCasa } from './apresentacao';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'tela_inicial' },
});

/** Nada lido. É o que a tela recebe quando nem o perfil ativo deu para carregar. */
const NADA_LIDO: LeiturasDaCasa = {
  entradasEmRevisao: null,
  paresEsperandoDecisao: null,
  postagem: null,
  compatibilidadeEmRevisao: null,
  consignacaoEmRisco: null,
  produtosSemCodigoFiscal: null,
  prazoFiscal: null,
};

/**
 * Executa uma leitura e devolve `null` se ela falhar, com o erro no log.
 *
 * O nome entra no log porque seis leituras iguais na saída de erro não dizem qual
 * quebrou — e a tela, de propósito, não mostra a mensagem do banco.
 */
async function tentar<T>(nome: string, ler: () => Promise<T>): Promise<T | null> {
  try {
    return await ler();
  } catch (erro) {
    log.erro('inicio.leitura_falhou', { leitura: nome, erro });
    return null;
  }
}

/**
 * Lê o estado da casa.
 *
 * `agora` vem de fora e é lido uma vez por renderização: duas chamadas a `new Date()`
 * podem cair em lados diferentes da virada do dia, e aí a fila do dia e o prazo fiscal
 * contariam dias diferentes na mesma tela.
 */
export async function lerCasa(agora: Date): Promise<LeiturasDaCasa> {
  let db;
  let perfil;
  try {
    db = banco();
    perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
  } catch (erro) {
    // Sem perfil não há o que consultar: toda query operacional é filtrada por ele
    // (ADR 0003). A tela diz que não deu para ler, e as outras continuam abrindo.
    log.erro('inicio.perfil_indisponivel', { erro });
    return NADA_LIDO;
  }

  const [
    entradasEmRevisao,
    paresEsperandoDecisao,
    postagem,
    compatibilidadeEmRevisao,
    consignacaoEmRisco,
    produtosSemCodigoFiscal,
  ] = await Promise.all([
    tentar('entradas_em_revisao', async () => {
      const contagem = await new Fila(db).contagemPorStatus();
      return contagem.pendente_revisao;
    }),
    tentar('pares_esperando_decisao', async () => {
      const contagem = await new RepositorioDePares(db).contarPorStatus();
      return contagem.pendente;
    }),
    tentar('fila_do_dia', async () => {
      const fila = await new RepositorioDePedidos(db).filaDoDia(perfil.id, agora);
      return {
        atrasados: fila.porUrgencia.atrasado,
        hoje: fila.porUrgencia.hoje,
        semPrazo: fila.porUrgencia.sem_prazo,
      };
    }),
    tentar('compatibilidade_em_revisao', async () => {
      const estado = await new RepositorioDeCompatibilidade(db).estado(perfil.id);
      return estado.emRevisao;
    }),
    tentar('consignacao_em_risco', async () => {
      const quadro = await new RepositorioDeConsignacao(db).quadroDeConferencia(perfil.id, {
        agora,
      });
      return quadro.unidadesEmRisco;
    }),
    tentar('produtos_sem_codigo_fiscal', () =>
      new RepositorioFiscal(db).contarPendentes(perfil.id),
    ),
  ]);

  // O prazo fiscal não consulta nada: as datas são constantes do domínio, e o regime
  // já veio com o perfil. Por isso fica fora do `Promise.all` e não pode falhar.
  const prazo = prazoQueImporta(avaliarPrazos({ agora, regime: perfil.regime }));

  return {
    entradasEmRevisao,
    paresEsperandoDecisao,
    postagem,
    compatibilidadeEmRevisao,
    consignacaoEmRisco,
    produtosSemCodigoFiscal,
    prazoFiscal:
      prazo === null ? null : { rotulo: prazo.rotuloCurto, diasRestantes: prazo.diasRestantes },
  };
}

/** As lojas e a soma delas, na janela do painel e na anterior, para comparar. */
export interface LeiturasDasLojas {
  readonly lojas: readonly LeituraDaLoja[];
  readonly total: Painel;
  readonly totalAnterior: Painel;
}

/**
 * Lê os números de cada loja para a visão geral (ADR 0009).
 *
 * Falha como as outras leituras desta tela: sozinha, e para `null`. A tela diz que não
 * deu para ler os números, e o resto dela — o que fazer hoje — continua aparecendo.
 */
export async function lerLojas(agora: Date): Promise<LeiturasDasLojas | null> {
  try {
    const db = banco();
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const repo = new RepositorioDeLojas(db);
    const janelas = janelasDoPainel(agora);
    const [numeros, atuais, anteriores] = await Promise.all([
      repo.numeros(perfil.id),
      repo.somas(perfil.id, janelas.atual),
      repo.somas(perfil.id, janelas.anterior),
    ]);
    return {
      lojas: numeros.map((n) => ({
        plataforma: n.plataforma,
        estado: estadoDaLoja(n),
        painel: somarPainel(atuais.filter((s) => s.plataforma === n.plataforma)),
      })),
      total: somarPainel(atuais),
      totalAnterior: somarPainel(anteriores),
    };
  } catch (erro) {
    log.erro('inicio.lojas_falhou', { erro });
    return null;
  }
}
