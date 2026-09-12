/**
 * Base pública de GTIN — a porta, e a honestidade sobre o que existe atrás dela.
 *
 * A especificação pede, na etapa 4.4, "fallback de base pública de GTIN para
 * descrição e NCM": quando a plataforma não responde, o código de barras ainda
 * deveria virar descrição e classificação fiscal.
 *
 * ## Nenhum provedor vem configurado, e isso é resultado, não pendência
 *
 * O levantamento, para o nicho deste sistema:
 *
 * - **Cosmos (Bluesoft)** resolve GTIN para descrição, marca **e NCM**, que é
 *   exatamente o que a etapa pede. Exige token de conta.
 * - **Open Food Facts** é livre e sem token, e cobre alimento e higiene. Não
 *   cobre refil de purificador nem autopeça, que é o nicho — e não tem NCM.
 * - **UPCitemdb** tem faixa de teste sem token, com limite baixo por dia, sem NCM
 *   e com cobertura fraca de produto brasileiro.
 *
 * Ou seja: **não existe base pública, gratuita e sem credencial que devolva NCM
 * de GTIN brasileiro.** Cadastrar um endpoint aqui e sair chamando seria inventar
 * capacidade — o mesmo erro que a sonda de capacidades (etapa 2.5) evita ao
 * relatar `sem_credencial` em vez de fingir que testou.
 *
 * Então este arquivo entrega a porta, a declaração de capacidade e o caminho de
 * cache. Ligar a Cosmos é cadastrar uma credencial e escrever trinta linhas de
 * adaptador — o desenho já espera por isso.
 *
 * ## O resultado não é uma tabela nova
 *
 * Descrição vinda de base pública é captura de `produto_externo` com
 * `fonte: 'm2_publico'`. As regras de procedência que já existem fazem o resto:
 * dado `m2_publico` nunca sobrescreve o que veio de planilha ou foi digitado à
 * mão, e o cache é a própria linha gravada. Base pública é só mais uma fonte
 * alimentando a mesma base de conhecimento.
 */
import type { Gtin } from '@/dominio/gtin';
import { motivoDeIndisponibilidade, type EstadoDaCapacidade } from '@/plataformas/capacidades';

/** O que uma base de GTIN devolve, quando devolve. */
export interface FichaDeGtin {
  readonly gtin: string;
  readonly descricao: string | null;
  readonly marca: string | null;
  /** Classificação fiscal, que é o campo que mais falta e o mais difícil de achar. */
  readonly ncm: string | null;
  readonly pesoGramas: number | null;
  /** Identificador do provedor, para auditoria. */
  readonly provedor: string;
}

/**
 * Uma base pública de GTIN.
 *
 * Mesma forma dos adaptadores de plataforma: declara o que suporta e lança
 * `NaoSuportado` para o que não suporta, em vez de devolver vazio — porque vazio
 * e "não sei" são coisas diferentes, e a tela precisa distinguir.
 */
export interface BaseDeGtin {
  readonly nome: string;
  /** Estado da consulta por GTIN. A UI mostra isto quando não dá para consultar. */
  estadoDaConsulta(): EstadoDaCapacidade;
  /** `null` quando o provedor respondeu e não conhece o código. */
  consultar(gtin: Gtin): Promise<FichaDeGtin | null>;
}

/**
 * Erro de base de GTIN indisponível.
 *
 * Classe própria, e não o `NaoSuportado` das plataformas, por uma razão de
 * fronteira: `Capacidade` é o enum da **matriz de plataformas**, que a sonda
 * percorre plataforma por plataforma. Base pública de GTIN não é plataforma de
 * venda, e enfiá-la naquele enum faria a matriz crescer uma linha que a sonda não
 * sabe testar.
 *
 * O que se compartilha é o vocabulário de **estado** — `EstadoDaCapacidade` e a
 * frase de indisponibilidade — que é genérico e é onde estava o valor.
 */
export class BaseDeGtinIndisponivel extends Error {
  override readonly name = 'BaseDeGtinIndisponivel';

  constructor(
    readonly provedor: string,
    readonly estado: EstadoDaCapacidade,
  ) {
    super(`base de GTIN "${provedor}": ${motivoDeIndisponibilidade(estado) ?? 'indisponível'}`);
  }
}

/**
 * A base que existe quando nenhuma está configurada.
 *
 * Não devolve vazio e não lança erro genérico: lança `BaseDeGtinIndisponivel` com
 * o estado `sem_credencial`, que a UI já sabe traduzir em rótulo honesto. A tela
 * mostra "sem base de GTIN configurada" e segue funcionando com a evidência que
 * tem na própria base — o que a regra 1 do ADR 0002 exige.
 */
export class BaseDeGtinAusente implements BaseDeGtin {
  readonly nome = 'nenhuma';

  estadoDaConsulta(): EstadoDaCapacidade {
    return { tipo: 'sem_credencial', modo: 'm2_publico' };
  }

  consultar(_gtin: Gtin): Promise<FichaDeGtin | null> {
    return Promise.reject(new BaseDeGtinIndisponivel(this.nome, this.estadoDaConsulta()));
  }
}

/**
 * Resolve a ficha de um GTIN sem nunca lançar por indisponibilidade.
 *
 * É o que a tela chama. Distingue três desfechos, e a distinção é o ponto:
 * `achou` (o provedor conhece), `desconhecido` (o provedor respondeu e não
 * conhece) e `indisponivel` (não há como perguntar). Colapsar os dois últimos em
 * "não achei" faria a pessoa procurar um produto que talvez exista.
 */
export type ResultadoDaFicha =
  | { readonly tipo: 'achou'; readonly ficha: FichaDeGtin }
  | { readonly tipo: 'desconhecido'; readonly provedor: string }
  | { readonly tipo: 'indisponivel'; readonly motivo: string };

export async function resolverFicha(base: BaseDeGtin, gtin: Gtin): Promise<ResultadoDaFicha> {
  const estado = base.estadoDaConsulta();
  if (estado.tipo !== 'disponivel' && estado.tipo !== 'presumido') {
    return {
      tipo: 'indisponivel',
      motivo:
        estado.tipo === 'sem_credencial'
          ? 'nenhuma base de GTIN configurada'
          : `base de GTIN indisponível (${estado.tipo})`,
    };
  }

  try {
    const ficha = await base.consultar(gtin);
    return ficha === null
      ? { tipo: 'desconhecido', provedor: base.nome }
      : { tipo: 'achou', ficha };
  } catch (erro) {
    // Falha de rede é indisponibilidade, não ausência de produto. A pessoa está
    // numa loja com sinal ruim: dizer "não existe" seria mentira útil para
    // ninguém.
    return {
      tipo: 'indisponivel',
      motivo: erro instanceof Error ? erro.message : 'falha ao consultar a base',
    };
  }
}
