/**
 * Tipos das classes de `jobs.module.css`.
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
  readonly acoesDaSecao: string;
  readonly alternarAuto: string;
  readonly aviso: string;
  readonly avisoAtencao: string;
  readonly avisoCorpo: string;
  readonly avisoErro: string;
  readonly avisoTitulo: string;
  readonly botao: string;
  readonly botaoSecundario: string;
  readonly campo: string;
  readonly cartao: string;
  readonly cartaoExplicacao: string;
  readonly cartaoNumero: string;
  readonly cartaoRotulo: string;
  readonly celulaEntrada: string;
  readonly celulaTempo: string;
  readonly contadorDoTitulo: string;
  readonly detalheDaEntrada: string;
  readonly dica: string;
  readonly envelopeDaTabela: string;
  readonly erro: string;
  readonly etiqueta: string;
  readonly formulario: string;
  readonly linhaDoFormulario: string;
  readonly metrica: string;
  readonly metricaAlerta: string;
  readonly mono: string;
  readonly motivoDeRevisao: string;
  readonly numero: string;
  readonly pagina: string;
  readonly painel: string;
  readonly secao: string;
  readonly subtitulo: string;
  readonly tabela: string;
  readonly titulo: string;
  readonly tituloDaEntrada: string;
  readonly tituloDaSecao: string;
  readonly vazio: string;
};

export default estilo;
