# syntax=docker/dockerfile:1
#
# A imagem do sistema (ADR 0010 e 0013).
#
# Uma imagem só, para todas as funções. Sem comando, ela sobe o sistema inteiro num
# contêiner só, que é como o Render a roda. A composição do servidor próprio
# (`servidor/compose.yaml`) separa as funções pelo comando:
#
#   node tarefas/conteiner.mjs  tudo junto — migra, semeia e sobe site e fila (o padrão)
#   node server.js              o site
#   node tarefas/poller.mjs     a fila (importação, extração, compatibilidade…)
#   node tarefas/migrar.mjs     as migrações, que a publicação roda antes de trocar
#   node tarefas/semear.mjs     o primeiro perfil, na primeira publicação
#
# Quatro estágios, para a imagem final levar só o que roda: as dependências completas
# (o build precisa das de desenvolvimento), o build, as dependências de produção e a
# imagem final. O `npm ci` fica numa camada que só se refaz quando o
# `package-lock.json` muda, e é isso que deixa a publicação de uma mudança comum em
# poucos minutos.
#
# O build não lê ambiente nenhum: nenhuma tela é montada no build (ver `layout.tsx`),
# e tudo o que é configuração — banco, marca, código de cadastro — chega quando o
# contêiner sobe. A versão é a exceção, e vem de propósito como argumento: é o commit
# que esta imagem é.

ARG IMAGEM_NODE=node:22-bookworm-slim

# ── 1. Dependências completas ────────────────────────────────────────────────
FROM ${IMAGEM_NODE} AS dependencias
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# `--ignore-scripts`: o `prepare` instala o gancho de commit do git, e aqui não há git.
# O wasm do leitor, que o `prepare` também copia, o `npm run build` copia de novo.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund

# ── 2. Build: o site e as tarefas empacotadas ────────────────────────────────
FROM dependencias AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 \
    SAIDA_DO_NEXT=standalone
# O `standalone` traz uma cópia recortada do `node_modules`; ela sai, porque a imagem
# final leva o `node_modules` de produção inteiro, que as tarefas também usam.
RUN npm run build \
 && rm -rf .next/standalone/node_modules \
 && npm run montar:tarefas

# ── 3. Dependências de produção ──────────────────────────────────────────────
FROM ${IMAGEM_NODE} AS producao
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Saem o compilador do Next (`@next/swc`, 180 MB: só o build compila, e o rastreio do
# servidor feito pelo próprio Next não o inclui) e as variantes do sharp para outra
# biblioteca C (musl) ou para wasm — a imagem é Debian, de glibc.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && rm -rf node_modules/@next/swc-* node_modules/@img/*musl* node_modules/@img/sharp-wasm32

# ── 4. A imagem final ─────────────────────────────────────────────────────────
FROM ${IMAGEM_NODE}
ARG VERSAO=""
ARG VERSAO_EM=""
LABEL org.opencontainers.image.revision="${VERSAO}"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=America/Sao_Paulo \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    ARMAZENAMENTO_DIR=/app/.dados/conteudo \
    EXTRACAO_CACHE_DIR=/app/.dados/cache \
    VERSAO="${VERSAO}" \
    VERSAO_EM="${VERSAO_EM}"
WORKDIR /app

# O armazenamento de conteúdo é um volume, dividido entre o site (que recebe o
# arquivo) e a fila (que o processa). O volume novo herda o dono desta pasta, e os
# dois contêineres rodam como `node`.
RUN mkdir -p /app/.dados/conteudo /app/.dados/cache && chown -R node:node /app/.dados

# Primeiro o que muda pouco, depois o que muda a cada publicação.
COPY --from=producao /app/node_modules ./node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/tarefas ./tarefas
COPY --from=build /app/src/infra/banco/migrations ./src/infra/banco/migrations

USER node
EXPOSE 3000
# Na forma de lista, sem shell no meio: o pedido de parar chega direto ao Node, que o
# repassa ao site e à fila (`scripts/conteiner.ts`).
CMD ["node", "tarefas/conteiner.mjs"]
