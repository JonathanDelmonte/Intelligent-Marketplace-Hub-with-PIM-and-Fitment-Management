/**
 * Tipos das classes de `importar.module.css`.
 *
 * Escrito à mão de propósito. A declaração que o Next injeta para
 * `*.module.css` é uma assinatura de índice, e com `noPropertyAccessFromIndexSignature`
 * (ver `tsconfig.json`) isso obrigaria a escrever `estilo['pagina']` em toda
 * classe — e, pior, `estilo['paigna']` compilaria: assinatura de índice aceita
 * qualquer chave e devolve `string | undefined`.
 *
 * Com os nomes declarados, erro de digitação de classe vira erro de compilação.
 * Classe que existe no CSS e falta aqui também — e essa é a direção segura da
 * divergência, porque o contrário (classe declarada que não existe no CSS) só
 * produziria um elemento sem estilo.
 */
declare const estilo: {
  readonly acoesDoTopo: string;
  readonly alternarAuto: string;
  readonly arquivo: string;
  readonly aviso: string;
  readonly avisoAtencao: string;
  readonly avisoCorpo: string;
  readonly avisoErro: string;
  readonly avisoTitulo: string;
  readonly bloco: string;
  readonly blocoNota: string;
  readonly blocoTexto: string;
  readonly blocoTitulo: string;
  readonly blocoTopo: string;
  readonly botao: string;
  readonly botaoSecundario: string;
  readonly cabecalho: string;
  readonly caixaDeErro: string;
  readonly caixaDeRevisao: string;
  readonly caixaTexto: string;
  readonly caixaTitulo: string;
  readonly cartaoDaTabela: string;
  readonly celulaEntrada: string;
  readonly celulaTempo: string;
  readonly codigo: string;
  readonly detalheDaEntrada: string;
  readonly dica: string;
  readonly dicaDaLinha: string;
  readonly entrada: string;
  readonly entradaDeArquivo: string;
  readonly erro: string;
  readonly etiqueta: string;
  readonly ficha: string;
  readonly fichaItem: string;
  readonly fichaRotulo: string;
  readonly fichaValor: string;
  readonly formulario: string;
  readonly linhaDoFormulario: string;
  readonly linkDoJob: string;
  readonly listaDeProblemas: string;
  readonly metrica: string;
  readonly metricaAlerta: string;
  readonly metricas: string;
  readonly motivoDeRevisao: string;
  readonly notaDoBloco: string;
  readonly numero: string;
  readonly pagina: string;
  readonly rejeitada: string;
  readonly rejeitadaCabecalho: string;
  readonly rejeitadaCampo: string;
  readonly rejeitadaCampos: string;
  readonly rejeitadaColuna: string;
  readonly rejeitadaLinha: string;
  readonly rejeitadaMotivo: string;
  readonly rejeitadaValor: string;
  readonly rolagem: string;
  readonly rotuloDoCampo: string;
  readonly situacaoDoJob: string;
  readonly situacaoExplicada: string;
  readonly subtitulo: string;
  readonly tabela: string;
  readonly titulo: string;
  readonly tituloDaEntrada: string;
  readonly topoDaTabela: string;
  readonly vazio: string;
  readonly voltar: string;
};

export default estilo;
