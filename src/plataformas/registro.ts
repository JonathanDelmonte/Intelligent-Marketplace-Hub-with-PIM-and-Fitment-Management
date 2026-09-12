/**
 * Registro de adaptadores.
 *
 * É o único lugar do sistema que conhece as três plataformas por nome. Todo o
 * resto pergunta por capacidade: `quemSuporta('ler_taxas')` em vez de
 * `if (plataforma === 'ml')`.
 *
 * É essa indireção que faz o fechamento de um endpoint degradar uma coluna da
 * tela em vez de exigir um `if` novo em cada chamada (ADR 0001).
 */
import { PLATAFORMAS } from '@/dominio/precificacao/tipos';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { Fonte } from '@/dominio/procedencia';
import type { Adaptador, MapaDeCapacidades } from './adaptador';
import { estaDisponivel } from './capacidades';
import type { Capacidade, EstadoDaCapacidade, ModoAcesso } from './capacidades';
import { AdaptadorAmazon } from './amazon/adaptador';
import { AdaptadorMercadoLivre } from './ml/adaptador';
import { AdaptadorShopee } from './shopee/adaptador';

/** Uma plataforma e o estado de uma capacidade nela. */
export interface OfertaDeCapacidade {
  readonly plataforma: Plataforma;
  readonly adaptador: Adaptador;
  readonly estado: EstadoDaCapacidade;
}

export class Registro {
  private readonly adaptadores: ReadonlyMap<Plataforma, Adaptador>;

  constructor(adaptadores: readonly Adaptador[]) {
    const mapa = new Map<Plataforma, Adaptador>();
    for (const adaptador of adaptadores) {
      if (mapa.has(adaptador.plataforma)) {
        throw new Error(`dois adaptadores para a mesma plataforma: ${adaptador.plataforma}`);
      }
      mapa.set(adaptador.plataforma, adaptador);
    }
    this.adaptadores = mapa;
  }

  /** Todas as plataformas registradas, na ordem canônica do domínio. */
  plataformas(): readonly Plataforma[] {
    return PLATAFORMAS.filter((p) => this.adaptadores.has(p));
  }

  de(plataforma: Plataforma): Adaptador {
    const adaptador = this.adaptadores.get(plataforma);
    if (adaptador === undefined) {
      throw new Error(`nenhum adaptador registrado para ${plataforma}`);
    }
    return adaptador;
  }

  /**
   * Quem atende uma capacidade, agora.
   *
   * Devolve só o que está realmente disponível, em ordem de plataforma. Uma tela
   * que precisa de `ler_taxas` chama isto e usa a primeira resposta; se a lista
   * vier vazia, mostra o estado honesto em vez de um erro.
   */
  async quemSuporta(capacidade: Capacidade): Promise<readonly OfertaDeCapacidade[]> {
    const ofertas = await this.estadoDe(capacidade);
    return ofertas.filter((o) => estaDisponivel(o.estado));
  }

  /** O estado de uma capacidade em **todas** as plataformas, disponível ou não. */
  async estadoDe(capacidade: Capacidade): Promise<readonly OfertaDeCapacidade[]> {
    const resultados = await Promise.all(
      this.plataformas().map(async (plataforma) => {
        const adaptador = this.de(plataforma);
        const mapa = await adaptador.capacidades();
        return { plataforma, adaptador, estado: mapa[capacidade] };
      }),
    );
    return resultados;
  }

  /** A matriz inteira, para a tela de diagnóstico e para a sonda. */
  async matriz(): Promise<Readonly<Record<Plataforma, MapaDeCapacidades>>> {
    const entradas = await Promise.all(
      this.plataformas().map(async (p) => [p, await this.de(p).capacidades()] as const),
    );
    return Object.fromEntries(entradas) as Readonly<Record<Plataforma, MapaDeCapacidades>>;
  }
}

/**
 * Converte o modo de acesso na `fonte` que o registro deve gravar.
 *
 * Existe para não haver dois vocabulários. `ModoAcesso` descreve **como** se
 * chegou ao dado; `Fonte` descreve **de onde** o dado veio, e é o que entra na
 * regra de precedência do ADR 0002. São os mesmos nomes de propósito, e esta
 * função é o ponto único onde a correspondência é afirmada.
 */
export function fonteDoModo(modo: ModoAcesso): Fonte {
  return modo;
}

/**
 * Monta o registro padrão.
 *
 * `perfisComCredencial` diz para quais plataformas existe credencial ativa. Sem
 * isso o adaptador do ML anunciaria capacidades de API que não tem como usar, e a
 * UI mostraria um botão que falha ao ser clicado.
 */
export function registroPadrao(params: {
  readonly plataformasComCredencial: readonly Plataforma[];
}): Registro {
  const tem = (p: Plataforma) => params.plataformasComCredencial.includes(p);

  return new Registro([
    new AdaptadorMercadoLivre({ temCredencial: tem('ml') }),
    new AdaptadorShopee(),
    new AdaptadorAmazon(),
  ]);
}
