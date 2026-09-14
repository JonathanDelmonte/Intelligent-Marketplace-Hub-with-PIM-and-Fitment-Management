/**
 * Montagem do anúncio: título, descrição e a linha que vai para o arquivo (M9).
 *
 * O caminho padrão de publicação é **arquivo de importação, não chamada de API**
 * (ADR 0002), e o adaptador de cada plataforma já sabe gerar o arquivo a partir de
 * `AnuncioParaExportar`. O que faltava era quem produz esse objeto a partir do que
 * o sistema sabe — e é este módulo.
 *
 * Função pura: recebe o SKU, a ficha de compatibilidade e o preço já decidido, e
 * devolve o anúncio com os avisos. Não lê banco, não decide preço e não publica.
 * Preço é decisão de M8, e misturar as duas coisas faria um gerador de anúncio
 * capaz de publicar com margem negativa.
 */
import type { Ficha } from '@/dominio/compatibilidade/ficha';
import type { Plataforma } from '@/dominio/precificacao/tipos';
import type { AnuncioParaExportar } from '@/plataformas/adaptador';
import type { Centavos } from '@/lib/dinheiro';
import { gerarDescricao } from './descricao';
import { gerarTituloPara, type TituloGerado } from './titulo';

export interface DadosDoProduto {
  readonly tipoProduto: string;
  readonly marca: string | null;
  readonly modeloPeca: string | null;
  readonly quantidadeEmbalagem: number | null;
  readonly ean: string | null;
  readonly categoria: string | null;
  readonly pesoGramas: number | null;
  /** A ficha de M4. Alimenta o título e a descrição. */
  readonly ficha: Ficha;
  readonly observacoes?: string | null;
}

export interface AnuncioMontado {
  readonly anuncio: AnuncioParaExportar;
  readonly titulo: TituloGerado;
  readonly avisos: readonly string[];
}

export interface ParametrosDaMontagem {
  readonly plataforma: Plataforma;
  /** Preço já decidido por M8. Este módulo não calcula preço. */
  readonly preco: Centavos;
  readonly quantidade: number;
}

/**
 * Monta o anúncio de um produto para uma plataforma.
 *
 * Os modelos que entram no título são só os **publicáveis** da ficha: título é
 * afirmação de compatibilidade na vitrine, e afirmar na vitrine o que está abaixo
 * do corte é o caminho curto para a devolução que a fase 6 existe para evitar.
 */
export function montarAnuncio(
  produto: DadosDoProduto,
  params: ParametrosDaMontagem,
): AnuncioMontado {
  const modelosPublicaveis = produto.ficha.publicaveis.map((l) => l.modelo);

  const titulo = gerarTituloPara(
    {
      tipoProduto: produto.tipoProduto,
      marca: produto.marca,
      modeloPeca: produto.modeloPeca,
      modelosCompativeis: modelosPublicaveis,
      quantidadeEmbalagem: produto.quantidadeEmbalagem,
    },
    params.plataforma,
  );

  const descricao = gerarDescricao({
    tipoProduto: produto.tipoProduto,
    marca: produto.marca,
    modeloPeca: produto.modeloPeca,
    quantidadeEmbalagem: produto.quantidadeEmbalagem,
    ficha: produto.ficha,
    ...(produto.observacoes === undefined ? {} : { observacoes: produto.observacoes }),
  });

  const avisos = [...titulo.avisos, ...descricao.avisos];
  if (produto.ean === null) {
    avisos.push(
      'Sem código de barras: as plataformas pedem GTIN em boa parte das categorias, e sem ele o anúncio pode ser recusado na importação.',
    );
  }
  if (produto.categoria === null) {
    avisos.push('Sem categoria escolhida. A importação em massa exige categoria.');
  }
  if (produto.pesoGramas === null) {
    avisos.push('Sem peso: o frete sai errado, e frete errado come a margem inteira.');
  }
  if (params.quantidade <= 0) {
    avisos.push('Quantidade zero: o anúncio entra pausado.');
  }

  return {
    anuncio: {
      tituloInterno: titulo.titulo,
      preco: params.preco,
      ean: produto.ean,
      categoria: produto.categoria,
      descricao: descricao.texto === '' ? null : descricao.texto,
      pesoGramas: produto.pesoGramas,
      quantidade: params.quantidade,
    },
    titulo,
    avisos,
  };
}
