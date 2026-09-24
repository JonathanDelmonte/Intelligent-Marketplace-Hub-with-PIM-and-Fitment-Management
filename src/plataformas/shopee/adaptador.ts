/**
 * Adaptador da Shopee.
 *
 * A Open Platform exige aprovação de partner, então por ora tudo entra por M0 e
 * M1 — e a especificação é explícita de que isso é suficiente para o painel ser
 * útil. O adaptador não finge suportar o que não suporta: cada capacidade ausente
 * traz a alternativa manual no rótulo.
 */
import type { Plataforma } from '@/dominio/precificacao/tipos';
import { AdaptadorBase } from '../adaptador-base';
import type { Relogio } from '../adaptador-base';
import type { AnuncioParaExportar, ArquivoParaImportacao, MapaDeCapacidades } from '../adaptador';
import { MATRIZ_INICIAL } from '../matriz';
import { centavosParaCampo, montarCsv } from '../csv';

export class AdaptadorShopee extends AdaptadorBase {
  override readonly plataforma: Plataforma = 'shopee';
  override readonly comoConectar =
    'A integração oficial (Open Platform) exige cadastro de parceiro aprovado pela Shopee. Até sair, os pedidos e os anúncios entram pela planilha do Seller Center.';

  constructor(relogio?: Relogio) {
    super(relogio);
  }

  protected override descobrirCapacidades(): Promise<MapaDeCapacidades> {
    // Nada aqui depende de credencial: M0 e M1 não exigem nenhuma.
    return Promise.resolve(MATRIZ_INICIAL.shopee);
  }

  override exportarParaImportacao(
    anuncios: readonly AnuncioParaExportar[],
  ): Promise<ArquivoParaImportacao> {
    const cabecalho = [
      'Nome do produto',
      'Preço',
      'Estoque',
      'Código do produto',
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
      nome: 'anuncios-shopee.csv',
      tipoMime: 'text/csv;charset=utf-8',
      conteudo: montarCsv({ cabecalho, linhas }),
      instrucao:
        'Na Shopee: Seller Centre → Produtos → Adicionar em massa → Importar. ' +
        'Baixe o modelo da sua categoria e confira a ordem das colunas.',
    });
  }
}
