#!/usr/bin/env bash
#
# O lado do servidor da publicação (ADR 0010). Mora em /opt/hub, junto da composição,
# e é o GitHub Actions quem o chama, por SSH. À mão, só em manutenção.
#
#   publicar.sh trocar <commit> <endereço>   põe no ar a imagem hub:<commit>, já montada
#   publicar.sh diagnostico                  o estado de tudo, sem dado de negócio
#   publicar.sh reiniciar                    reinicia o site e a fila
#   publicar.sh backup-agora                 uma cópia do banco na hora
#   publicar.sh testar-backup                abre a cópia mais nova num banco à parte e conta
#   publicar.sh restaurar <arquivo>          volta o banco para uma cópia — o que veio
#                                            depois dela se perde (antes, uma cópia do agora)
#
# ## O que a troca garante
#
# A versão nova só fica no ar se responder na verificação de saúde com o commit dela.
# Se não responder em dois minutos, a anterior volta, e a publicação termina em erro —
# que é o que faz o GitHub avisar. As migrações rodam antes da troca e só acrescentam
# (CLAUDE.md), então a versão anterior continua funcionando com o banco já migrado.
#
# ## O que nunca sai daqui
#
# O repositório é público, e com ele o log do GitHub Actions. Por isso este arquivo não
# imprime log da aplicação — que pode ter nome e endereço de comprador, vindos de
# planilha de pedidos —, nem segredo nenhum. Imprime estado, contagem e o erro de
# arranque do site, que é onde está o motivo de uma versão não subir.

set -euo pipefail
cd "$(dirname "$0")"

log() { printf '▸ %s\n' "$*"; }
falha() {
  printf '✗ %s\n' "$*" >&2
  exit 1
}

versao_no_ar() { sed -n 's/^VERSAO=//p' .env 2>/dev/null || true; }
site_no_ar() { sed -n 's/^SITE_ENDERECO=//p' .env 2>/dev/null || true; }

escrever_env() {
  printf 'VERSAO=%s\nSITE_ENDERECO=%s\n' "$1" "$2" >.env.novo
  mv .env.novo .env
}

# A senha do banco e a chave mestra nascem aqui, uma vez só, e nunca saem do servidor.
# Nada as sobrescreve: com a senha trocada, o banco que já existe não abriria.
gerar_segredos() {
  umask 077
  if [[ ! -f banco.env ]]; then
    printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 24)" >banco.env
    log "senha do banco gerada (banco.env)"
  fi
  if [[ ! -f app.env ]]; then
    local senha
    senha=$(sed -n 's/^POSTGRES_PASSWORD=//p' banco.env)
    {
      printf 'DATABASE_URL=postgres://hub:%s@banco:5432/hub\n' "${senha}"
      printf 'CREDENCIAL_CHAVE_MESTRA=%s\n' "$(openssl rand -base64 32)"
    } >app.env
    log "chave mestra gerada (app.env)"
  fi
  mkdir -p backups
}

# A resposta da verificação de saúde, de dentro do contêiner do site.
saude() {
  docker compose exec -T web node -e \
    "fetch('http://127.0.0.1:3000/saude').then((r) => r.text()).then(console.log, () => console.log(''))" \
    2>/dev/null || true
}

esperar_saude() {
  local versao="$1" resposta
  for _ in $(seq 1 60); do
    resposta=$(saude)
    if [[ "${resposta}" == *'"funcionando"'* && "${resposta}" == *"\"${versao}\""* ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# O erro de arranque do site, sem o log estruturado da aplicação (as linhas em JSON), que
# é onde dado de negócio poderia aparecer.
erro_de_arranque() {
  docker compose ps web fila >&2 || true
  docker compose logs --no-color --no-log-prefix --tail 60 web 2>/dev/null |
    grep -v '^{' | uniq | tail -25 >&2 || true
}

limpar_imagens() {
  # Imagem sem contêiner há mais de três dias sai, e o cache do build também. A versão no
  # ar está em uso e fica; a anterior fica enquanto for recente — a volta automática
  # acontece na hora da troca, não dias depois.
  docker image prune -a -f --filter 'until=72h' >/dev/null || true
  docker builder prune -f --filter 'until=72h' >/dev/null || true
}

trocar() {
  local novo="${1:?falta o commit}" site="${2:?falta o endereço}"
  [[ "${novo}" =~ ^[0-9a-f]{7,40}$ ]] || falha "commit inválido: ${novo}"
  [[ "${site}" =~ ^[A-Za-z0-9.:/-]+$ ]] || falha "endereço inválido: ${site}"
  docker image inspect "hub:${novo}" >/dev/null 2>&1 ||
    falha "a imagem hub:${novo} não existe — o passo que monta a imagem falhou?"
  [[ -f config.env ]] || falha "falta o config.env, que a publicação envia"
  gerar_segredos

  local anterior
  anterior=$(versao_no_ar)

  # Na primeira publicação ainda não há `.env`, e a composição exige as duas variáveis;
  # daqui até a troca, elas vão pelo ambiente.
  export VERSAO="${novo}" SITE_ENDERECO="${site}"

  log "banco"
  docker compose up -d --wait banco
  log "migrações"
  docker compose run --rm --no-deps -T web node tarefas/migrar.mjs
  log "primeiro perfil (só faz algo na primeira publicação)"
  docker compose run --rm --no-deps -T web node tarefas/semear.mjs

  log "trocando ${anterior:-(nada no ar)} → ${novo}"
  escrever_env "${novo}" "${site}"
  # Subir e responder na mesma condição: um `up` que falha também tem de cair na volta
  # para a versão anterior, e não sair pelo `set -e` com o `.env` já trocado.
  if docker compose up -d --remove-orphans && esperar_saude "${novo}"; then
    log "no ar: ${novo}"
    limpar_imagens
    return 0
  fi

  printf '✗ a versão nova não subiu ou não respondeu em dois minutos\n' >&2
  erro_de_arranque
  if [[ -n "${anterior}" && "${anterior}" != "${novo}" ]]; then
    log "voltando para ${anterior}"
    escrever_env "${anterior}" "${site}"
    export VERSAO="${anterior}"
    if docker compose up -d --remove-orphans && esperar_saude "${anterior}"; then
      log "a versão anterior está no ar de novo"
    else
      printf '✗ a versão anterior também não respondeu\n' >&2
    fi
  fi
  falha "publicação desfeita"
}

diagnostico() {
  echo "== versão no ar"
  versao_no_ar
  echo
  echo "== contêineres"
  docker compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Status}}'
  echo
  echo "== saúde"
  saude
  echo
  echo "== erros da aplicação nas últimas 24 horas (só o nome do evento)"
  docker compose logs --no-color --no-log-prefix --since 24h web fila 2>/dev/null |
    grep '"nivel":"erro"' | grep -o '"evento":"[^"]*"' | sort | uniq -c | sort -rn || true
  echo
  echo "== disco e memória"
  df -h / | tail -1
  free -m | sed -n '1,2p'
  echo
  echo "== docker"
  docker system df
  echo
  echo "== cópias do banco"
  # shellcheck disable=SC2012 # os nomes são os que o backup.sh dá: data e hora, sem espaço
  ls -lh backups/banco-*.dump 2>/dev/null | awk '{print $5, $9}' | tail -8 || echo "nenhuma"
}

reiniciar() {
  docker compose restart web fila
  esperar_saude "$(versao_no_ar)" || {
    erro_de_arranque
    falha "o site não voltou depois de reiniciar"
  }
  log "reiniciado"
}

backup_agora() {
  docker compose run --rm --no-deps -T backup agora
}

# A cópia de antes de uma restauração: só local. Ela guarda o estado que se está
# desfazendo, e não pode tomar o lugar da cópia do Neon.
backup_so_local() {
  docker compose run --rm --no-deps -T -e BACKUP_NEON_URL= backup agora
}

contar() {
  # Contagem, nunca conteúdo: o log é público.
  cat <<'SQL'
select 'contas: ' || count(*) from usuario
union all select 'perfis: ' || count(*) from perfil_vendedor
union all select 'produtos: ' || count(*) from sku
union all select 'pedidos: ' || count(*) from pedido
union all select 'trabalhos da fila: ' || count(*) from job
SQL
}

testar_backup() {
  local arquivo
  # shellcheck disable=SC2012 # os nomes são os que o backup.sh dá: data e hora, sem espaço
  arquivo=$(ls -1t backups/banco-*.dump 2>/dev/null | head -1 || true)
  [[ -n "${arquivo}" ]] || falha "não há cópia em backups/ — rode backup-agora primeiro"
  log "abrindo $(basename "${arquivo}") num banco à parte"
  docker compose exec -T -e PGOPTIONS='--client-min-messages=warning' banco psql -U hub -d hub -q \
    -c 'DROP DATABASE IF EXISTS teste_restauracao' -c 'CREATE DATABASE teste_restauracao'
  docker compose exec -T banco pg_restore -U hub -d teste_restauracao --no-owner <"${arquivo}"
  docker compose exec -T banco psql -U hub -d teste_restauracao -tA <<<"$(contar)"
  docker compose exec -T banco psql -U hub -d hub -q -c 'DROP DATABASE teste_restauracao'
  log "a cópia local abre e tem dados"

  if grep -q '^BACKUP_NEON_URL=.\+' config.env; then
    log "conferindo a cópia no Neon"
    docker compose run --rm --no-deps -T --entrypoint bash backup \
      -c 'psql "$BACKUP_NEON_URL" -tA' <<<"$(contar)"
    log "a cópia no Neon abre e tem dados"
  else
    log "sem BACKUP_NEON_URL: não há cópia fora do servidor"
  fi
}

restaurar() {
  local nome="${1:?falta o nome da cópia}"
  [[ "${nome}" =~ ^banco-[0-9_-]+\.dump$ ]] || falha "nome de cópia inválido: ${nome}"
  [[ -f "backups/${nome}" ]] || falha "a cópia ${nome} não existe em backups/"

  # Restaura de uma cópia particular do arquivo escolhido: a cópia de segurança logo
  # abaixo grava na mesma pasta, e nada que ela faça pode mexer no que vai ser restaurado.
  local restaurando="backups/.restaurando.dump"
  cp "backups/${nome}" "${restaurando}"

  log "antes de tudo, uma cópia do banco como está agora (só neste servidor)"
  backup_so_local
  log "parando o site e a fila"
  docker compose stop web fila
  log "restaurando ${nome}"
  docker compose exec -T banco pg_restore -U hub -d hub --clean --if-exists --no-owner \
    <"${restaurando}"
  rm -f "${restaurando}"
  docker compose exec -T banco psql -U hub -d hub -tA <<<"$(contar)"
  log "subindo o site e a fila"
  docker compose up -d web fila
  esperar_saude "$(versao_no_ar)" || {
    erro_de_arranque
    falha "o site não voltou depois da restauração"
  }
  log "restaurado"
}

comando="${1:-}"
shift || true
case "${comando}" in
trocar) trocar "$@" ;;
diagnostico) diagnostico ;;
reiniciar) reiniciar ;;
backup-agora) backup_agora ;;
testar-backup) testar_backup ;;
restaurar) restaurar "$@" ;;
*) falha "comando desconhecido: '${comando}' — ver o cabeçalho de publicar.sh" ;;
esac
