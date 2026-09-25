#!/usr/bin/env bash
#
# A cópia de segurança (ADR 0010). Roda dentro do contêiner `backup` da composição de
# produção, que usa a mesma imagem do banco — é o que garante um `pg_dump` da mesma
# versão do Postgres.
#
# Todo dia, às 03:00 do horário de Brasília:
#
#   1. o banco inteiro num arquivo só (`pg_dump`, formato próprio, comprimido);
#   2. o armazenamento de conteúdo — as planilhas e os PDFs originais — espelhado em
#      /backups/conteudo. Só acrescenta: o conteúdo é endereçado por hash, e um
#      arquivo guardado nunca muda;
#   3. com BACKUP_NEON_URL, o arquivo do banco restaurado no Neon: uma cópia fora deste
#      servidor, num banco que dá para abrir e conferir;
#   4. as cópias do banco com mais de 7 dias saem.
#
#   backup.sh          espera a hora e copia, para sempre (o comando do contêiner)
#   backup.sh agora    copia na hora e sai (o botão "backup agora" do GitHub)
#
# A cópia de segurança que a restauração faz antes de mexer no banco vem com
# BACKUP_NEON_URL vazio: ela guarda o estado que se está desfazendo, e esse estado não
# pode tomar o lugar da cópia boa que está fora do servidor.

set -euo pipefail

DIAS_GUARDADOS="${BACKUP_DIAS:-7}"
HORA="${BACKUP_HORA:-03:00}"
export PGPASSWORD="${POSTGRES_PASSWORD:?falta POSTGRES_PASSWORD}"

log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

copiar() {
  local arquivo
  # Com segundos: duas cópias no mesmo minuto (a de segurança, antes de uma
  # restauração, e a que vai ser restaurada) teriam o mesmo nome, e a nova apagaria a
  # velha.
  arquivo="/backups/banco-$(date '+%Y-%m-%d_%H%M%S').dump"

  log "backup: copiando o banco para ${arquivo}"
  # Grava com outro nome e renomeia no fim: uma cópia interrompida não pode ficar com
  # cara de cópia boa.
  pg_dump --format=custom --compress=6 --no-owner --file="${arquivo}.parcial"
  mv "${arquivo}.parcial" "${arquivo}"
  log "backup: banco copiado ($(du -h "${arquivo}" | cut -f1))"

  if [[ -d /dados/conteudo ]]; then
    mkdir -p /backups/conteudo
    # `-u` copia só o que falta: o que já está lá tem a mesma data (`-p`), e conteúdo
    # guardado nunca muda.
    cp -r -p -u /dados/conteudo/. /backups/conteudo/
    log "backup: conteúdo espelhado"
  fi

  if [[ -n "${BACKUP_NEON_URL:-}" ]]; then
    log "backup: restaurando a cópia no Neon"
    # A falha aqui não derruba a cópia local, que é a principal: fica no log, e o
    # botão "testar backup" do GitHub mostra.
    if PGOPTIONS='--client-min-messages=warning' psql "${BACKUP_NEON_URL}" -q -v ON_ERROR_STOP=1 \
      -c 'CREATE EXTENSION IF NOT EXISTS vector' \
      -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto' &&
      pg_restore --clean --if-exists --no-owner --no-acl \
        --dbname="${BACKUP_NEON_URL}" "${arquivo}"; then
      log "backup: cópia no Neon atualizada"
    else
      log "backup: AVISO — a cópia no Neon falhou; a cópia local está boa"
    fi
  fi

  find /backups -maxdepth 1 -name 'banco-*.dump' -mtime "+$((DIAS_GUARDADOS - 1))" -print -delete |
    sed 's/^/backup: apagada a cópia velha /'
  log "backup: pronto"
}

if [[ "${1:-}" == "agora" ]]; then
  copiar
  exit 0
fi

# O contêiner para na hora quando a composição desce, em vez de esperar o fim do sono.
trap 'exit 0' TERM INT

while true; do
  agora=$(date +%s)
  alvo=$(date -d "today ${HORA}" +%s)
  if ((alvo <= agora)); then
    alvo=$(date -d "tomorrow ${HORA}" +%s)
  fi
  log "backup: próxima cópia em $(date -d "@${alvo}" '+%d/%m às %H:%M')"
  sleep $((alvo - agora)) &
  wait $!
  # Outro processo, e não uma chamada de função: dentro de `||`, o bash desliga o
  # `set -e` da função inteira, e um `pg_dump` que falhasse seguiria adiante como se
  # tivesse dado certo.
  bash "$0" agora || log "backup: FALHOU — ver as linhas acima"
done
