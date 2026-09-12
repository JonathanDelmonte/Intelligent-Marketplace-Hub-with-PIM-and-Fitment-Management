/**
 * Limites de tamanho de entrada, em ponto único.
 *
 * Existe porque o mesmo número vive em dois lugares que não se conhecem: o teto
 * do corpo de Server Action, que o Next lê de `next.config.ts` **no build**, e a
 * validação na ação, que roda em runtime. Se os dois divergirem, o arquivo grande
 * é recusado pelo Next com erro genérico antes de a ação poder explicar o que
 * aconteceu — e o sintoma é um formulário que falha sem dizer por quê.
 */

/**
 * Teto de arquivo por formulário.
 *
 * Deliberadamente menor que o teto do armazenamento de conteúdo
 * (`MAX_BYTES`, 32 MB): subir 32 MB por formulário significa manter isso em
 * memória no servidor durante a requisição. Planilha desse tamanho entra pelo
 * caminho de linha de comando, que lê do disco em vez de do corpo de uma
 * requisição.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** O mesmo limite como texto, para a dica do formulário. */
export const MAX_UPLOAD_ROTULO = '8 MB';
