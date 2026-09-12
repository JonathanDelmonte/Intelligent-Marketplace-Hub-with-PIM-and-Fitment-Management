/**
 * Adaptador da Amazon.
 *
 * A SP-API exige plano profissional e registro de developer, e o volume ainda não
 * justifica a burocracia. Até lá, M0 e M1.
 *
 * O arquivo de importação sai em TSV, não CSV, porque é o que o fluxo de upload em
 * massa da Amazon espera.
 */
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { AdaptadorBase } from '../adaptador-base';
import type { Relogio } from '../adaptador-base';
import type { AnuncioParaExportar, ArquivoParaImportacao, MapaDeCapacidades } from '../adaptador';
import { MATRIZ_INICIAL } from '../matriz';
import { centavosParaCampo } from '../csv';

export class AdaptadorAmazon extends AdaptadorBase {
  override readonly plataforma: Plataforma = 'amazon';

  constructor(relogio?: Relogio) {
    super(relogio);
  }

  protected override descobrirCapacidades(): Promise<MapaDeCapacidades> {
    return Promise.resolve(MATRIZ_INICIAL.amazon);
  }

  override exportarParaImportacao(
    anuncios: readonly AnuncioParaExportar[],
  ): Promise<ArquivoParaImportacao> {
    const cabecalho = [
      'item_name',
      'standard_price',
      'quantity',
      'external_product_id',
      'recommended_browse_nodes',
      'item_weight',
      'product_description',
    ];

    // Tabulação como separador: o campo não pode conter tabulação nem quebra de
    // linha, então elas são trocadas por espaço em vez de escapadas — o
    // carregador da Amazon não interpreta aspas como o CSV interpreta.
    const limpar = (v: string) => v.replaceAll(/[\t\r\n]+/g, ' ').trim();

    const linhas = anuncios.map((a) =>
      [
        limpar(a.tituloInterno),
        centavosParaCampo(a.preco),
        String(a.quantidade),
        a.ean ?? '',
        a.categoria ?? '',
        a.pesoGramas === null ? '' : String(a.pesoGramas),
        limpar(a.descricao ?? ''),
      ].join('\t'),
    );

    const texto = `${[cabecalho.join('\t'), ...linhas].join('\r\n')}\r\n`;

    return Promise.resolve({
      nome: 'anuncios-amazon.txt',
      tipoMime: 'text/tab-separated-values;charset=utf-8',
      conteudo: new TextEncoder().encode(texto),
      instrucao:
        'Na Amazon: Seller Central → Catálogo → Adicionar produtos via upload. ' +
        'Use o modelo da categoria e cole estas colunas no lugar certo.',
    });
  }
}
