/**
 * Capacidades e modos de acesso — a forma executável do ADR 0001.
 *
 * A UI pergunta por **capacidade**, nunca por plataforma. Capacidade que não
 * existe fica desabilitada com rótulo honesto, e nada quebra. É o que impede que
 * o fechamento de um endpoint — como o 403 em `/sites/MLB/search` — vire
 * refatoração de interface.
 */

/**
 * Os cinco modos de acesso da seção 2.1.
 *
 * `m4_extensao` **não está aqui e não vai estar**: extensão de navegador sob
 * login é área cinzenta nos termos de uso das três plataformas, e a punição
 * possível é suspensão da conta — que é o ativo do negócio. O ganho é marginal
 * sobre `m1_planilha`, que é oficial e sem risco. Ver ADR 0008.
 */
export const MODOS_ACESSO = ['m0_link', 'm1_planilha', 'm2_publico', 'm3_api'] as const;
export type ModoAcesso = (typeof MODOS_ACESSO)[number];

export const ROTULO_DO_MODO: Readonly<Record<ModoAcesso, string>> = {
  m0_link: 'colar link',
  m1_planilha: 'importar planilha',
  m2_publico: 'endpoint público',
  m3_api: 'API oficial',
};

/** Um modo exige credencial de conta? Só `m3_api` exige. */
export function modoExigeCredencial(modo: ModoAcesso): boolean {
  return modo === 'm3_api';
}

/**
 * O conjunto fechado de capacidades.
 *
 * Fechado de propósito: capacidade nova é uma decisão de produto, não um efeito
 * colateral de adaptador. Acrescentar uma quebra a compilação de todos os
 * adaptadores até que cada um declare o que faz — que é exatamente o alarme que
 * se quer.
 */
export const CAPACIDADES = [
  'ler_anuncios',
  'ler_pedidos',
  'ler_taxas',
  'publicar_anuncio',
  'gerar_etiqueta',
  'buscar_terceiros',
  'ler_item_terceiro',
  'responder_pergunta',
  'exportar_para_importacao',
] as const;
export type Capacidade = (typeof CAPACIDADES)[number];

export const ROTULO_DA_CAPACIDADE: Readonly<Record<Capacidade, string>> = {
  ler_anuncios: 'ler meus anúncios',
  ler_pedidos: 'ler meus pedidos',
  ler_taxas: 'ler taxas reais por preço',
  publicar_anuncio: 'publicar ou editar anúncio',
  gerar_etiqueta: 'gerar etiqueta de envio',
  buscar_terceiros: 'buscar anúncios de terceiros',
  ler_item_terceiro: 'ler item de terceiro por ID ou URL',
  responder_pergunta: 'responder pergunta de comprador',
  exportar_para_importacao: 'gerar arquivo de importação',
};

/**
 * A única capacidade suportada por contrato em **todo** adaptador.
 *
 * É o piso que garante a regra 3 do ADR 0002: o caminho padrão de publicação é
 * gerar o arquivo de importação da plataforma e o usuário subir. Publicação por
 * API é atalho, nunca requisito — e é isso que faz o sistema funcionar com zero
 * credencial.
 */
export const CAPACIDADE_SEMPRE_SUPORTADA: Capacidade = 'exportar_para_importacao';

/** Estado de uma capacidade numa plataforma, como a sonda apurou. */
export type EstadoDaCapacidade =
  /** Funciona, por este modo. */
  | { readonly tipo: 'disponivel'; readonly modo: ModoAcesso; readonly rotulo: string }
  /**
   * A plataforma responde 403/401 de forma consistente com token válido. É o caso
   * de `/sites/MLB/search`, e é diferente de `sem_credencial`: não adianta
   * conectar conta.
   */
  | { readonly tipo: 'bloqueado'; readonly desde: string | null; readonly evidencia: string }
  /** O modo existiria, mas não há credencial ativa para testar ou usar. */
  | { readonly tipo: 'sem_credencial'; readonly modo: ModoAcesso }
  /** A plataforma simplesmente não oferece isso. Não é erro. */
  | { readonly tipo: 'inexistente'; readonly alternativa: string | null }
  /**
   * Declarado por tabela mas nunca confirmado contra a plataforma.
   *
   * É o estado inicial de tudo, e existir como estado separado é o que impede
   * confundir expectativa com fato — a especificação é explícita: "os valores
   * abaixo são a expectativa, não o resultado".
   */
  | { readonly tipo: 'presumido'; readonly modo: ModoAcesso };

/** A capacidade pode ser usada agora? */
export function estaDisponivel(estado: EstadoDaCapacidade): boolean {
  return estado.tipo === 'disponivel' || estado.tipo === 'presumido';
}

/**
 * Frase que a UI mostra quando a capacidade não está disponível.
 *
 * Existe aqui, e não no componente, para que o texto seja consistente em toda
 * tela e para que nenhum componente precise saber o nome de uma plataforma. A
 * regra 1 do ADR 0002 em forma de função: plataforma não conectada aparece como
 * coluna vazia com etiqueta honesta, nunca como erro.
 */
export function motivoDeIndisponibilidade(estado: EstadoDaCapacidade): string | null {
  switch (estado.tipo) {
    case 'disponivel':
    case 'presumido':
      return null;
    case 'bloqueado':
      return estado.desde === null
        ? 'bloqueado pela plataforma'
        : `bloqueado pela plataforma desde ${estado.desde}`;
    case 'sem_credencial':
      return 'sem conexão — importe a planilha';
    case 'inexistente':
      return estado.alternativa === null
        ? 'a plataforma não oferece isso'
        : `a plataforma não oferece isso — ${estado.alternativa}`;
  }
}

/**
 * Erro lançado por toda chamada de capacidade não suportada.
 *
 * A UI trata isso como **estado normal**, não como falha: é a diferença entre uma
 * coluna vazia com rótulo e uma tela de erro.
 */
export class NaoSuportado extends Error {
  override readonly name = 'NaoSuportado';

  constructor(
    readonly plataforma: string,
    readonly capacidade: Capacidade,
    readonly estado: EstadoDaCapacidade,
  ) {
    const motivo = motivoDeIndisponibilidade(estado) ?? 'indisponível';
    super(`${plataforma} não suporta "${ROTULO_DA_CAPACIDADE[capacidade]}": ${motivo}`);
  }
}

/** `NaoSuportado` é estado esperado, e distinguir isso de falha real importa. */
export function ehNaoSuportado(erro: unknown): erro is NaoSuportado {
  return erro instanceof NaoSuportado;
}
