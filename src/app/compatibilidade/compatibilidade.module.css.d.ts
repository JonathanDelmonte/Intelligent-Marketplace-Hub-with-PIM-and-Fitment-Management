/**
 * Tipos das classes de `compatibilidade.module.css`.
 *
 * Escrito à mão pelo mesmo motivo dos outros módulos de estilo: a declaração que o
 * Next injeta para `*.module.css` é uma assinatura de índice, e com
 * `noPropertyAccessFromIndexSignature` isso obrigaria `estilo['pagina']` em toda
 * classe — e `estilo['paigna']` compilaria. Com os nomes declarados, erro de
 * digitação de classe vira erro de compilação.
 */
declare const estilo: {
  readonly acoes: string;
  readonly aparelhoNome: string;
  readonly aparelhos: string;
  readonly aparelhoTipo: string;
  readonly aviso: string;
  readonly avisoAtencao: string;
  readonly avisoCorpo: string;
  readonly avisoErro: string;
  readonly avisoTitulo: string;
  readonly baixar: string;
  readonly bloco: string;
  readonly blocoNota: string;
  readonly blocoTexto: string;
  readonly blocoTitulo: string;
  readonly blocoTopo: string;
  readonly botao: string;
  readonly botaoBaixar: string;
  readonly botaoNao: string;
  readonly botaoSecundario: string;
  readonly botaoSim: string;
  readonly cabecalho: string;
  readonly campo: string;
  readonly campoLargo: string;
  readonly campos: string;
  readonly coluna: string;
  readonly detalhe: string;
  readonly dica: string;
  readonly entrada: string;
  readonly escolha: string;
  readonly etiqueta: string;
  readonly etiquetaNao: string;
  readonly etiquetaNeutra: string;
  readonly evidencias: string;
  readonly fila: string;
  readonly formulario: string;
  readonly grade: string;
  readonly item: string;
  readonly itemCabecalho: string;
  readonly itemSub: string;
  readonly itemTitulo: string;
  readonly leituraDoCodigo: string;
  readonly pagina: string;
  readonly resposta: string;
  readonly retidas: string;
  readonly rolagem: string;
  readonly situacao: string;
  readonly subtitulo: string;
  readonly tabela: string;
  readonly titulo: string;
  readonly trechoFonte: string;
  readonly trechos: string;
  readonly vazio: string;
};

export default estilo;
