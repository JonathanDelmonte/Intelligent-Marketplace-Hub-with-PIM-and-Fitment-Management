/**
 * Tradução do estado fiscal para a tela.
 *
 * Função pura e testada, separada do componente pelo motivo de sempre: o texto que
 * diz "sua nota vai ser rejeitada em janeiro" muda o que a pessoa faz esta semana, e
 * isso merece teste.
 */
import { ROTULO_DO_CAMPO, type CampoFiscal } from '@/dominio/fiscal/codigos';
import type { RecomendacaoDeEmissor } from '@/dominio/fiscal/emissor';
import type { PrazoAvaliado, UrgenciaDoPrazo } from '@/dominio/fiscal/prazos';
import type { ResumoFiscal } from '@/dominio/fiscal/repositorio';
import type { AvaliacaoDoTeto, SituacaoDoTeto } from '@/dominio/fiscal/teto';
import { formatarBRL, formatarPontosBase } from '@/lib/dinheiro';

export type Tom = 'alerta' | 'atencao' | 'neutro';

export function tomDoPrazo(urgencia: UrgenciaDoPrazo): Tom {
  switch (urgencia) {
    case 'agora':
      return 'alerta';
    case 'este_mes':
      return 'atencao';
    // Prazo vencido fica neutro: ou foi feito, e não é alerta, ou não foi, e o
    // alerta de verdade é a nota rejeitada — não a data no painel.
    case 'passou':
    case 'tem_tempo':
      return 'neutro';
  }
}

export function tomDoTeto(situacao: SituacaoDoTeto): Tom {
  switch (situacao) {
    case 'estourou':
    case 'perto':
      return 'alerta';
    case 'atencao':
      return 'atencao';
    case 'tranquilo':
      return 'neutro';
  }
}

export const ROTULO_DA_SITUACAO: Readonly<Record<SituacaoDoTeto, string>> = {
  tranquilo: 'dentro do teto',
  atencao: 'passou de 70%',
  perto: 'passou de 85%',
  estourou: 'teto estourado',
};

type SituacaoDoEmissor = RecomendacaoDeEmissor['situacao'];

export const ROTULO_DA_SITUACAO_DO_EMISSOR: Readonly<Record<SituacaoDoEmissor, string>> = {
  sem_cnpj: 'sem CNPJ',
  falta_dado: 'falta providenciar',
  pronto: 'pronto para emitir',
};

/**
 * Sem CNPJ fica neutro, e não alerta: pessoa física não emite nota, e o prazo que muda
 * isso já está no painel de prazos — alarmar duas vezes pela mesma data é ruído.
 */
export function tomDoEmissor(situacao: SituacaoDoEmissor): Tom | 'ok' {
  switch (situacao) {
    case 'sem_cnpj':
      return 'neutro';
    case 'falta_dado':
      return 'atencao';
    case 'pronto':
      return 'ok';
  }
}

/** O prazo em palavras de calendário, que é como a pessoa pensa. */
export function prazoEmTexto(prazo: PrazoAvaliado): string {
  const dias = prazo.diasRestantes;
  if (dias < 0) {
    const passados = Math.abs(dias);
    return passados === 1 ? 'foi ontem' : `foi há ${String(passados)} dias`;
  }
  if (dias === 0) return 'é hoje';
  if (dias === 1) return 'é amanhã';
  if (dias < 60) return `faltam ${String(dias)} dias`;
  return `faltam ${String(Math.trunc(dias / 30))} meses`;
}

/** A data no formato que a pessoa lê: `04/01/2027`. */
export function diaEmTexto(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split('-');
  if (ano === undefined || mes === undefined || diaDoMes === undefined) return dia;
  return `${diaDoMes}/${mes}/${ano}`;
}

/**
 * A frase de abertura do teto.
 *
 * Lidera pelo que decide a ação: quanto ainda cabe. O percentual vem depois, porque
 * "83% do teto" não diz se dá para vender mais este mês — e "cabe R$ 13.666 por mês
 * até dezembro" diz.
 */
export function resumoDoTeto(teto: AvaliacaoDoTeto): string {
  const usado = formatarPontosBase(teto.usadoBp, 0);

  if (teto.situacao === 'estourou') {
    return `${formatarBRL(teto.acumulado)} de receita contra um teto de ${formatarBRL(teto.teto)} — ${usado} do teto.`;
  }

  const cabe =
    teto.mediaMensalQueCabe === null
      ? `Restam ${formatarBRL(teto.restante)} até o fim do ano.`
      : `Cabem ${formatarBRL(teto.mediaMensalQueCabe)} por mês até dezembro sem estourar.`;

  return `${cabe} ${formatarBRL(teto.acumulado)} acumulados, ${usado} do teto de ${formatarBRL(teto.teto)}.`;
}

/**
 * A frase de abertura do cadastro.
 *
 * Conta SKU pendente, não SKU total: o número que muda o comportamento é quantos
 * itens ainda impedem a nota de sair.
 */
export function resumoDoCadastro(resumo: ResumoFiscal): string {
  if (resumo.skus.length === 0) {
    return 'Nenhum produto no catálogo ainda. O cadastro fiscal é por item, então ele começa quando o primeiro produto existir.';
  }

  if (resumo.pendentes === 0) {
    // Concorda no singular: "Os 1 produtos ativos estão" apareceu na tela na
    // primeira vez que ela rodou com um produto só, que é o caso de quem começa.
    const quantos =
      resumo.skus.length === 1
        ? 'O único produto ativo está'
        : `Os ${String(resumo.skus.length)} produtos ativos estão`;
    return `${quantos} com NCM, CST e cClassTrib preenchidos. A nota de 2027 sai.`;
  }

  return `${String(resumo.pendentes)} de ${String(resumo.skus.length)} produtos ainda não têm o cadastro fiscal completo. A partir de 04/01/2027, cada um desses é uma nota rejeitada — e nota rejeitada é venda que não pode ser enviada.`;
}

export function rotuloDoCampo(campo: CampoFiscal): string {
  return ROTULO_DO_CAMPO[campo];
}

export const CODIGOS_DE_AVISO = [
  'gravado',
  'formato',
  'sugerido',
  'sem_chave',
  'sem_texto',
  'nao_encontrado',
  'sugestao_falhou',
  'falha',
] as const;
export type CodigoDeAviso = (typeof CODIGOS_DE_AVISO)[number];

export interface Aviso {
  readonly tom: 'ok' | 'atencao' | 'erro';
  readonly titulo: string;
  readonly corpo: string;
}

/** Quanto do motivo da falha a tela mostra. O bastante para agir; o log guarda o resto. */
const MOTIVO_NA_TELA = 300;

/**
 * O aviso de uma ação, pelo código que ela deixou na URL.
 *
 * `motivo` só vale para `sugestao_falhou`: é a frase que o chamador do LLM escreveu —
 * "o OpenRouter recusou a chave", "sem crédito" —, e é a única coisa que diz o que
 * fazer. Sem ela, a tela diria "não deu" e mandaria procurar no log, que é onde quem usa
 * o sistema não vai.
 */
export function descreverAviso(codigo: string | undefined, motivo?: string): Aviso | null {
  if (codigo === undefined) return null;
  if (!(CODIGOS_DE_AVISO as readonly string[]).includes(codigo)) return null;

  switch (codigo as CodigoDeAviso) {
    case 'gravado':
      return {
        tom: 'ok',
        titulo: 'Cadastro gravado',
        corpo:
          'Campo em branco apaga o código que estava lá, o que é útil para corrigir — e some da lista de pendência só quando os três obrigatórios estiverem preenchidos.',
      };
    case 'formato':
      return {
        tom: 'atencao',
        titulo: 'Código fora do formato',
        corpo:
          'NCM tem oito dígitos, CST dois ou três, cClassTrib seis. Ponto e espaço são ignorados, então dá para colar como está na tabela. Nada foi gravado.',
      };
    case 'sugerido':
      return {
        tom: 'ok',
        titulo: 'Sugestão preenchida, ainda não gravada',
        corpo:
          'Os campos vieram preenchidos com a sugestão e a justificativa está abaixo deles. Confira e clique em Gravar — nada foi escrito no produto até você confirmar.',
      };
    case 'sem_chave':
      return {
        tom: 'atencao',
        titulo: 'Ninguém sugeriu',
        corpo:
          'Não há chave de IA configurada (a linha LLM_API_KEY do .env), então a sugestão de NCM não roda. Isso não trava nada: o campo continua preenchível à mão, e o cadastro fica pronto do mesmo jeito.',
      };
    case 'sugestao_falhou': {
      const porque = motivo?.trim().slice(0, MOTIVO_NA_TELA);
      return {
        tom: 'erro',
        titulo: 'A IA não sugeriu',
        corpo:
          porque === undefined || porque === ''
            ? 'A chamada falhou e nada foi alterado. O campo continua preenchível à mão.'
            : `Motivo: ${porque} Nada foi alterado, e o campo continua preenchível à mão.`,
      };
    }
    case 'sem_texto':
      return {
        tom: 'atencao',
        titulo: 'Falta texto para classificar',
        corpo:
          'A sugestão sai do título e dos atributos do produto, e aqui não há texto suficiente. Dê um nome ao produto antes de pedir a sugestão.',
      };
    case 'nao_encontrado':
      return {
        tom: 'atencao',
        titulo: 'Esse produto não está neste perfil',
        corpo: 'A lista abaixo já está atualizada.',
      };
    case 'falha':
      return {
        tom: 'erro',
        titulo: 'Não deu para gravar',
        corpo: 'Nada foi alterado. Tente de novo; se repetir, o log do servidor tem o motivo.',
      };
  }
}
