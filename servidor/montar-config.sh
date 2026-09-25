#!/usr/bin/env bash
#
# Monta o `config.env` do servidor (ADR 0010) e escreve na saída padrão. Roda no GitHub
# Actions, que passa os segredos e as variáveis do repositório como variáveis de
# ambiente, com o mesmo nome que o sistema lê.
#
# Duas listas, e a separação é o ponto:
#
# - PADROES: comportamento e marca. Vêm da variável do GitHub quando ela existe, e do
#   `.env.example` quando não — o mesmo padrão que quem roda no computador recebe.
# - SO_DO_GITHUB: segredo e opcional. Só entram se estiverem no GitHub.
#
# O que é do computador de quem desenvolve (endereço do banco, pastas) não está em
# lista nenhuma e nunca vai para o servidor: lá o banco e as pastas são da composição.

set -euo pipefail
cd "$(dirname "$0")/.."

PADROES=(
  BANCADA_NOME_SISTEMA
  BANCADA_CONSTRUTOR
  BANCADA_ANO_COPYRIGHT
  BANCADA_PAPEL
  BANCADA_PERFIL_PADRAO
  LLM_ORCAMENTO_PADRAO_CENTAVOS
  LLM_COTACAO_DOLAR_CENTAVOS
  EXTRACAO_USER_AGENT
  EXTRACAO_RPS_MAX
  LOG_NIVEL
)

SO_DO_GITHUB=(
  CADASTRO_CODIGO
  LLM_API_KEY
  LLM_MODELO_EXTRACAO
  LLM_MODELO_JULGAMENTO
  LLM_MODELO_EMBEDDING
  LLM_MODELO_FISCAL
  LLM_MODELO_VISAO
  AFILIADO_TAG_ML
  AFILIADO_TAG_SHOPEE
  AFILIADO_TAG_AMAZON
  BACKUP_NEON_URL
)

# Entre aspas simples o valor vai literal para o contêiner: nem `$`, nem `#`, nem
# espaço mudam o que ele é. Aspas simples e quebra de linha não cabem nesse formato, e
# o erro diz qual chave — nunca o valor, que pode ser segredo.
linha() {
  local chave="$1" valor="$2"
  if [[ "${valor}" == *"'"* || "${valor}" == *$'\n'* ]]; then
    echo "::error::${chave} tem aspas simples ou quebra de linha, que o arquivo de ambiente não guarda" >&2
    exit 1
  fi
  printf "%s='%s'\n" "${chave}" "${valor}"
}

for chave in "${PADROES[@]}"; do
  valor="${!chave:-}"
  if [[ -z "${valor}" ]]; then
    valor=$(sed -n "s/^${chave}=//p" .env.example | head -1)
  fi
  if [[ -n "${valor}" ]]; then
    linha "${chave}" "${valor}"
  fi
done

for chave in "${SO_DO_GITHUB[@]}"; do
  valor="${!chave:-}"
  if [[ -n "${valor}" ]]; then
    linha "${chave}" "${valor}"
  fi
done
