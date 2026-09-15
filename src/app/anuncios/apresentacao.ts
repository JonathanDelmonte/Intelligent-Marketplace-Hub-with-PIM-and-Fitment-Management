/**
 * Tradução da montagem de anúncio para a tela.
 *
 * Função pura e testada, separada do componente pelo motivo de sempre: o texto que
 * diz "este anúncio não pode ser exportado" muda o que a pessoa faz nos próximos
 * minutos, e isso merece teste.
 */
import type { Conferencia, Exigencia } from '@/dominio/anuncios/atributos';
import type { AvaliacaoDeCatalogo } from '@/dominio/anuncios/catalogo';
import type { TituloGerado } from '@/dominio/anuncios/titulo';
import type { CandidatoAAnuncio } from '@/dominio/anuncios/repositorio';
import { formatarPontosBase } from '@/lib/dinheiro';

export type Tom = 'alerta' | 'atencao' | 'neutro';

/**
 * Tom de cada nível de exigência.
 *
 * `bloqueia` e `devolucao` são os dois alertas, e empatam aqui como empatam no peso:
 * um é anúncio que não existe, o outro é anúncio que existe e volta.
 */
export function tomDaExigencia(exigencia: Exigencia): Tom {
  switch (exigencia) {
    case 'bloqueia':
    case 'devolucao':
      return 'alerta';
    case 'ranqueia':
      return 'atencao';
    case 'ajuda':
      return 'neutro';
  }
}

export const ROTULO_DA_EXIGENCIA: Readonly<Record<Exigencia, string>> = {
  bloqueia: 'impede exportar',
  devolucao: 'gera devolução',
  ranqueia: 'ranqueia pior',
  ajuda: 'ajuda a achar',
};

export function rotuloDaExigencia(exigencia: Exigencia): string {
  return ROTULO_DA_EXIGENCIA[exigencia];
}

/** O nome do atributo como a pessoa o chama, não como a coluna se chama. */
export const ROTULO_DO_ATRIBUTO: Readonly<Record<string, string>> = {
  categoria: 'categoria',
  ean: 'código de barras',
  marca: 'marca',
  peso: 'peso',
  dimensoes: 'dimensões da embalagem',
  descricao: 'descrição',
  compatibilidade: 'onde serve',
  modelo_peca: 'código da peça',
  voltagem: 'voltagem',
  medida: 'medida',
  quantidade_embalagem: 'quantas vêm na embalagem',
};

export function rotuloDoAtributo(atributo: string): string {
  return ROTULO_DO_ATRIBUTO[atributo] ?? atributo.replace(/_/g, ' ');
}

/**
 * A frase de abertura da conferência.
 *
 * Lidera pelo que impede exportar, quando há: é a única categoria em que a pessoa
 * não tem escolha. Sem bloqueio, lidera pelo que gera devolução — que custa mais que
 * ranquear pior, e é o que ela decidiria adiar se a tela não insistisse.
 */
export function resumoDaConferencia(conferencia: Conferencia): string {
  const preenchido = formatarPontosBase(conferencia.preenchimentoBp, 0);

  if (conferencia.bloqueiam.length > 0) {
    const nomes = conferencia.bloqueiam.map((i) => rotuloDoAtributo(i.atributo)).join(', ');
    return `Não dá para exportar ainda: falta ${nomes}. O resto do checklist está ${preenchido} preenchido.`;
  }

  if (conferencia.devolvem.length > 0) {
    const nomes = conferencia.devolvem.map((i) => rotuloDoAtributo(i.atributo)).join(', ');
    return `Dá para exportar, mas falta ${nomes} — e é o que volta como devolução. Checklist ${preenchido} preenchido.`;
  }

  if (conferencia.faltando.length > 0) {
    return `Dá para exportar. Falta ${String(conferencia.faltando.length)} item(ns) que só ranqueiam pior ou ajudam a achar. Checklist ${preenchido} preenchido.`;
  }

  return `Checklist completo para o que este produto é (${conferencia.tracos.join(', ') || 'produto simples'}).`;
}

/** O título com o que ele custou: o que não caiu no limite é busca perdida. */
export function resumoDoTitulo(titulo: TituloGerado): string {
  const tamanho = `${String(titulo.titulo.length)} de ${String(titulo.limite)} caracteres`;
  if (titulo.modelosCortados.length === 0) return `${tamanho}, e todos os modelos couberam.`;
  return `${tamanho}. Ficaram de fora: ${titulo.modelosCortados.join(', ')} — cada modelo fora é uma busca em que o anúncio não aparece. Dois anúncios com três modelos cada alcançam mais gente que um com três de seis.`;
}

/** O alerta de catálogo, quando há. `null` quando não há nada a dizer. */
export function textoDoCatalogo(avaliacao: AvaliacaoDeCatalogo): string | null {
  return avaliacao.mensagem;
}

export function tomDoCatalogo(avaliacao: AvaliacaoDeCatalogo): Tom {
  switch (avaliacao.severidade) {
    case 'vermelho':
      return 'alerta';
    case 'amarelo':
      return 'atencao';
    case 'informativo':
      return 'neutro';
  }
}

/**
 * A linha de cada SKU na lista de escolha.
 *
 * Diz o que falta antes de a pessoa escolher, para ela não montar um anúncio só
 * para descobrir que falta código de barras.
 */
export function descreverCandidato(candidato: CandidatoAAnuncio): string {
  const faltas: string[] = [];
  if (!candidato.temEan) faltas.push('sem código de barras');
  if (!candidato.temCusto) faltas.push('sem custo');
  if (candidato.compatibilidadesPublicaveis === 0) faltas.push('sem modelo publicável');

  if (faltas.length === 0) {
    return `${candidato.titulo} — ${String(candidato.compatibilidadesPublicaveis)} modelo(s) publicável(is)`;
  }
  return `${candidato.titulo} — ${faltas.join(', ')}`;
}

export const CODIGOS_DE_AVISO = ['sku_inexistente', 'parametros'] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

export function descreverAviso(codigo: string | undefined): Aviso | null {
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  switch (codigo as CodigoDeAviso) {
    case 'sku_inexistente':
      return {
        tom: 'atencao',
        titulo: 'Esse produto não está neste perfil',
        corpo: 'Escolha um da lista abaixo. Nada foi montado.',
      };
    case 'parametros':
      return {
        tom: 'atencao',
        titulo: 'Faltou escolher algo',
        corpo:
          'Produto, plataforma e preço são obrigatórios para montar. O preço vai como 89 ou 89,90.',
      };
  }
}

/** O mesmo aviso, a partir da leitura de parâmetros inválidos. */
export function avisoDeCamposInvalidos(campos: readonly string[]): Aviso {
  return {
    tom: 'atencao',
    titulo: 'Escolha que não dá para usar',
    corpo: `Confira: ${campos.join(', ')}. O preço vai como 89 ou 89,90, e a quantidade é inteiro positivo.`,
  };
}
