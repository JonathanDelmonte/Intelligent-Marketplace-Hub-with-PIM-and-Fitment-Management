/**
 * Base comum dos adaptadores.
 *
 * Duas coisas que nenhum adaptador deve reimplementar, porque reimplementar é
 * onde a inconsistência entra:
 *
 * 1. **Lançar `NaoSuportado`.** Todo método que pode não existir passa por
 *    `exigir()`, que consulta o estado real da capacidade. Um adaptador que
 *    esquecesse de verificar tentaria chamar um endpoint bloqueado e devolveria um
 *    erro de rede em vez de um estado de UI.
 * 2. **Cachear `capacidades()` por 24 h.** A descoberta é em runtime, mas fazer
 *    uma sondagem por chamada seria inviável e irritaria a plataforma.
 */
import type { Centavos } from '@/lib/dinheiro';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { NaoSuportado, estaDisponivel } from './capacidades';
import type { Capacidade, EstadoDaCapacidade } from './capacidades';
import type {
  Adaptador,
  AnuncioLido,
  AnuncioParaExportar,
  ArquivoParaImportacao,
  ContextoDeChamada,
  ItemTerceiroLido,
  MapaDeCapacidades,
  PedidoLido,
  TaxasLidas,
} from './adaptador';

/** Validade do cache de capacidades. */
export const VALIDADE_CACHE_CAPACIDADES_MS = 24 * 60 * 60 * 1000;

/** Relógio injetável, para o teste não depender de tempo real. */
export interface Relogio {
  agora(): number;
}

export const relogioDoSistema: Relogio = { agora: () => Date.now() };

export abstract class AdaptadorBase implements Adaptador {
  abstract readonly plataforma: Plataforma;
  abstract readonly comoConectar: string;

  private cache: { readonly mapa: MapaDeCapacidades; readonly em: number } | null = null;

  constructor(protected readonly relogio: Relogio = relogioDoSistema) {}

  /**
   * Descobre o estado de cada capacidade.
   *
   * Implementado por cada adaptador. Pode bater na plataforma, e o resultado é
   * cacheado por `capacidades()`.
   */
  protected abstract descobrirCapacidades(): Promise<MapaDeCapacidades>;

  async capacidades(): Promise<MapaDeCapacidades> {
    const agora = this.relogio.agora();
    if (this.cache !== null && agora - this.cache.em < VALIDADE_CACHE_CAPACIDADES_MS) {
      return this.cache.mapa;
    }
    const mapa = await this.descobrirCapacidades();
    this.cache = { mapa, em: agora };
    return mapa;
  }

  /** Descarta o cache. Usado pela sonda depois de reescrever a matriz. */
  invalidarCacheDeCapacidades(): void {
    this.cache = null;
  }

  /**
   * Garante que a capacidade está disponível, ou lança `NaoSuportado`.
   *
   * Devolve o estado para o chamador saber por qual modo está operando — o que
   * decide qual `fonte` gravar no registro (ADR 0002, regra 2).
   */
  protected async exigir(capacidade: Capacidade): Promise<EstadoDaCapacidade> {
    const mapa = await this.capacidades();
    const estado = mapa[capacidade];
    if (!estaDisponivel(estado)) {
      throw new NaoSuportado(this.plataforma, capacidade, estado);
    }
    return estado;
  }

  // Implementações padrão: tudo não suportado até o adaptador concreto
  // sobrescrever. Um adaptador novo entra funcionando e honesto, em vez de
  // entrar com métodos que estouram com erro de rede.

  async lerAnuncios(_ctx: ContextoDeChamada): Promise<readonly AnuncioLido[]> {
    await this.exigir('ler_anuncios');
    throw new Error(`${this.plataforma}: ler_anuncios declarado mas não implementado`);
  }

  async lerPedidos(_ctx: ContextoDeChamada, _desde: Date): Promise<readonly PedidoLido[]> {
    await this.exigir('ler_pedidos');
    throw new Error(`${this.plataforma}: ler_pedidos declarado mas não implementado`);
  }

  async taxasPara(
    _ctx: ContextoDeChamada,
    _params: { readonly preco: Centavos; readonly categoria: string; readonly pesoGramas: number },
  ): Promise<TaxasLidas> {
    await this.exigir('ler_taxas');
    throw new Error(`${this.plataforma}: ler_taxas declarado mas não implementado`);
  }

  async publicarAnuncio(
    _ctx: ContextoDeChamada,
    _anuncio: AnuncioParaExportar,
  ): Promise<{ idExterno: string }> {
    await this.exigir('publicar_anuncio');
    throw new Error(`${this.plataforma}: publicar_anuncio declarado mas não implementado`);
  }

  async gerarEtiqueta(_ctx: ContextoDeChamada, _pedidoIdExterno: string): Promise<Uint8Array> {
    await this.exigir('gerar_etiqueta');
    throw new Error(`${this.plataforma}: gerar_etiqueta declarado mas não implementado`);
  }

  async buscarTerceiros(
    _ctx: ContextoDeChamada,
    _termo: string,
  ): Promise<readonly ItemTerceiroLido[]> {
    await this.exigir('buscar_terceiros');
    throw new Error(`${this.plataforma}: buscar_terceiros declarado mas não implementado`);
  }

  async lerItemTerceiro(_ctx: ContextoDeChamada, _idOuUrl: string): Promise<ItemTerceiroLido> {
    await this.exigir('ler_item_terceiro');
    throw new Error(`${this.plataforma}: ler_item_terceiro declarado mas não implementado`);
  }

  async responderPergunta(
    _ctx: ContextoDeChamada,
    _perguntaId: string,
    _texto: string,
  ): Promise<void> {
    await this.exigir('responder_pergunta');
    throw new Error(`${this.plataforma}: responder_pergunta declarado mas não implementado`);
  }

  /**
   * Gera o arquivo de importação. **Sempre suportado**, e por isso não passa por
   * `exigir()`: é o piso do ADR 0002, e um adaptador que recusasse isso quebraria
   * a promessa de que o sistema funciona com zero credencial.
   */
  abstract exportarParaImportacao(
    anuncios: readonly AnuncioParaExportar[],
  ): Promise<ArquivoParaImportacao>;
}
