/**
 * Constantes das contas de acesso (ADR 0011), fora das ações e do proxy.
 *
 * O proxy, as telas e as ações leem daqui, e o teste confere a lista de caminhos
 * públicos: um caminho a mais nela é uma tela do sistema aberta para a internet.
 */

export const COOKIE_DA_SESSAO = 'sessao';

/** Cabeçalho em que o proxy passa a conta conferida para as telas. Nunca vem de fora. */
export const CABECALHO_DA_CONTA = 'x-conta';

export const CAMINHO_DE_ENTRAR = '/entrar';
export const CAMINHO_DE_CADASTRO = '/cadastro';
export const CAMINHO_DE_RECUPERAR = '/recuperar';
export const CAMINHO_DA_SAUDE = '/saude';

/**
 * Os únicos caminhos que abrem sem conta.
 *
 * As três telas de acesso, e a verificação de saúde que a publicação usa — que não
 * mostra dado nenhum, só "funcionando" e a versão.
 */
export const CAMINHOS_PUBLICOS = [
  CAMINHO_DE_ENTRAR,
  CAMINHO_DE_CADASTRO,
  CAMINHO_DE_RECUPERAR,
  CAMINHO_DA_SAUDE,
] as const;

/** Quanto dura uma sessão. Depois disso, entra de novo. */
export const DIAS_DE_SESSAO = 30;
