# Сборка сайта и образ Caddy со статикой.
# Контекст сборки — КОРЕНЬ репозитория (compose: context: ., dockerfile: web/Dockerfile).
ARG NODE_IMAGE=node:22-alpine
ARG CADDY_IMAGE=caddy:2.11-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /repo/web
COPY web/package.json web/package-lock.json* web/.npmrc ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY web/ ./
COPY LICENSE THIRD_PARTY_NOTICES.md* /repo/
RUN npm run build

FROM ${CADDY_IMAGE}
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/web/dist /srv
