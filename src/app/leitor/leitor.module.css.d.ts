/**
 * Tipos das classes de `leitor.module.css`.
 *
 * Escrito à mão pela mesma razão do módulo da tela de jobs: a declaração que o
 * Next injeta é assinatura de índice, e com `noPropertyAccessFromIndexSignature`
 * obrigaria `estilo['pagina']` em toda classe — e `estilo['paigna']` compilaria.
 */
declare const estilo: {
  readonly ajuda: string;
  readonly ajudaErro: string;
  readonly alvo: string;
  readonly aviso: string;
  readonly barraDeEstado: string;
  readonly barraDeEstadoAlerta: string;
  readonly botao: string;
  readonly botaoSecundario: string;
  readonly camera: string;
  readonly cameraDesligada: string;
  readonly campo: string;
  readonly campoInvalido: string;
  readonly chamada: string;
  readonly chamadaApoio: string;
  readonly envelopeDaCamera: string;
  readonly etiqueta: string;
  readonly formulario: string;
  readonly grade: string;
  readonly historico: string;
  readonly item: string;
  readonly itemRotulo: string;
  readonly itemValor: string;
  readonly leitura: string;
  readonly leituraCodigo: string;
  readonly leituraDetalhe: string;
  readonly linha: string;
  readonly linhaDeBotoes: string;
  readonly motivo: string;
  readonly motivoAmarelo: string;
  readonly motivoInformativo: string;
  readonly motivoVermelho: string;
  readonly motivos: string;
  readonly numeroDestaque: string;
  readonly pagina: string;
  readonly rotulo: string;
  readonly secao: string;
  readonly subtitulo: string;
  readonly titulo: string;
  readonly tituloDaSecao: string;
  readonly vazio: string;
  readonly veredito: string;
};

export default estilo;
