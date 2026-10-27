# API сайта: статус серверов и TURN-учётки. Без зависимостей — npm install не нужен.
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE}

ENV NODE_ENV=production \
    PORT=8080

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src

USER node
EXPOSE 8080

# node:alpine содержит busybox wget
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
