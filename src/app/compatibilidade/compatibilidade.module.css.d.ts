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
  readonly aparelhos: string;
  readonly aviso: string;
  readonly avisoAtencao: string;
  readonly avisoCorpo: string;
  readonly avisoErro: string;
  readonly avisoTitulo: string;
  readonly botao: string;
  readonly botaoNao: string;
  readonly botaoSecundario: string;
  readonly botaoSim: string;
  readonly cabecalho: string;
  readonly campo: string;
  readonly campos: string;
  readonly cartao: string;
  readonly cartaoNota: string;
  readonly cartaoNumero: string;
  readonly cartaoRotulo: string;
  readonly detalhe: string;
  readonly dica: string;
  readonly entrada: string;
  readonly etiqueta: string;
  readonly etiquetaNao: string;
  readonly etiquetaNeutra: string;
  readonly evidencias: string;
  readonly fila: string;
  readonly formulario: string;
  readonly item: string;
  readonly itemCabecalho: string;
  readonly itemSub: string;
  readonly itemTitulo: string;
  readonly legenda: string;
  readonly leituraDoCodigo: string;
  readonly pagina: string;
  readonly painel: string;
  readonly resposta: string;
  readonly retidas: string;
  readonly rolagem: string;
  readonly secao: string;
  readonly secaoTitulo: string;
  readonly situacao: string;
  readonly subtitulo: string;
  readonly tabela: string;
  readonly titulo: string;
  readonly vazio: string;
};
export default estilo;
