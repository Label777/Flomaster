# ARCHITECTURE

Сайт, на котором Counter-Strike 1.6 запускается в браузере: офлайн (локальный listen-сервер внутри вкладки) и онлайн (выделенный сервер на нашей VPS, сеть через WebRTC). Движок — Xash3D FWGS, скомпилированный в WebAssembly (проект [webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs)).

> Статус проверки. Документ написан по исходникам и документации upstream, доступным на момент работы: опубликованные `.d.ts` пакета `xash3d-fwgs@1.2.2` (unpkg), README образа `yohimik/cs-web-server` на Docker Hub и DeepWiki-описание репозитория (снимок на коммите `eba351be`). Прямой доступ к GitHub/npm/Docker Hub из среды разработки был закрыт, поэтому места, которые не удалось сверить с кодом, помечены **[НЕ СВЕРЕНО]** и вынесены в [KNOWN_ISSUES.md](KNOWN_ISSUES.md). Для них есть `scripts/verify-upstream.sh`.

## 1. Компоненты

```
                         Браузер игрока
   ┌──────────────────────────────────────────────────────────────┐
   │  Сайт (Vite + TS, статик)                                     │
   │   ├─ загрузчик: valve/ + cstrike/ с диска игрока  ──► MEMFS   │
   │   ├─ xash3d-fwgs (xash.wasm, ref_webgl2, filesystem_stdio)    │
   │   ├─ cs16-client (client / menu / cs wasm, extras.pk3)        │
   │   └─ WebRTC-транспорт (Net + SendtoSender)                    │
   └───────┬───────────────────────────────┬──────────────────────┘
           │ HTTPS / WSS :443              │ WebRTC (DTLS/SCTP over UDP)
           ▼                               ▼  напрямую или через TURN
   ┌──────────────────────────── VPS ([IP_СЕРВЕРА]) ──────────────────────────┐
   │  caddy  :80/:443   ── статик сайта, Let's Encrypt, brotli, заголовки     │
   │     ├─ /api/*              ─► api:8080        (Node, без зависимостей)   │
   │     └─ /rtc/<id>/<signal>  ─► cs-server:27016 (только путь сигналинга)   │
   │  cs-server (yohimik/cs-web-server, linux/386)                            │
   │     ├─ :27016/tcp  HTTP + WebSocket-сигналинг (наружу НЕ публикуется)    │
   │     └─ :GAME_PORT/udp(+tcp)  WebRTC (Pion), публичный                    │
   │  api  :8080  /api/servers, /api/ice, /api/health                         │
   │     └─ A2S_INFO / A2S_PLAYER  ─► cs-server:GAME_PORT/udp                 │
   │  coturn (host network) :3478 udp/tcp, relay 49160–49200/udp              │
   └──────────────────────────────────────────────────────────────────────────┘
```

| Компонент | Технология | Каталог |
|---|---|---|
| Сайт и игровой клиент | Vite 7 + TypeScript, без UI-фреймворка | `web/` |
| Статус серверов и TURN-креды | Node 22, только встроенные модули (`http`, `dgram`, `crypto`) | `api/` |
| Игровой сервер + сигналинг | `yohimik/cs-web-server` (Go + Pion + нативный Xash3D i386) | образ, конфиги в `deploy/cs-server/` |
| HTTPS, статик, прокси | Caddy 2.11 | `deploy/caddy/`, образ собирается из `web/Dockerfile` |
| TURN/STUN | coturn | `deploy/coturn/` |

## 2. Закреплённые версии

| Что | Версия | Откуда известно | Статус |
|---|---|---|---|
| `xash3d-fwgs` (npm) | `1.2.2` (сборка `1.2.2+commit.7c58854`) | jsDelivr API (tag `latest`), `package.json` на unpkg | сверено |
| `cs16-client` | `0.1.2` | jsDelivr (снят с npm) | `web/scripts/fetch-cs16-client.mjs` → `web/vendor/cs16-client`, хеши SHA-256 сверяются; совместимость с `xash3d-fwgs@1.2.2` **не проверена** (KNOWN_ISSUES №2) |
| `jszip` | `3.10.1` | используется upstream-клиентом | сверено по описанию |
| `vite` | `7.1.11` | версия из Dockerfile upstream (`client`-стадия) | сверено по описанию |
| `typescript` | `5.9.3` | devDependency `xash3d-fwgs` | сверено |
| Node (сборка, api) | `22` (alpine) | upstream использует `node:22-alpine` | — |
| `yohimik/cs-web-server` | `latest` → закрепляется digest'ом | Docker Hub публикует только `latest` | закрепить `scripts/pin-images.sh` |
| `caddy` | `2.11-alpine` | актуальная ветка 2.11.x | закрепить digest'ом |
| `coturn/coturn` | `4.6.3-alpine` | стабильный тег | закрепить digest'ом |

После первого `docker compose pull` скрипт `scripts/pin-images.sh` записывает в `.env` точные `image@sha256:…`, и повторный деплой берёт ровно эти образы.

## 3. Как движок запускается в браузере

API — класс `Xash3D` из `xash3d-fwgs` (сверено по `dist/xash3d.d.ts`):

```ts
new Xash3D(opts?: {
  canvas?: HTMLCanvasElement; renderer?: 'gl4es' | 'gles3compat' | 'soft';
  filesMap?: Record<string, string>; arguments?: string[];
  libraries?: { filesystem?; server?; menu?; client?; xash?; render?: { soft?; gles3compat?; gl4es? } };
  dynamicLibraries?: string[]; module?: Partial<Module>;
})
init(): Promise<void>      // грузит wasm, создаёт /rwdir, вызывает net.init(em)
main(): void               // старт главного цикла
Cmd_ExecuteString(cmd)     // консольная команда
getCVar(name), waitLog(substr, cmd?), quit()
net?: EmNet  (задаётся ДО init),  em?: Em  (есть после init; em.FS — Emscripten FS)
```

Конфигурация повторяет значения по умолчанию из upstream-образа (`CLIENT_WASM_PATH`, `DYNAMIC_LIBRARIES`, `FILES_MAP`, `ENGINE_ARGS` в README Docker Hub):

| Параметр | Значение |
|---|---|
| `arguments` | `-windowed -game cstrike` (+ `-width W -height H` из лаунчера) |
| `libraries.xash / filesystem / client / menu / server` | URL'ы из `xash3d-fwgs/xash.wasm`, `…/filesystem_stdio.wasm`, `cs16-client/cl_dlls/client_emscripten_wasm32.wasm`, `…/cl_dlls/menu_emscripten_wasm32.wasm`, `cs16-client/dlls/cs_emscripten_wasm32.wasm` (импорт `?url`) |
| `libraries.render.gl4es / soft` | `xash3d-fwgs/libref_webgl2.wasm`, `xash3d-fwgs/libref_soft.wasm` |
| `dynamicLibraries` | `dlls/cs_emscripten_wasm32.so`, `/rwdir/filesystem_stdio.wasm` |
| `filesMap` | `dlls/cs_emscripten_wasm32.so` → URL серверной DLL, `/rwdir/filesystem_stdio.wasm` → URL filesystem |

Порядок запуска (как в `docker/cs-web-server/src/client/main.ts` upstream): чтение файлов игрока и `init()` идут параллельно → запись файлов в `/rodir/valve`, `/rodir/cstrike` через `FS.mkdirTree` + `FS.writeFile` → `extras.pk3` из `cs16-client` в `/rodir/cstrike/extras.pk3` → `FS.chdir('/rodir')` → `main()` → консольные команды (`_vgui_menus 0`, `name "…"`, `sensitivity …`, затем `map <карта>` или `connect 127.0.0.1:8080`).

### Файлы игры (юридическая граница)

- Сайт не хранит и не раздаёт `valve/` и `cstrike/`. В репозитории их нет; CI проверяет это скриптом `scripts/check-no-valve-files.sh`.
- Игрок выбирает папки на своём диске: File System Access API (`showDirectoryPicker`, Chromium) → фолбэк `<input webkitdirectory>` (Firefox, Safari) → или `.zip`. Файлы читаются `File.arrayBuffer()` и пишутся только в MEMFS вкладки. Сетевых запросов с содержимым файлов нет.
- Чтобы не тратить память, при монтировании пропускаются нативные бинарники (`.dll .so .dylib .exe`) и контент одиночной кампании Half-Life, не нужный CS: `valve/maps/`, `valve/media/`, `valve/SAVE/`.
- На сервере файлы `valve/` и `cstrike/` берутся из образа upstream (тот получает HLDS через steamcmd при сборке образа). Если администратор хочет использовать свою копию — `scripts/install-server-files.sh` (steamcmd, app 90 + mod cstrike) и оверлей `docker-compose.steamcmd.yml`.
- Upstream-образ умеет раздавать клиентам `valve.zip` из `/xashds/public/valve.zip`. Мы этот файл не монтируем, а порт 27016 не публикуем — Caddy пропускает к нему только путь сигналинга.

## 4. Сеть в онлайн-режиме

Транспорт движка — класс `Net` из `xash3d-fwgs` (сверено по `dist/net/net.d.ts`): `new Net(sender: SendtoSender, opts?)`, где `SendtoSender = { sendto(p: Packet): void }`, входящие пакеты кладутся в `net.incoming.enqueue(packet)` (`RollingBuffer<Packet>`), `Packet = { data: Int8Array; ip: [n,n,n,n]; port: number }`. Объект `net` присваивается `xash.net` до `init()`.

Поток подключения (по описанию upstream: клиент шлёт SDP offer через WebSocket, сервер отвечает answer'ом с кандидатами, данные идут по ненадёжному data channel):

1. `GET /api/ice` → `iceServers` (STUN + TURN с временными учётками).
2. `RTCPeerConnection` + `createDataChannel(…, { ordered: false, maxRetransmits: 0 })`.
3. WebSocket `wss://<домен>/rtc/<serverId><SIGNAL_PATH>` → offer → answer (+ trickle-кандидаты, если придут).
4. Пакеты движка: `sendto` → `dataChannel.send(copy)`; `onmessage` → `net.incoming.enqueue({ data, ip: [127,0,0,1], port: 8080 })`.
5. `Cmd_ExecuteString('connect 127.0.0.1:8080')` — адрес фиктивный, как в upstream-клиенте.

**[НЕ СВЕРЕНО]**: путь WebSocket, формат JSON-сообщений и метка data channel взяты из описания, а не из кода. Все такие константы собраны в одном файле `web/src/net/protocol.ts`; `scripts/verify-upstream.sh` выкачивает upstream-клиент на закреплённом ref и показывает соответствующие места кода для сверки.

Пинг: в игре — таблица счёта движка (Tab) и оверлей из `RTCPeerConnection.getStats()` (`currentRoundTripTime` активной пары кандидатов). В списке серверов — RTT запроса `GET /api/health` (API и игровой сервер на одной машине).

TURN: coturn в режиме `use-auth-secret`. API выдаёт учётки по схеме TURN REST (`username = <expiry>:<id>`, `credential = base64(HMAC-SHA1(secret, username))`), срок жизни `TURN_TTL`. Пиры в приватных сетях запрещены (`denied-peer-ip`), чтобы TURN нельзя было использовать как прокси во внутреннюю сеть.

Сертификаты: HTTPS — Let's Encrypt через Caddy; WebRTC использует DTLS с самоподписанными сертификатами, которые браузер принимает автоматически по fingerprint из SDP. Ручной импорт сертификатов игроку не нужен.

## 5. Порты

| Порт | Протокол | Сервис | Наружу |
|---|---|---|---|
| 80, 443 | TCP (+443/UDP для HTTP/3) | caddy | да |
| `GAME_PORT` (по умолчанию 27018) | UDP + TCP | cs-server, WebRTC | да |
| 27016 | TCP | cs-server, HTTP/сигналинг | нет, только docker-сеть |
| 8080 | TCP | api | нет |
| 3478 | UDP + TCP | coturn | да |
| 49160–49200 | UDP | coturn relay | да |

## 6. HTTP-контракты API

`GET /api/servers` → `200`

```json
{ "servers": [ {
  "id": "main", "name": "CS 1.6 Web #1", "status": "online|offline|unknown",
  "map": "de_dust2", "players": 3, "maxPlayers": 16, "bots": 0,
  "signalUrl": "/rtc/main/websocket", "updatedAt": "2026-10-27T10:00:00Z"
} ] }
```

`GET /api/servers/:id` → то же + `"playerList": [{ "name", "score", "duration" }]`.
`GET /api/ice` → `{ "iceServers": RTCIceServer[], "ttl": 86400 }`.
`GET /api/health` → `204` (используется для замера RTT).

`map/players` заполняются по A2S_INFO/A2S_PLAYER. Если сервер на UDP-запросы не отвечает (см. KNOWN_ISSUES), `status` определяется по HTTP-проверке `cs-server:27016`, а `map/players` = `null`.

## 7. Фронтенд

Одностраничное приложение с hash-роутингом: `#/` (главная: «Играть», «Серверы», «Как подготовить файлы игры»), `#/play` (загрузчик + лаунчер), `#/servers`, `#/guide`, `#/game` (canvas на весь экран, Pointer Lock, Fullscreen, консоль), `#/licenses`. Неподдерживаемые среды (мобильные, нет WebAssembly/WebGL2/RTCPeerConnection) получают заглушку с объяснением. Подвал на каждой странице: «Не связан с Valve. Counter-Strike — товарный знак Valve Corporation».

## 8. Деплой и DevOps

- `scripts/deploy.sh` — одна команда: проверяет `.env`, тянет образы, собирает `web`/`api`, `docker compose up -d`, ждёт health-check.
- Caddy: автоматический HTTPS, `file_server { precompressed br gzip }` (файлы `.br/.gz` генерируются при сборке), `Content-Type: application/wasm`, `Cache-Control: immutable` на год для `/assets/*` (хэшированные имена Vite), `no-cache` для `index.html`, `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (все ресурсы с того же origin, поэтому изоляция ничего не ломает и даёт `SharedArrayBuffer`, если сборка движка его потребует).
- CI (GitHub Actions): typecheck + сборка `web` и `api`, проверка отсутствия файлов Valve, `docker compose config`, сборка образов.

## 9. Риски

| Риск | Влияние | Что делаем |
|---|---|---|
| Протокол сигналинга не совпал с upstream | онлайн не подключается | константы в одном файле, `verify-upstream.sh`, пункт №1 в KNOWN_ISSUES |
| Upstream-образ меняется под `latest` | поломка после обновления | закрепление по digest |
| Сервер не отвечает на A2S по UDP | в списке нет карты/онлайна | фолбэк на HTTP-статус, отображение «нет данных» |
| Память: 400–600 МБ ассетов в MEMFS | вылет вкладки на слабых ПК | фильтр ненужных файлов, предупреждение, рекомендация 64-битного браузера |
| Safari: нет File System Access API, особенности WebGL2 | хуже UX | фолбэк `webkitdirectory` и `.zip` |
| Esc снимает Pointer Lock браузера и одновременно открывает меню | раздражает | клик по canvas снова захватывает мышь; подсказка в UI |
| Metamod/AMX Mod X | не поддерживаются upstream-клиентом в браузере | вариант образа `cs-web-server-metpamx` только для сервера |

## 10. План и роли

1. Архитектор (оркестратор): этот документ, каркас репозитория, контракты, `.env.example`.
2. Фронтенд-агент: `web/` целиком.
3. Агент «Сервер и DevOps»: `api/`, `deploy/`, `docker-compose*.yml`, `scripts/`, CI.
4. QA-агент: независимая проверка, `KNOWN_ISSUES.md`, тест-план.
5. Оркестратор: приёмка, README, финальная сборка.

## 11. Warcraft III (Warsmash)

Вторая игра со своими файлами игрока — Warcraft III: The Frozen Throne на движке [Warsmash](https://github.com/ErikSom/WarsmashModEngine/tree/d69e772b4dede6fd3569f9949a3180cdfea4635b): открытая реимплементация движка WC3 на Java (LibGDX), собранная TeaVM в JavaScript, с сайтом-оболочкой на Astro + Preact. Ограничения (DotA не играбельна, нет ИИ) — KNOWN_ISSUES, раздел G.

```
 Браузер игрока                                          Сборка (pages.yml / web/Dockerfile)
 ┌───────────────────────────────────────────────┐      ┌──────────────────────────────────────────┐
 │ сайт: #/g/wc3/play → <iframe games/wc3/>        │      │ scripts/build-wc3.sh                     │
 │  ┌───────── Warsmash (Astro + Preact) ───────┐ │      │  git fetch ErikSom/…@d69e772b (хеш)       │
 │  │ Manage assets: <input webkitdirectory>    │ │      │  + vendor-patches/wc3/*.patch            │
 │  │   → .mpq в OPFS (/w3, /extracted)         │ │      │  ./gradlew :html:buildWeb (JDK 17, TeaVM) │
 │  │ engine-worker.js: движок в воркере,       │ │      │  − арт upstream, проверка на файлы игры  │
 │  │   OffscreenCanvas + WebGL                 │ │      │  → web/public/games/wc3/ + BUILD-INFO    │
 │  │ сеть: @poki/netlib (WebRTC P2P, lockstep) │ │      └──────────────────────────────────────────┘
 │  └──────────────┬────────────────────────────┘ │
 └─────────────────┼──────────────────────────────┘
                   │ WebSocket сигналинга (только знакомство игроков)
                   ▼
   wss://netlib.poki.io (по умолчанию) или наш wc3-signaling (docker-compose.wc3-signaling.yml)
```

| Что | Где |
|---|---|
| Закреплённый коммит, патчи, проверки сборки | `scripts/build-wc3.sh`, `vendor-patches/wc3/` |
| Сборка под путь сайта (`VITE_BASE` → `<база>games/wc3/`) | `web/scripts/fetch-wc3.mjs` (`npm run fetch:wc3`) |
| Сборка на Pages / в образе / проверочная | `.github/workflows/pages.yml`, `web/Dockerfile` (стадия `wc3`, `WITH_WC3`), `.github/workflows/wc3-engine.yml` |
| Карточка, плеер, инструкция | `web/src/catalog/games.ts` (`wc3`), `web/src/pages/game-page.ts`, `web/src/pages/wc3-guide.ts` (`#/wc3`) |
| Свой сигналинг | `docker-compose.wc3-signaling.yml`, маршрут `/wc3-signaling/*` в `deploy/caddy/Caddyfile`, `VITE_WC3_SIGNALING` |

Наши патчи Warsmash (`vendor-patches/wc3/`, накладываются по порядку): `0001` — работа из подкаталога сайта, без арта Blizzard, свой сигналинг; `0002` — без ненадёжного `maven.nikr.net`; `0003` — механики для пользовательских карт вроде DotA: продажа героев в тавернах, чат (поле на странице → GUI-события lockstep → `TriggerRegisterPlayerChatEvent`), настоящий Channel, события заклинаний, `ReviveHero` и др. (KNOWN_ISSUES, п. 43–49, 62). Новый код в Warsmash — в отдельных файлах с префиксом `Flomaster` и в методах `flomaster*`, чтобы патч было проще переносить на новые коммиты upstream.

Юридическая граница та же, что у CS 1.6: файлы игры и карты выбирает игрок, они лежат в OPFS его браузера и никуда не отправляются; сайт раздаёт только код движка. Лицензии: код сайта — MIT, Warsmash — AGPL-3.0 отдельной сборкой (наш TypeScript его не импортирует); ссылка на исходник точного коммита и наши патчи — на страницах `#/wc3` и `#/licenses` и в `games/wc3/BUILD-INFO.txt`.

Изоляция: Warsmash не нужен `SharedArrayBuffer`, все его файлы с того же origin, поэтому COOP/COEP сайта (Caddy, `coi-sw.js` на Pages — его scope `BASE_URL` покрывает `games/wc3/`) ему не мешают. Фрейм своей игры грузится без `credentialless`, иначе у него было бы временное хранилище и OPFS терялся бы.
