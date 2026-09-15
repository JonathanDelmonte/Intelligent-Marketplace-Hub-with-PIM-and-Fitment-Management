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
import { avaliarRegulacao, type AvaliacaoDeRegulacao } from '@/dominio/fiscal/regulada';
import { avisosDaConferencia, conferirAtributos, type Conferencia } from './atributos';
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

  // Campos que só a conferência de atributos lê. Nulos por padrão: o cadastro de
  // hoje não os tem, e é justamente por isso que a conferência existe.
  readonly dimensoesMm?: {
    readonly comprimento: number;
    readonly largura: number;
    readonly altura: number;
  } | null;
  readonly voltagem?: string | null;
  readonly medida?: string | null;

  /**
   * Como o produto é chamado no catálogo, e a marcação de categoria regulada.
   *
   * Entram só para o alerta de M12: anúncio irregular de categoria regulada é
   * **cancelado**, e a hora de saber é antes de publicar, não depois.
   */
  readonly tituloInterno?: string | null;
  readonly categoriaRegulada?: string | null;
}

export interface AnuncioMontado {
  readonly anuncio: AnuncioParaExportar;
  readonly titulo: TituloGerado;
  readonly avisos: readonly string[];
  /**
   * O checklist de 8.3, inteiro.
   *
   * `avisos` continua existindo porque tela que só mostra texto já o usa, mas ele
   * é **derivado** daqui — a lista de o que falta. Quem quer mostrar o que falta
   * *e* o que já está certo lê a conferência.
   */
  readonly conferencia: Conferencia;
  /**
   * Categoria regulada (M12 — 9.6), avaliada aqui e não em tela própria.
   *
   * O alerta só vale antes de publicar, e este é o único lugar por onde tudo que vai
   * ser publicado passa.
   */
  readonly regulacao: AvaliacaoDeRegulacao;
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

  // A conferência de atributo substituiu quatro `if` avulsos que viviam aqui. Os
  // quatro conferiam a mesma coisa de forma mais pobre: sem nível de exigência, sem
  // depender do que o produto é, e sem jeito de a tela mostrar o que **está** certo.
  const conferencia = conferirAtributos({
    tipoProduto: produto.tipoProduto,
    marca: produto.marca,
    modeloPeca: produto.modeloPeca,
    ean: produto.ean,
    categoria: produto.categoria,
    pesoGramas: produto.pesoGramas,
    dimensoesMm: produto.dimensoesMm ?? null,
    descricao: descricao.texto === '' ? null : descricao.texto,
    voltagem: produto.voltagem ?? null,
    medida: produto.medida ?? null,
    quantidadeEmbalagem: produto.quantidadeEmbalagem,
    ficha: produto.ficha,
  });

  // O alerta de categoria regulada entra nos avisos porque publicar irregular é
  // anúncio cancelado — custo maior que qualquer item do checklist de atributos.
  const regulacao = avaliarRegulacao({
    categoriaRegulada: produto.categoriaRegulada ?? null,
    tituloInterno: produto.tituloInterno ?? titulo.titulo,
    tipoProduto: produto.tipoProduto,
  });

  const avisos = [
    ...titulo.avisos,
    ...descricao.avisos,
    ...avisosDaConferencia(conferencia),
    ...(regulacao.mensagem === null ? [] : [regulacao.mensagem]),
  ];

  // Quantidade é do parâmetro, não do produto, então fica fora da conferência: ela
  // confere o cadastro, e isto é a decisão do momento de anunciar.
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
    conferencia,
    regulacao,
  };
}
