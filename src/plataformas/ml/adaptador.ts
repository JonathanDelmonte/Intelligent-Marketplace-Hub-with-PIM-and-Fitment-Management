/**
 * Adaptador do Mercado Livre.
 *
 * A plataforma com mais capacidades e com o único bloqueio confirmado. A
 * descoberta de capacidades reflete o estado da matriz e o fato de haver ou não
 * credencial: sem token, o que é `m3_api` cai para `sem_credencial`, que é
 * diferente de `bloqueado` — no primeiro caso conectar resolve, no segundo não.
 */
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { AdaptadorBase } from '../adaptador-base';
import type { Relogio } from '../adaptador-base';
import type { AnuncioParaExportar, ArquivoParaImportacao } from '../adaptador';
import type { MapaDeCapacidades } from '../adaptador';
import { CAPACIDADES } from '../capacidades';
import type { Capacidade, EstadoDaCapacidade } from '../capacidades';
import { MATRIZ_INICIAL } from '../matriz';
import { centavosParaCampo, montarCsv } from '../csv';

export interface OpcoesAdaptadorMl {
  /** Há credencial OAuth ativa para este perfil? */
  readonly temCredencial: boolean;
  readonly relogio?: Relogio;
}

export class AdaptadorMercadoLivre extends AdaptadorBase {
  override readonly plataforma: Plataforma = 'ml';

  constructor(private readonly opcoes: OpcoesAdaptadorMl) {
    super(opcoes.relogio);
  }

  protected override descobrirCapacidades(): Promise<MapaDeCapacidades> {
    const declarado = MATRIZ_INICIAL.ml;
    const mapa: Partial<Record<Capacidade, EstadoDaCapacidade>> = {};

    for (const capacidade of CAPACIDADES) {
      const estado = declarado[capacidade];
      // Sem token, tudo que depende de API oficial fica sem credencial — e a
      // etiqueta honesta na UI é "sem conexão — importe a planilha".
      mapa[capacidade] =
        !this.opcoes.temCredencial && estado.tipo === 'presumido' && estado.modo === 'm3_api'
          ? { tipo: 'sem_credencial', modo: 'm3_api' }
          : estado;
    }

    return Promise.resolve(mapa as MapaDeCapacidades);
  }

  override exportarParaImportacao(
    anuncios: readonly AnuncioParaExportar[],
  ): Promise<ArquivoParaImportacao> {
    const cabecalho = [
      'Título',
      'Preço',
      'Quantidade',
      'EAN',
      'Categoria',
      'Peso (g)',
      'Descrição',
    ];

    const linhas = anuncios.map((a) => [
      a.tituloInterno,
      centavosParaCampo(a.preco),
      String(a.quantidade),
      a.ean ?? '',
      a.categoria ?? '',
      a.pesoGramas === null ? '' : String(a.pesoGramas),
      a.descricao ?? '',
    ]);

    return Promise.resolve({
      nome: 'anuncios-mercado-livre.csv',
      tipoMime: 'text/csv;charset=utf-8',
      conteudo: montarCsv({ cabecalho, linhas }),
      instrucao:
        'No Mercado Livre: Meus anúncios → Ações em massa → Importar planilha. ' +
        'Confira as colunas obrigatórias da sua categoria antes de subir.',
    });
  }
}
