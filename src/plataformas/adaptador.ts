/**
 * Contrato do adaptador — a seção 2.4 da especificação.
 *
 * Um adaptador por plataforma. Todos implementam a mesma interface, e o que não
 * existe lança `NaoSuportado`. Nenhum código de domínio conhece o nome de uma
 * plataforma: ele pede uma capacidade, e o registro resolve quem atende.
 */
import type { Centavos } from '@/lib/dinheiro';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { Fonte } from '@/dominio/procedencia';
import type { Capacidade, EstadoDaCapacidade } from './capacidades';

/** Anúncio como a plataforma o descreve, antes de virar `anuncio` no banco. */
export interface AnuncioLido {
  readonly idExterno: string;
  readonly titulo: string;
  readonly preco: Centavos;
  readonly url: string | null;
  readonly ativo: boolean;
  readonly ean: string | null;
  readonly fonte: Fonte;
}

export interface PedidoLido {
  readonly idExterno: string;
  readonly data: Date;
  readonly qtd: number;
  readonly precoBruto: Centavos;
  readonly taxaComissao: Centavos | null;
  readonly taxaFixa: Centavos | null;
  readonly fretePago: Centavos | null;
  readonly repasseLiquido: Centavos | null;
  readonly idAnuncioExterno: string | null;
  readonly statusEnvio: string | null;
  readonly rastreio: string | null;
  readonly fonte: Fonte;
}

/** Taxas reais para um preço, quando a plataforma as expõe. */
export interface TaxasLidas {
  readonly comissao: Centavos;
  readonly taxaFixa: Centavos;
  readonly fonte: Fonte;
  readonly lidoEm: Date;
}

export interface ItemTerceiroLido {
  readonly idExterno: string;
  readonly titulo: string;
  readonly preco: Centavos | null;
  readonly vendedor: string | null;
  readonly vendasEstimadas: number | null;
  readonly atributos: Readonly<Record<string, unknown>>;
  readonly url: string;
  readonly fonte: Fonte;
}

/** Arquivo gerado para o usuário subir no painel da plataforma. */
export interface ArquivoParaImportacao {
  readonly nome: string;
  readonly tipoMime: string;
  readonly conteudo: Uint8Array;
  /** Instrução de onde subir, porque cada plataforma tem um lugar diferente. */
  readonly instrucao: string;
}

/** Dados suficientes para uma linha do arquivo de importação. */
export interface AnuncioParaExportar {
  readonly tituloInterno: string;
  readonly preco: Centavos;
  readonly ean: string | null;
  readonly categoria: string | null;
  readonly descricao: string | null;
  readonly pesoGramas: number | null;
  readonly quantidade: number;
}

export interface ContextoDeChamada {
  /** Perfil dono da operação. Toda chamada operacional exige um. */
  readonly perfilId: string;
  /** Token decifrado, quando a chamada usa `m3_api`. */
  readonly token?: string;
}

/**
 * O contrato.
 *
 * `capacidades()` é descoberto em runtime e cacheado, não é constante compilada:
 * política de plataforma muda sem aviso, e a verdade é o que a API respondeu hoje.
 *
 * `exportarParaImportacao` é a única sem `NaoSuportado` na assinatura conceitual:
 * é suportada por contrato em todo adaptador, e é o piso que garante a regra de
 * degradação do ADR 0002.
 */
export interface Adaptador {
  readonly plataforma: Plataforma;

  /** Estado de cada capacidade. Descoberto em runtime, cacheado por 24 h. */
  capacidades(): Promise<MapaDeCapacidades>;

  lerAnuncios(ctx: ContextoDeChamada): Promise<readonly AnuncioLido[]>;
  lerPedidos(ctx: ContextoDeChamada, desde: Date): Promise<readonly PedidoLido[]>;
  taxasPara(
    ctx: ContextoDeChamada,
    params: { readonly preco: Centavos; readonly categoria: string; readonly pesoGramas: number },
  ): Promise<TaxasLidas>;
  publicarAnuncio(
    ctx: ContextoDeChamada,
    anuncio: AnuncioParaExportar,
  ): Promise<{ idExterno: string }>;
  gerarEtiqueta(ctx: ContextoDeChamada, pedidoIdExterno: string): Promise<Uint8Array>;
  buscarTerceiros(ctx: ContextoDeChamada, termo: string): Promise<readonly ItemTerceiroLido[]>;
  lerItemTerceiro(ctx: ContextoDeChamada, idOuUrl: string): Promise<ItemTerceiroLido>;
  responderPergunta(ctx: ContextoDeChamada, perguntaId: string, texto: string): Promise<void>;

  /** Sempre suportado. Ver `CAPACIDADE_SEMPRE_SUPORTADA`. */
  exportarParaImportacao(anuncios: readonly AnuncioParaExportar[]): Promise<ArquivoParaImportacao>;
}

export type MapaDeCapacidades = Readonly<Record<Capacidade, EstadoDaCapacidade>>;
