#!/usr/bin/env bash
# Único caminho suportado para commitar neste repositório.
#
# Fixa o autor em Jonathan Delmonte <jonathanpdelmon@gmail.com> e repassa todos
# os argumentos para `git commit`. Ver CLAUDE.md, seção 1.
set -euo pipefail

GIT_AUTHOR_NAME="Jonathan Delmonte" \
GIT_AUTHOR_EMAIL="jonathanpdelmon@gmail.com" \
exec git commit "$@"
