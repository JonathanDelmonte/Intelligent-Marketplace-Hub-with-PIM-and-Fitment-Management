/**
 * Schema completo, correspondendo à seção 3 da especificação.
 *
 * O corte que organiza os arquivos é o do ADR 0003, e é a decisão de modelagem
 * mais importante do projeto:
 *
 * **Operacional — carrega `perfil_id`.** É de alguém.
 *   `perfil_vendedor`, `credencial`, `sku`, `anuncio`, `pedido`, `consignacao`,
 *   `acumulado_anual`, `leitura`.
 *
 * **Conhecimento do mundo — não carrega `perfil_id`.** É base compartilhada entre
 * perfis, e é o que faz o sistema ficar mais valioso a cada perfil que entra.
 *   `produto_externo`, `preco_historico`, `fornecedor`, `fornecedor_sku`,
 *   `aparelho`, `compatibilidade`, `oportunidade`, `dossie`, `afiliado_oferta`,
 *   `monitor_evento`.
 *
 * **Infraestrutura.** `job`, `llm_call`, `embedding`, `exemplo_identidade`, e as contas
 * de acesso: `usuario` e `sessao` (ADR 0011).
 */
export * from './comum';
export * from './perfil';
export * from './catalogo';
export * from './fornecedores';
export * from './compatibilidade';
export * from './operacao';
export * from './inteligencia';
export * from './infra';
export * from './acesso';
