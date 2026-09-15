/**
 * Tipos das classes de `comum.module.css`. Escrito à mão pelo mesmo motivo dos
 * outros módulos de estilo: a declaração injetada é assinatura de índice, e nome de
 * classe errado compilaria.
 *
 * Os módulos das telas **compõem** daqui (`composes: ... from ...`) e continuam
 * exportando os próprios nomes, então este arquivo só é importado direto quando um
 * componente precisa de uma peça comum que a tela não redefine.
 */
declare const estilo: {
  readonly aviso: string;
  readonly avisoAtencao: string;
  readonly avisoCorpo: string;
  readonly avisoErro: string;
  readonly avisoTitulo: string;
  readonly botao: string;
  readonly botaoMiudo: string;
  readonly botaoNao: string;
  readonly botaoNeutro: string;
  readonly botaoSim: string;
  readonly botaoSecundario: string;
  readonly cabecalho: string;
  readonly campo: string;
  readonly cartao: string;
  readonly cartaoNota: string;
  readonly cartaoNumero: string;
  readonly cartaoRotulo: string;
  readonly dica: string;
  readonly entrada: string;
  readonly envelopeDaTabela: string;
  readonly etiqueta: string;
  readonly etiquetaAlerta: string;
  readonly etiquetaAtencao: string;
  readonly etiquetaOk: string;
  readonly etiquetaViva: string;
  readonly formulario: string;
  readonly item: string;
  readonly itemAcao: string;
  readonly itemCabecalho: string;
  readonly itemCorpo: string;
  readonly itemFonte: string;
  readonly itemSub: string;
  readonly itemTitulo: string;
  readonly lista: string;
  readonly pagina: string;
  readonly painel: string;
  readonly resumo: string;
  readonly secao: string;
  readonly secaoTitulo: string;
  readonly subtitulo: string;
  readonly tabela: string;
  readonly titulo: string;
  readonly vazio: string;
  readonly vazioCentrado: string;
};

export default estilo;
