/**
 * Tradução dos dados do negócio para a tela, e da tela de volta para texto de campo.
 *
 * Função pura e testada, sem banco: o formulário roda no navegador e importa daqui — e o
 * que ele importa vai junto para o cliente.
 */
import { formatarDocumento } from '@/dominio/documento';
import type { DadosDoNegocio } from '@/dominio/perfil/negocio';
import type { Plataforma, RegimeFiscal } from '@/dominio/precificacao/tipos';
import { diaDoCampo } from '@/lib/dia';
import { contagem } from '@/lib/texto';

export const CAMPOS_DO_FORMULARIO = [
  'nome',
  'regime',
  'documento',
  'inscricaoEstadual',
  'uf',
  'abertoEm',
  'certificadoValidoAte',
  'dasMensal',
  'aliquotaSimples',
  'tetoAnual',
] as const;
export type CampoDoFormulario = (typeof CAMPOS_DO_FORMULARIO)[number];

/** O formulário como texto, do jeito que está (ou estava) nos campos. */
export type ValoresDoFormulario = Readonly<Record<CampoDoFormulario, string>>;

/**
 * O que a ação devolve ao formulário.
 *
 * Gravado não aparece aqui: a ação redireciona, e o aviso vem pela URL como nas outras
 * telas. Recusa e falha voltam com os valores digitados, para os campos não se apagarem.
 * `vez` muda a cada resposta e remonta o formulário — campo não controlado só lê o
 * valor inicial na montagem.
 */
export type EstadoDoFormulario =
  | { readonly tipo: 'inicial' }
  | {
      readonly tipo: 'recusado';
      readonly motivo: string;
      readonly valores: ValoresDoFormulario;
      readonly vez: number;
    }
  | { readonly tipo: 'falhou'; readonly valores: ValoresDoFormulario; readonly vez: number };

/** Como cada campo se chama na tela — e na recusa, para ela apontar o lugar. */
export const ROTULO_DO_CAMPO: Readonly<Record<CampoDoFormulario, string>> = {
  nome: 'Nome do negócio',
  regime: 'Regime',
  documento: 'CPF ou CNPJ',
  inscricaoEstadual: 'Inscrição estadual',
  uf: 'Estado',
  abertoEm: 'CNPJ aberto em',
  certificadoValidoAte: 'Certificado válido até',
  dasMensal: 'DAS do mês, em reais',
  aliquotaSimples: 'Alíquota efetiva do Simples, em %',
  tetoAnual: 'Teto de receita do ano, em reais',
};

export const ROTULO_DO_REGIME: Readonly<Record<RegimeFiscal, string>> = {
  cpf: 'Pessoa física (CPF)',
  mei: 'MEI',
  simples: 'Simples Nacional',
};

/** Centavos no campo de texto: `8105` → `81,05`. Vazio quando não há valor. */
export function centavosNoCampo(valor: number | null): string {
  if (valor === null) return '';
  if (valor < 0) return `-${centavosNoCampo(-valor)}`;
  return `${String(Math.trunc(valor / 100))},${String(valor % 100).padStart(2, '0')}`;
}

/**
 * Pontos-base no campo de percentual: `650` → `6,5`; `600` → `6`; `605` → `6,05`.
 *
 * Sem o zero à direita, porque é como se escreve alíquota — e o campo aceita de volta
 * exatamente o que mostra.
 */
export function percentualNoCampo(bp: number | null): string {
  if (bp === null) return '';
  const inteiro = Math.trunc(bp / 100);
  const resto = bp % 100;
  if (resto === 0) return String(inteiro);
  return `${String(inteiro)},${String(resto).padStart(2, '0').replace(/0$/, '')}`;
}

/** O que está gravado, como texto de campo. */
export function valoresGravados(dados: DadosDoNegocio): ValoresDoFormulario {
  return {
    nome: dados.nome,
    regime: dados.regime,
    documento: dados.documento === null ? '' : formatarDocumento(dados.documento),
    inscricaoEstadual: dados.inscricaoEstadual ?? '',
    uf: dados.uf ?? '',
    abertoEm: diaDoCampo(dados.abertoEm),
    certificadoValidoAte: diaDoCampo(dados.certificadoValidoAte),
    dasMensal: centavosNoCampo(dados.dasMensal),
    aliquotaSimples: percentualNoCampo(dados.aliquotaSimplesBp),
    tetoAnual: centavosNoCampo(dados.tetoAnual),
  };
}

/**
 * As vendas do mês numa frase.
 *
 * Zero não é "nada acontece": é "nenhum pedido importado", e a frase diz de onde o
 * número viria — senão a pessoa conclui que o sistema não sabe contar.
 */
export function resumoDasVendas(vendas: Readonly<Record<Plataforma, number>>): string {
  const total = vendas.ml + vendas.shopee + vendas.amazon;
  if (total === 0) {
    return 'Nenhum pedido importado nos últimos 30 dias. O número aparece aqui quando a planilha de pedidos de uma plataforma for importada.';
  }
  return `${contagem(total, 'venda', 'vendas')} nos últimos 30 dias, contadas dos pedidos importados — ninguém precisa digitar.`;
}

export const CODIGOS_DE_AVISO = ['gravado'] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

export function descreverAviso(codigo: string | undefined): Aviso | null {
  if (codigo !== 'gravado') return null;
  return {
    tom: 'ok',
    titulo: 'Dados gravados',
    corpo: 'A margem, o teto do MEI e a recomendação de emissor de nota já usam o que foi gravado.',
  };
}
