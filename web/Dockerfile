# Сборка сайта и образ Caddy со статикой.
# Контекст сборки — КОРЕНЬ репозитория (compose: context: ., dockerfile: web/Dockerfile).
ARG NODE_IMAGE=node:22-alpine
ARG WC3_BUILD_IMAGE=node:22-bookworm
ARG CADDY_IMAGE=caddy:2.11-alpine

# Warcraft III (Warsmash): TeaVM-сборка на JDK 17 — scripts/build-wc3.sh.
# WITH_WC3=0 — пропустить (карточка в каталоге будет, но игра не откроется).
FROM ${WC3_BUILD_IMAGE} AS wc3
ARG WITH_WC3=1
ARG VITE_WC3_SIGNALING=
RUN if [ "$WITH_WC3" = "1" ]; then \
      apt-get update \
      && apt-get install -y --no-install-recommends openjdk-17-jdk-headless git ca-certificates \
      && rm -rf /var/lib/apt/lists/*; \
    fi
WORKDIR /repo
COPY scripts/build-wc3.sh scripts/lib.sh scripts/
COPY vendor-patches/ vendor-patches/
# На VPS сайт живёт в корне домена — Warsmash в /games/wc3/
RUN mkdir -p /out \
    && if [ "$WITH_WC3" = "1" ]; then \
      WC3_BASE=/games/wc3/ VITE_WC3_SIGNALING="$VITE_WC3_SIGNALING" bash scripts/build-wc3.sh /out; \
    else echo "WITH_WC3=0: Warcraft III не собирается"; fi

FROM ${NODE_IMAGE} AS build
WORKDIR /repo/web
COPY web/package.json web/package-lock.json* web/.npmrc ./
# cs16-client снят с npm: файлы берутся с jsDelivr и сверяются по SHA-256
COPY web/scripts/fetch-cs16-client.mjs scripts/
RUN node scripts/fetch-cs16-client.mjs
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY web/ ./
COPY --from=wc3 /out ./public/games/wc3
COPY LICENSE THIRD_PARTY_NOTICES.md* /repo/
RUN npm run build

FROM ${CADDY_IMAGE}
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/web/dist /srv
