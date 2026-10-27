# web — сайт и браузерный клиент

Vite + TypeScript без UI-фреймворка. Движок — `xash3d-fwgs`, клиент/сервер CS — `cs16-client` (WebAssembly).
Архитектура и контракты — в [../ARCHITECTURE.md](../ARCHITECTURE.md).

## Команды

```bash
npm install          # версии закреплены точно (.npmrc: save-exact=true)
npm run dev          # dev-сервер Vite на http://localhost:5173
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build + scripts/postbuild.mjs → dist/
npm run preview      # раздача dist/ локально
```

`postbuild.mjs` копирует `../LICENSE` и `../THIRD_PARTY_NOTICES.md` в `dist/` как `.txt`
(если файла нет — предупреждение, сборка не падает) и создаёт рядом с крупными файлами `.br` и `.gz`
для `file_server { precompressed }` в Caddy.

## DEV_API_TARGET

Dev-сервер проксирует `/api/*` и `/rtc/*` (включая WebSocket) на `DEV_API_TARGET`,
по умолчанию `http://localhost:8080`:

```bash
DEV_API_TARGET=https://cs.example.com npm run dev   # список серверов и онлайн через боевой сайт
```

Офлайн-режим работает без API. Dev- и preview-сервер ставят `COOP: same-origin` и `COEP: require-corp`, как Caddy.

## Где что

| Путь | Что делает |
|---|---|
| `src/main.ts`, `src/router.ts` | hash-роутинг, выбор страницы, заглушка для неподдерживаемых сред |
| `src/pages/` | страницы: главная, `play` (+ `play-loader`), `game`, `servers`, `guide`, `licenses` |
| `src/game/paths.ts`, `files.ts`, `zip.ts` | выбор папок/zip, нормализация путей, фильтр лишнего, чтение в память |
| `src/game/validate.ts` | проверка `liblist.gam`, `*.wad`, карт; список карт |
| `src/game/handles.ts` | запоминание выбранной папки (только handle, не файлы) в IndexedDB |
| `src/game/engine.ts` | запуск Xash3D, монтирование файлов в `/rodir`, консольные команды |
| `src/net/protocol.ts` | **[НЕ СВЕРЕНО]** все константы сигналинга WebRTC |
| `src/net/webrtc.ts` | транспорт `SendtoSender` для `Net` поверх data channel |
| `src/net/api.ts` | `/api/servers`, `/api/ice`, `/api/health` |

Файлы игры Valve никогда не попадают в сборку, на сервер, в IndexedDB или Cache API.
