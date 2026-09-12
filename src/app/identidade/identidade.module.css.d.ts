/**
 * Tipos das classes de `identidade.module.css`.
 *
 * Escrito à mão pelo mesmo motivo de `jobs.module.css.d.ts`: a declaração que o Next
 * injeta para `*.module.css` é uma assinatura de índice, e com
 * `noPropertyAccessFromIndexSignature` isso obrigaria `estilo['pagina']` em toda
 * classe — e `estilo['paigna']` compilaria. Com os nomes declarados, erro de
 * digitação de classe vira erro de compilação.
 */
declare const estilo: {
  readonly acoes: string;
  readonly aviso: string;
  readonly avisoAtencao: string;
  readonly avisoCorpo: string;
  readonly avisoErro: string;
  readonly avisoTitulo: string;
  readonly botaoNao: string;
  readonly botaoNeutro: string;
  readonly botaoSecundario: string;
  readonly botaoSim: string;
  readonly cabecalho: string;
  readonly campos: string;
  readonly canonico: string;
  readonly cartao: string;
  readonly cartaoNota: string;
  readonly cartaoNumero: string;
  readonly cartaoRotulo: string;
  readonly citacao: string;
  readonly detalhe: string;
  readonly dica: string;
  readonly evidencia: string;
  readonly fila: string;
  readonly inconsistencias: string;
  readonly lado: string;
  readonly ladoEtiqueta: string;
  readonly ladoTitulo: string;
  readonly lados: string;
  readonly link: string;
  readonly motivo: string;
  readonly pagina: string;
  readonly painel: string;
  readonly par: string;
  readonly parCabecalho: string;
  readonly secao: string;
  readonly secaoTitulo: string;
  readonly subtitulo: string;
  readonly titulo: string;
};

export default estilo;
