/**
 * O caminho de uma pergunta: entender, levantar os números, escrever a resposta.
 *
 * Entender tem três portas, na ordem do custo (CLAUDE.md, 3.5 e 3.7): a pergunta pronta,
 * que já vem montada; a regra, que lê as palavras; e a IA gratuita, só quando a regra não
 * entendeu. Depois disso o caminho é um só — o código soma, com as mesmas leituras da área
 * da loja —, e por isso a resposta não depende de quem entendeu a pergunta.
 *
 * Nada aqui lança para a tela. Falha de IA, cota esgotada e banco fora viram um motivo, e
 * a tela diz o que fazer em cada um.
 */
import { lerAmbiente } from '@/config/ambiente';
import { comLojaDoContexto, type Consulta } from '@/dominio/assistente/consulta';
import { entenderPorRegra } from '@/dominio/assistente/entender';
import { traduzirComIa } from '@/dominio/assistente/ia';
import { levantar, type FontesDoAssistente } from '@/dominio/assistente/levantar';
import type { PerfilId } from '@/dominio/catalogo/sku';
import { RepositorioDeLojas } from '@/dominio/lojas/repositorio';
import { RepositorioDePedidos } from '@/dominio/pedidos/repositorio';
import { carregarPerfil } from '@/dominio/perfil';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { banco, type Banco } from '@/infra/banco/cliente';
import { LimiteDoProvedor, OrcamentoEstourado } from '@/infra/llm';
import { llmDoAmbiente } from '@/infra/llm/ambiente';
import { criarRegistrador, nivelDoAmbiente } from '@/infra/log';
import {
  redigirResposta,
  type ComoEntendi,
  type MotivoSemResposta,
  type Resposta,
} from './apresentacao';
import type { PerguntaPronta } from './constantes';

const log = criarRegistrador({
  nivelMinimo: nivelDoAmbiente(process.env['LOG_NIVEL']),
  contexto: { origem: 'assistente' },
});

export interface Pergunta {
  readonly texto: string;
  /** A pronta, quando a pergunta veio de um botão: dispensa regra e IA. */
  readonly pronta: PerguntaPronta | null;
  /** A loja da área de onde se perguntou. */
  readonly loja: Plataforma | undefined;
}

export type Resultado =
  | { readonly tipo: 'resposta'; readonly resposta: Resposta; readonly como: ComoEntendi }
  | { readonly tipo: 'sem_resposta'; readonly motivo: MotivoSemResposta };

type Entendida =
  | { readonly tipo: 'entendida'; readonly consulta: Consulta; readonly como: ComoEntendi }
  | { readonly tipo: 'sem_resposta'; readonly motivo: MotivoSemResposta };

/** As leituras do assistente, ligadas aos repositórios e ao perfil ativo (ADR 0003). */
function fontesDoBanco(db: Banco, perfil: PerfilId, agora: Date): FontesDoAssistente {
  const lojas = new RepositorioDeLojas(db);
  const pedidos = new RepositorioDePedidos(db);
  return {
    numeros: () => lojas.numeros(perfil),
    somas: (janela) => lojas.somas(perfil, janela),
    maisVendidos: (janela, plataforma, limite) =>
      lojas.maisVendidos(perfil, janela, plataforma, limite),
    filaDoDia: (plataforma) => pedidos.filaDoDia(perfil, agora, 200, plataforma),
    repassesDivergentes: (plataforma) => pedidos.divergenciasDeRepasse(perfil, 100, plataforma),
  };
}

async function entender(pergunta: Pergunta, db: Banco): Promise<Entendida> {
  if (pergunta.pronta !== null) {
    return { tipo: 'entendida', consulta: pergunta.pronta.consulta, como: { tipo: 'pronta' } };
  }

  const regra = entenderPorRegra(pergunta.texto);
  if (regra.tipo === 'entendida') {
    return { tipo: 'entendida', consulta: regra.consulta, como: { tipo: 'regra' } };
  }

  // Traduzir texto livre em estrutura é extração: o modelo de extração é o que serve,
  // e o padrão dele é o roteador gratuito. O orçamento é novo a cada pergunta — é o
  // "teto por execução" do ADR 0005, e uma pergunta é uma execução.
  try {
    const { servico, modelos } = llmDoAmbiente(db);
    const traducao = await traduzirComIa(pergunta.texto, {
      llm: servico,
      modelo: modelos.extracao,
    });
    switch (traducao.tipo) {
      case 'entendida':
        return {
          tipo: 'entendida',
          consulta: traducao.consulta,
          como: { tipo: 'ia', deCache: traducao.deCache },
        };
      case 'fora_do_alcance':
        return { tipo: 'sem_resposta', motivo: { tipo: 'fora_do_alcance' } };
      case 'sem_chave':
        return { tipo: 'sem_resposta', motivo: { tipo: 'sem_chave' } };
      case 'falhou':
        log.aviso('assistente.traducao_falhou', { motivo: traducao.motivo });
        return { tipo: 'sem_resposta', motivo: { tipo: 'falha_da_ia', motivo: traducao.motivo } };
    }
  } catch (erro) {
    if (erro instanceof LimiteDoProvedor) {
      return { tipo: 'sem_resposta', motivo: { tipo: 'cota', ate: erro.ate } };
    }
    if (erro instanceof OrcamentoEstourado) {
      return { tipo: 'sem_resposta', motivo: { tipo: 'teto' } };
    }
    log.erro('assistente.traducao_falhou', { erro });
    return {
      tipo: 'sem_resposta',
      motivo: { tipo: 'falha_da_ia', motivo: erro instanceof Error ? erro.message : String(erro) },
    };
  }
}

/**
 * Responde uma pergunta.
 *
 * `agora` vem de fora e é lido uma vez: a janela de "hoje" e a fila do dia precisam cair
 * no mesmo dia.
 */
export async function responder(pergunta: Pergunta, agora: Date): Promise<Resultado> {
  let db: Banco;
  try {
    db = banco();
  } catch (erro) {
    log.erro('assistente.banco_indisponivel', { erro });
    return { tipo: 'sem_resposta', motivo: { tipo: 'leitura' } };
  }

  const entendida = await entender(pergunta, db);
  if (entendida.tipo === 'sem_resposta') return entendida;

  const consulta = comLojaDoContexto(entendida.consulta, pergunta.loja);
  try {
    const perfil = await carregarPerfil(db, lerAmbiente().BANCADA_PERFIL_PADRAO);
    const levantamento = await levantar(consulta, fontesDoBanco(db, perfil.id, agora), agora);
    return {
      tipo: 'resposta',
      resposta: redigirResposta(levantamento, agora),
      como: entendida.como,
    };
  } catch (erro) {
    log.erro('assistente.leitura_falhou', { consulta, erro });
    return { tipo: 'sem_resposta', motivo: { tipo: 'leitura' } };
  }
}
