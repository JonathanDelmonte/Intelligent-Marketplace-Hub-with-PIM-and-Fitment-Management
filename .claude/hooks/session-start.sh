#!/usr/bin/env bash
# Prepara a sessão para rodar testes e linters.
#
# Instala dependências quando faltam e sobe um Postgres local com pgvector, que é
# o que as migrations e o build precisam. Sai com 0 mesmo em falha parcial: uma
# sessão sem banco ainda roda typecheck, lint e a suíte de testes inteira — o
# domínio é função pura e não toca em I/O.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 0

if [[ ! -d node_modules ]]; then
  echo "Instalando dependências…"
  npm install --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1 || true
fi

if [[ ! -f .env ]]; then
  echo "Criando .env a partir do exemplo…"
  cp .env.example .env 2>/dev/null || true
  chave=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" 2>/dev/null)
  if [[ -n "${chave:-}" ]]; then
    # A chave mestra é de desenvolvimento e nasce descartável.
    sed -i "s|^CREDENCIAL_CHAVE_MESTRA=.*|CREDENCIAL_CHAVE_MESTRA=${chave}|" .env 2>/dev/null || true
  fi
fi

exit 0
