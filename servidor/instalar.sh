#!/usr/bin/env bash
#
# Prepara o servidor (ADR 0010): uma máquina Ubuntu nova vira um lugar onde o sistema
# roda. Quem chama é a publicação, pelo SSH, com `sudo`, a cada push — e por isso cada
# passo confere antes de mexer: na máquina já pronta, nada muda e leva um segundo.
#
# Pensado para a imagem Ubuntu da Oracle (usuário `ubuntu`, com `sudo` sem senha), e
# serve a qualquer Ubuntu 22.04 ou mais novo.
#
#   1. fuso de São Paulo
#   2. Docker, do repositório oficial, com teto de log
#   3. a pasta /opt/hub, do usuário `ubuntu`
#   4. as portas 80 e 443 abertas no firewall da própria máquina
#   5. 2 GB de swap, se não houver nenhum
#   6. atualização automática de segurança, reiniciando às 04:30 quando precisar
#   7. fail2ban, que bloqueia quem erra a senha do SSH em sequência

set -euo pipefail

USUARIO="${SUDO_USER:-ubuntu}"
PASTA=/opt/hub

log() { printf '▸ %s\n' "$*"; }

[[ "$(id -u)" == 0 ]] || {
  echo "rode com sudo" >&2
  exit 1
}

export DEBIAN_FRONTEND=noninteractive

# ── 1. fuso ────────────────────────────────────────────────────────────────────
com_systemd() { command -v systemctl >/dev/null && [[ -d /run/systemd/system ]]; }

if com_systemd && [[ "$(timedatectl show -p Timezone --value 2>/dev/null || true)" != America/Sao_Paulo ]]; then
  timedatectl set-timezone America/Sao_Paulo && log "fuso: America/Sao_Paulo"
fi

# ── 2. Docker ──────────────────────────────────────────────────────────────────
# O teto de log vale para todo contêiner, inclusive os avulsos que a publicação cria
# (migração, backup na hora). Escrito antes da instalação: o Docker já sobe com ele.
if [[ ! -f /etc/docker/daemon.json ]]; then
  install -d -m 755 /etc/docker
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  log "docker: teto de log"
fi

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  log "docker: instalando do repositório oficial"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl >/dev/null
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091 # o arquivo é do sistema, não deste repositório
  codinome=$(. /etc/os-release && echo "${VERSION_CODENAME}")
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${codinome} stable" \
    >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi

if com_systemd; then
  systemctl enable --now docker >/dev/null 2>&1 || true
fi

# O grupo `docker` deixa o usuário da publicação usar o Docker sem `sudo`. Vale a partir
# da próxima conexão SSH — e a publicação abre uma nova a cada passo.
if ! id -nG "${USUARIO}" | grep -qw docker; then
  usermod -aG docker "${USUARIO}"
  log "docker: ${USUARIO} no grupo docker"
fi

# ── 3. a pasta do sistema ──────────────────────────────────────────────────────
if [[ ! -d "${PASTA}" ]]; then
  install -d -o "${USUARIO}" -g "${USUARIO}" -m 755 "${PASTA}"
  log "pasta: ${PASTA}"
fi

# ── 4. firewall da máquina ─────────────────────────────────────────────────────
# A imagem Ubuntu da Oracle fecha, no próprio servidor, tudo menos o SSH — além da
# lista de segurança da rede, que se abre no painel da Oracle (docs/hospedagem.md).
# Aqui se abrem 80 e 443, e sai o REJECT da cadeia FORWARD, que é da imagem e barraria
# o tráfego dos contêineres: o Docker cuida dessa cadeia sozinho.
if command -v iptables >/dev/null && iptables -S >/dev/null 2>&1; then
  mudou=nao
  for porta in 80 443; do
    if ! iptables -C INPUT -p tcp --dport "${porta}" -j ACCEPT 2>/dev/null; then
      iptables -I INPUT 1 -p tcp --dport "${porta}" -j ACCEPT
      mudou=sim
    fi
  done
  if ! iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null; then
    iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
    mudou=sim
  fi
  while iptables -C FORWARD -j REJECT --reject-with icmp-host-prohibited 2>/dev/null; do
    iptables -D FORWARD -j REJECT --reject-with icmp-host-prohibited
    mudou=sim
  done
  # A regra salva é a da imagem com as portas abertas — e nunca a do Docker, que ele
  # refaz a cada início. Por isso o arquivo é editado, e não gerado com `save`.
  regras=/etc/iptables/rules.v4
  if [[ -f "${regras}" ]]; then
    for porta in 80 443; do
      if ! grep -q -- "-A INPUT -p tcp -m tcp --dport ${porta} -j ACCEPT" "${regras}"; then
        sed -i "0,/^-A INPUT/s//-A INPUT -p tcp -m tcp --dport ${porta} -j ACCEPT\n-A INPUT/" "${regras}"
        mudou=sim
      fi
    done
    if ! grep -q -- "-A INPUT -p udp -m udp --dport 443 -j ACCEPT" "${regras}"; then
      sed -i "0,/^-A INPUT/s//-A INPUT -p udp -m udp --dport 443 -j ACCEPT\n-A INPUT/" "${regras}"
    fi
    sed -i '/^-A FORWARD -j REJECT --reject-with icmp-host-prohibited$/d' "${regras}"
  fi
  if [[ "${mudou}" == sim ]]; then
    log "firewall: portas 80 e 443 abertas"
  fi
fi

# ── 5. swap ────────────────────────────────────────────────────────────────────
# O build do Next é o momento de mais memória. Com swap, um pico lento; sem, o kernel
# mata o processo e a publicação falha sem dizer por quê.
if [[ -z "$(swapon --show 2>/dev/null)" && ! -f /swapfile ]]; then
  if fallocate -l 2G /swapfile 2>/dev/null && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile 2>/dev/null; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
    log "swap: 2 GB"
  else
    rm -f /swapfile
  fi
fi

# ── 6. atualização automática ──────────────────────────────────────────────────
# O Ubuntu já instala as correções de segurança sozinho; falta reiniciar quando uma
# delas pede (kernel). Às 04:30, depois da cópia das 03:00; os contêineres voltam
# sozinhos (`restart: unless-stopped`).
reinicio=/etc/apt/apt.conf.d/52-reinicio-automatico
if [[ ! -f "${reinicio}" ]]; then
  cat >"${reinicio}" <<'APT'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
APT
  log "atualização automática: reinicia às 04:30 quando precisar"
fi

# ── 7. fail2ban ────────────────────────────────────────────────────────────────
if ! command -v fail2ban-client >/dev/null; then
  # A lista de pacotes de uma máquina recém-criada pode estar vazia ou velha.
  apt-get update -qq
  apt-get install -y -qq fail2ban >/dev/null
  if com_systemd; then
    systemctl enable --now fail2ban >/dev/null 2>&1 || true
  fi
  log "fail2ban: instalado"
fi

log "servidor pronto"
