# KNOWN_ISSUES

Что не работает в браузере, что не удалось проверить без доступа к upstream и как это обойти. Пункты с пометкой **[НЕ СВЕРЕНО]** написаны по документации upstream (DeepWiki, README на Docker Hub, `.d.ts` пакета на unpkg) без доступа к исходникам. Их нужно проверить до публичного запуска: ручные проверки описаны в [TEST_PLAN.md](TEST_PLAN.md).

Содержание: [A. Не сверено с upstream](#a-не-сверено-с-upstream) · [B. Браузеры](#b-ограничения-браузеров) · [C. Сервер и сеть](#c-сервер-и-сеть) · [D. Игра и моды](#d-игра-и-моды) · [E. Сборка и деплой](#e-сборка-и-деплой) · [F. Список неподдерживаемых модов Xash3D FWGS](#f-сверка-со-списком-неподдерживаемых-модов-xash3d-fwgs) · [G. Warcraft III (Warsmash, DotA)](#g-warcraft-iii-the-frozen-throne-warsmash-и-dota)

---

## A. Не сверено с upstream

### 1. [НЕ СВЕРЕНО] Протокол WebRTC-сигналинга с `yohimik/cs-web-server`

Онлайн-режим зависит от протокола, который известен только по описанию: «браузер шлёт SDP offer по WebSocket, сервер отвечает answer'ом (+ ICE-кандидаты), игровые пакеты идут по ненадёжному data channel». Путь WebSocket, формат JSON, метка канала и фиктивный адрес сервера **из кода не сверены**. Если онлайн-подключение зависает на «Подключение к серверу» или падает с «Сервер не ответил за 15 секунд», дело, скорее всего, здесь.

Где эти предположения в коде:

| Предположение | Где |
|---|---|
| Путь WebSocket `/websocket` | `.env.example:25` (`CS_SIGNAL_PATH`), `docker-compose.yml:31,54`, `api/src/config.js:88` (формирует `signalUrl` = `/rtc/main/websocket`), `deploy/caddy/Caddyfile:74-75` (`handle_path /rtc/main/*` → `handle {$CS_SIGNAL_PATH}` → `cs-server:27016`), запасное значение в `web/src/net/api.ts` (`parseServer`) |
| Типы сообщений `offer` / `answer` / `candidate`, поля `sdp` и `candidate` | `web/src/net/protocol.ts:15-19` (`SIGNAL_MSG`), разбор — `web/src/net/protocol.ts:47` (`parseSignal`) |
| Не-trickle: offer уходит после сбора кандидатов (до 3 с) | `web/src/net/protocol.ts:33`, `web/src/net/webrtc.ts:176` |
| Клиент сам создаёт data channel с меткой `xash` | `web/src/net/protocol.ts:22`, `web/src/net/webrtc.ts:66` |
| Канал ненадёжный и неупорядоченный (`ordered:false, maxRetransmits:0`) | `web/src/net/protocol.ts:25` |
| Входящие пакеты адресуются движку как `127.0.0.1:8080`, команда `connect 127.0.0.1:8080` | `web/src/net/protocol.ts:28-30`, `web/src/net/webrtc.ts:199`, `web/src/pages/game.ts:274,317` |
| Сервер может закрыть WebSocket сразу после answer — это не ошибка | `web/src/net/webrtc.ts:99` |

Как сверить (нужна сеть до github.com):

```bash
scripts/verify-upstream.sh                        # upstream на main
UPSTREAM_REF=7c58854 scripts/verify-upstream.sh   # на коммите, из которого собран xash3d-fwgs@1.2.2
KEEP=1 scripts/verify-upstream.sh                 # не удалять клон (путь будет напечатан)
```

Скрипт клонирует `yohimik/webxash3d-fwgs` и печатает фрагменты upstream-клиента (`docker/cs-web-server/src/client`: `new WebSocket`, `createDataChannel`, `JSON.stringify`, `connect`, `Xash3DWebRTC`) и Go-сервера (`HandleFunc`, `websocket`, `NAT1To1`, `UDPMux`, `IP`, `PORT`). В конце он проверяет, есть ли `CS_SIGNAL_PATH` в исходниках сервера, и громко предупреждает, если строки там нет. Код выхода 0 означает, что вывод готов к ручной сверке, 2 — что клонировать не удалось. Всё найденное правится в **одном** файле `web/src/net/protocol.ts` и в `CS_SIGNAL_PATH` в `.env`.

Обход на время расследования: временно опубликовать `27016:27016` в `docker-compose.yml`, открыть `http://<IP>:27016` (upstream-клиент образа) и посмотреть его трафик в DevTools → Network → WS. **Только для проверки**: `valve.zip` не монтировать и порт после проверки закрыть.

### 2. `cs16-client` снят с npm; [НЕ СВЕРЕНО] совместимость wasm

Все версии `cs16-client` (последняя — `0.1.2` от 2025-10-22) удалены из реестра npm 2026-09-08, поэтому `npm install cs16-client` не работает. Файлы `0.1.2` по-прежнему раздаёт jsDelivr. `web/scripts/fetch-cs16-client.mjs` скачивает оттуда четыре нужных файла, сверяет SHA-256 с хешами jsDelivr и собирает локальный пакет `web/vendor/cs16-client` (в git не попадает); в `web/package.json` зависимость — `file:vendor/cs16-client`. Скрипт запускается **до** `npm install`: в CI, в `pages.yml` и в `web/Dockerfile` это уже сделано, локально — `cd web && npm run fetch:cs16 && npm install`. Если jsDelivr тоже уберёт файлы, нужен другой источник (`CS16_CLIENT_BASE=<зеркало>`) или сборка из исходников upstream.

`xash3d-fwgs` помечен в npm как deprecated («will be removed»), но `1.2.2` пока устанавливается. Если его тоже удалят, понадобится такая же локальная копия.

Совместимость не проверена: `cs16-client@0.1.2` опубликован в один день с `xash3d-fwgs@1.2.1` (2025-10-22), а сайт использует `xash3d-fwgs@1.2.2` (2026-01-19). Если при загрузке движка будет `LinkError`, попробуйте `xash3d-fwgs@1.2.1`. Проверка — тест T-02 в TEST_PLAN.

### 3. [НЕ СВЕРЕНО] Отвечает ли образ на A2S / Xash3D `info`

Список серверов берёт карту и онлайн из UDP-запросов A2S_INFO / `info 49` / A2S_PLAYER / RCON к `cs-server:GAME_PORT` (`api/src/status.js`). Есть два противоречия в источниках. В README образа `PORT` описан как «UDP port for CS server». DeepWiki же пишет, что entrypoint запускает движок с `-port 27015`, а `PORT` занимает WebRTC (Pion). Если на `GAME_PORT` слушает Pion, A2S там никто не ответит. **Что видно пользователю:** статус сервера всё равно определяется по HTTP-проверке `http://cs-server:27016/` («Работает»), но карта и игроки показываются как «нет данных». **Обход:** задать в `.env` `GAME_QUERY_PORT=27015` (запросы идут внутри docker-сети, публиковать порт не нужно) и проверить `curl https://<домен>/api/servers`. Если движок в образе вообще не открывает UDP-сокет (сеть только через Pion), остаётся RCON, который тоже идёт по UDP, или ничего. Тогда это ограничение образа.

### 4. [НЕ СВЕРЕНО] Ключи `-width` / `-height`

Разрешение из лаунчера передаётся движку ключами `-width W -height H` (`web/src/game/engine.ts:49`). Есть ли они в wasm-сборке, не проверено. Если движок их проигнорирует, всё равно действует размер canvas, и картинка растягивается с сохранением пропорций. Обход — консоль: `vid_mode` / `width` / `height` по документации Xash3D FWGS.

---

## B. Ограничения браузеров

| # | Ограничение | Что видит игрок | Обход |
|---|---|---|---|
| 5 | **Safari: нет File System Access API** (`showDirectoryPicker`) | кнопка «Выбрать папку игры» открывает обычный выбор папки (`<input webkitdirectory>`). Браузер может спросить, «загрузить» ли файлы на сайт; на деле файлы никуда не отправляются. Папку нельзя запомнить | выбор папки через `webkitdirectory` или `.zip` (`web/src/pages/play-loader.ts`, `pickDirectory` / `pickZip`). Пояснение есть на странице «Подготовка файлов» |
| 6 | **Firefox: нет выбора папки через FS Access API** | то же, что в Safari: `webkitdirectory`, без запоминания папки | `webkitdirectory` или `.zip` |
| 7 | **Safari: WebGL2 и память.** WebGL2 появился в Safari 15. В Safari вкладке дают меньше памяти, чем в Chrome, а GLES3Compat в WebKit работает медленнее | вкладка перезагружается («На этой веб-странице возникла проблема») при загрузке или смене карты | Safari 16.4+; закрыть другие вкладки; убрать лишние карты из `cstrike/maps`; если WebGL падает, в лаунчере выбрать «Отрисовка → Программный» (`libref_soft.wasm`) |
| 8 | **Safari < 16.4: Fullscreen API только с префиксом `webkit`** | — | исправлено: кнопка «Во весь экран» использует `webkitRequestFullscreen` как запасной вариант (`web/src/pages/game.ts`, `toggleFullscreen`) |
| 9 | **Память: 400–600 МБ файлов игры в MEMFS** плюс память wasm. Файлы сначала читаются в JS-память, потом пишутся в MEMFS (ссылки отпускаются по ходу записи, `web/src/game/engine.ts`, `mountFiles`). В пике нужно около 2× объёма | при объёме больше 700 МБ — предупреждение (`web/src/pages/play-loader.ts:14`). На слабых ПК вкладка падает (`Out of memory`, `memory access out of bounds`) | при монтировании пропускаются `valve/maps`, `valve/media`, `valve/SAVE` и нативные `.dll/.so/.dylib/.exe` (`web/src/game/paths.ts`). Игроку: 64-битный браузер, 2–4 ГБ свободной памяти, лишние карты убрать из `cstrike/maps`. Ленивой загрузки файлов в upstream пока нет (в roadmap webxash3d: «Async/Lazy File Loading») |
| 10 | **32-битные браузеры** (32-битный Chrome/Firefox на Windows) — адресное пространство вкладки ~2–4 ГБ | падение при монтировании | только 64-битный браузер; об этом сказано на странице «Подготовка файлов» |
| 11 | **Esc и Pointer Lock.** Браузер всегда снимает захват мыши по Esc, и тот же Esc открывает меню игры. Повторный захват возможен только по клику; сразу после выхода браузер может отказать | после Esc мышь свободна, игра в меню | подсказка в панели («Esc освобождает мышь, клик по игре — снова захватывает»). Клик по canvas повторяет `requestPointerLock()`, ошибка «слишком рано» гасится (`web/src/pages/game.ts:143-144`). Меню игры удобнее открывать другой клавишей: в консоли `bind F10 "togglemenu"` |
| 12 | **Свёрнутая или фоновая вкладка.** Главный цикл Emscripten идёт на `requestAnimationFrame`, а в скрытой вкладке браузер его останавливает (таймеры замедляет до 1 раза в секунду и реже). Движок не шлёт пакеты | офлайн — игра «на паузе». Онлайн — сервер отключает игрока по таймауту (`sv_timeout`, обычно ~60 с). В игре видно «Server timed out» или дисконнект | не сворачивать вкладку дольше чем на ~1 минуту. Если за это время закрылся сам WebRTC-канал, при возврате на вкладку показывается «Соединение потеряно» с кнопкой «Переподключиться» (`web/src/pages/game.ts:289`). Если канал жив, а сервер выкинул игрока, — консоль `retry` или «Переподключиться». Отдельного детектора «сервер выкинул» нет: движок пишет об этом сам |
| 13 | **Движок нельзя инициализировать второй раз без перезагрузки страницы** | выход из игры, уход с `#/game` и «Назад» перезагружают страницу, файлы игры нужно выбрать заново (в Chrome/Edge — одной кнопкой «Использовать сохранённую папку») | `web/src/main.ts:44`, `web/src/pages/game.ts:218`; при перезагрузке на `#/game` — переход на `#/play` (`renderGame`). Перед уходом из игры — предупреждение `beforeunload` (`web/src/pages/game.ts:205`) |
| 14 | **Мобильные устройства не поддерживаются.** В upstream нет touch-управления на уровне движка, а текстовый ввод на мобильных невозможен (DeepWiki, roadmap webxash3d, README.md 115–122) | заглушка «Нужен компьютер» на главной, `#/play` и `#/game` (`web/src/ui/support.ts:17`, `web/src/pages/unsupported.ts`). Список серверов и инструкция доступны | играть с компьютера. iPad с клавиатурой и трекпадом может пройти проверку (`any-pointer: fine`), но такая конфигурация не тестировалась |
| 15 | **Пинг в Firefox и Safari.** `currentRoundTripTime` поддерживается не везде (MDN: «Limited availability») | значок пинга показывает «— мс» | исправлено частично: при отсутствии `currentRoundTripTime` берётся среднее `totalRoundTripTime / responsesReceived` активной пары (`web/src/net/webrtc.ts`, `getRttMs`). Пинг в таблице счёта (Tab) движок считает сам и от браузера не зависит |
| 16 | **Аппаратное ускорение выключено / WebGL2 в чёрном списке драйверов** | заглушка «Браузер не дал доступ к WebGL 2» | включить аппаратное ускорение (`chrome://settings/system`), обновить драйверы; в Firefox проверить `about:support` → WebGL 2 |
| 17 | **Предупреждение «Vertex buffer is not big enough for the draw call»** в консоли | — | известное ограничение рендерера GLES3Compat в upstream (DeepWiki, Troubleshooting), не критично |

---

## C. Сервер и сеть

| # | Ограничение | Обход |
|---|---|---|
| 18 | **TURN за 1:1 NAT (AWS EC2, GCP, Oracle, Hetzner Floating IP).** Публичного IP на интерфейсе VPS нет. (а) coturn с `external-ip=<публичный>` без приватного адреса неверно сообщает relay-адрес; (б) relay от coturn до `PUBLIC_IP:GAME_PORT` — это hairpin через NAT облака, который часто не работает. Игроки за строгим NAT не подключаются, хотя STUN работает | (а) в `deploy/coturn/turnserver.conf.tmpl` заменить строку на `external-ip=${PUBLIC_IP}/<приватный IP>`. (б) Добавить `allowed-peer-ip=<приватный IP>` и проверить, что Pion объявляет host-кандидат на приватном адресе. Иначе нужен VPS с публичным IP на интерфейсе (обычные VPS: Hetzner Cloud, DigitalOcean, Vultr — так и устроены) |
| 19 | **Нет TURNS на 443.** coturn слушает только `3478/udp+tcp` (`no-tls`). В сетях, где закрыты UDP и все порты, кроме 443 (корпоративные, некоторые публичные Wi-Fi), ICE не установится | вариант: отдельный IP или поддомен для coturn с `tls-listening-port=443` и сертификатом (`cert=`/`pkey=` — можно взять у Caddy из тома `caddy_data`), выдавать `turns:turn.<домен>:443?transport=tcp` в `/api/ice` (`api/src/turn.js`, `buildIceResponse`). Порт 443 занят Caddy, поэтому нужен второй IP или SNI-мультиплексор — это изменение архитектуры, сейчас не сделано |
| 20 | **TURN — только до своего игрового сервера.** Учётки `/api/ice` получает любой посетитель (лимит 30 запросов в минуту на IP). Поэтому relay разрешён только до `PUBLIC_IP` (`denied-peer-ip` для всего IPv4/IPv6 и `allowed-peer-ip=${PUBLIC_IP}`), иначе TURN работал бы как открытый прокси | если игровой сервер на другом IP — добавить его `allowed-peer-ip` в шаблон |
| 21 | **TTL TURN-учёток.** Браузер не обновляет учётки посреди соединения, а coturn проверяет срок при продлении allocation. Поэтому `TURN_TTL` по умолчанию 24 часа (`.env.example`) | не ставить `TURN_TTL` меньше самой длинной игровой сессии |
| 22 | **Несколько серверов.** `SERVERS_JSON` в API поддерживает несколько серверов, но Caddy проксирует сигналинг только для `/rtc/main/*` (`deploy/caddy/Caddyfile:74`) | для каждого дополнительного `id` добавить в Caddyfile блок `handle_path /rtc/<id>/* { … reverse_proxy <хост>:27016 }` |
| 23 | **`yohimik/cs-web-server:latest` не закреплён**, пока не выполнен `scripts/pin-images.sh`. Docker Hub публикует только `latest`, обновление образа может сломать протокол (п. 1) | первый деплой — `scripts/deploy.sh --pin`: digest'ы записываются в `.env`. Обновление — `scripts/pin-images.sh --unpin && scripts/deploy.sh --pin`, затем снова тесты T-05…T-08 из TEST_PLAN |
| 24 | **`docker compose up` без `scripts/deploy.sh` на чистой VPS падает.** `deploy/cs-server/server.cfg` и `deploy/coturn/turnserver.conf` рендерятся скриптом из шаблонов (в них секреты, в git их нет); bind-маунты с `create_host_path: false` дают понятную ошибку вместо пустого каталога | первый запуск — `scripts/deploy.sh` (или `scripts/deploy.sh --render-only`, потом `docker compose up -d`) |
| 25 | **Оверлей steamcmd экспериментальный.** `docker-compose.steamcmd.yml` монтирует `valve/` и `cstrike/` целиком поверх каталогов образа и скрывает то, что образ положил туда сам (серверные библиотеки, конфиги). Совместимость не проверена | использовать файлы из образа (по умолчанию). Если оверлей нужен — сначала проверить на тестовой VPS (тест T-13) |
| 26 | **Админ-панель upstream** (`/admin` на 27016) недоступна снаружи: Caddy пропускает к 27016 только путь сигналинга | RCON по UDP из консоли игры (`rcon_password …; rcon status`) или SSH-туннель `ssh -L 27016:<ip cs-server>:27016` при заданных `ADMIN_PANEL_USER`/`ADMIN_PANEL_PASSWORD` |
| 27 | **`turnserver.conf` с секретом рендерится с правами 0644** (его читает непривилегированный пользователь в контейнере coturn) | на VPS не держать других пользователей в группе с доступом к каталогу репозитория; при необходимости `chmod 750` на каталог `deploy/coturn` |

---

## D. Игра и моды

| # | Ограничение | Обход |
|---|---|---|
| 28 | **Metamod и AMX Mod X — только на сервере.** В браузерном движке upstream они не поддерживаются (roadmap webxash3d, README.md 107–109). В нашем офлайн-режиме (listen-сервер во вкладке) плагины не загружаются | серверный вариант образа `yohimik/cs-web-server-metpamx` (Metamod и AMX Mod X предустановлены; базовый образ «совместим с AMX Mod X, но требует ручной установки», README на Docker Hub). Не проверено, в `docker-compose.yml` не подключено: заменить `CS_SERVER_IMAGE` и проверить тестами T-05…T-08 |
| 29 | **Боты (YaPB) в офлайн-режиме не подключены.** В `cs16-client` есть `dlls/yapb_emscripten_wasm32.wasm`, но наш код его не грузит: способ подключения (`dynamicLibraries`/`filesMap`, команды `yb`/`yapb`) из upstream не сверен. Офлайн-карта пустая — можно бегать по карте и тренироваться без противников | сверить по upstream-примерам, добавить модуль в `dynamicLibraries` и `filesMap` в `web/src/game/engine.ts` и лицензию YaPB в THIRD_PARTY_NOTICES. Для онлайна — боты на сервере, если образ их поддерживает |
| 30 | **Карты не со стандартного набора игроки скачать не могут.** На сервере `sv_allowdownload 0` (`deploy/cs-server/server.cfg.tmpl`), и браузерный клиент не докачивает ресурсы. Игрок без карты получит ошибку при подключении | в `deploy/cs-server/mapcycle.txt` — только карты, которые есть в Steam-версии CS 1.6 у каждого игрока. Нестандартную карту каждый игрок должен сам положить в свою `cstrike/maps` до выбора папки |
| 31 | **VGUI-меню выключено** (`_vgui_menus 0`, как в upstream-клиенте) | выбор команды и закупка — через старые текстовые меню (клавиши M, B) |
| 32 | **Сохранение настроек игры** (`config.cfg`, бинды) между сессиями не гарантировано: файлы игрока лежат в MEMFS до перезагрузки. Сохраняет ли `xash3d-fwgs` каталог `/rwdir` в IndexedDB (`FS.syncfs`), наш код не проверяет и сам `syncfs` не вызывает **[НЕ СВЕРЕНО]** | бинды задать в `cstrike/userconfig.cfg` / `autoexec.cfg` в своей копии игры — они монтируются вместе с файлами |

---

## E. Сборка и деплой

| # | Ограничение | Обход |
|---|---|---|
| 33 | **Нет `package-lock.json`** в `web/`: среда разработки не имела доступа к npm. Прямые зависимости закреплены точно (`web/.npmrc`: `save-exact=true`), транзитивные — нет | первый `cd web && npm install` с сетью, закоммитить `web/package-lock.json`. После этого CI и `web/Dockerfile` сами переключатся на `npm ci` |
| 34 | **Сборка `web` проверена только в GitHub Actions** (в среде разработки нет доступа к npm). `npm install`, `tsc` и `vite build` проходят в CI и в `pages.yml`; `package-lock.json` пока не закоммичен | на машине с npm: `cd web && npm run fetch:cs16 && npm install` и закоммитить `package-lock.json` |
| 35 | **GPL-исходники движка.** Сайт раздаёт wasm движка Xash3D FWGS (GPL-3.0-or-later по вторичным источникам) | до запуска выполнить чек-лист §4 в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): точные коммиты и своя копия исходников |
| 36 | **Лицензия Half-Life SDK запрещает коммерческое использование** кода, производного от SDK (`cs16-client`, части движка) | сайт и доступ к серверу — только бесплатно (THIRD_PARTY_NOTICES §5) |
| 37 | **GitHub Pages: только статика.** Игровой сервер, API и TURN на GitHub не запускаются | на Pages — офлайн-игра; для онлайна — VPS, переменная репозитория `API_BASE` и `ALLOWED_ORIGINS` на VPS (README, «Сайт на GitHub Pages») |
| 38 | **GitHub Pages: нет своих заголовков** (COOP/COEP, `Cache-Control`, `application/wasm` задаёт сам Pages) | COOP/COEP добавляет `web/public/coi-sw.js` (сборка с `VITE_COI_SW=1`); первый заход — одна перезагрузка. В Firefox в приватном режиме service worker недоступен — страница работает без изоляции |

---

## F. Сверка со списком неподдерживаемых модов Xash3D FWGS

Требование ТЗ: сверить со списком неподдерживаемых модов Xash3D FWGS.

- **Сам список найти не удалось.** В репозитории FWGS он лежит в каталоге `Documentation/` (по памяти — файл `not-supported-mod-list-and-their-status.md`), но github.com и raw.githubusercontent.com из среды разработки недоступны (`client_error`), а DeepWiki по `FWGS/xash3d-fwgs` такого списка не содержит («The page doesn't list any» — проверено). Пункт остаётся открытым: сверить вручную по `https://github.com/FWGS/xash3d-fwgs/tree/master/Documentation` (тест T-17 в TEST_PLAN).
- **Что подтверждено по DeepWiki webxash3d-fwgs** (Troubleshooting и Roadmap):
  - **Counter-Strike 1.6** работает через `cs16-client` (клиентская и серверная библиотеки переписаны под wasm). Это наш случай, он поддержан;
  - **Team Fortress 1.5 Client** не поддерживается: зависит от `freevgui` (README.md 87–89). На наш сайт не влияет;
  - **Metamod / AMX Mod X** не поддерживаются в браузерном движке (п. 28);
  - **touch-управление и текстовый ввод на мобильных** не реализованы (п. 14);
  - **ленивая загрузка ассетов** не реализована (п. 9);
  - однопоточное выполнение (только главный поток wasm), нет нативного UDP (только WebRTC data channel), персистентность FS ограничена.
- **Вывод для нашего сайта:** CS 1.6 на стандартных картах — поддерживаемый сценарий. Серверные плагины (Metamod/AMXX), моды на основе `freevgui`/VGUI2, сторонние клиентские DLL (`cl_dlls/client.dll` модов) и нестандартный контент, который требует докачки, — не поддерживаются.

---

## G. Warcraft III: The Frozen Throne (Warsmash) и DotA

**Статус.** Warcraft III есть в каталоге (`#/g/wc3`, бета): движок Warsmash во встроенном плеере, свои файлы игрока, сеть P2P. Подходит для мили и простых карт с друзьями по сети. **DotA Allstars на Warsmash неиграбельна** (п. 43–49) — это написано на карточке и на странице `#/wc3`. Как выбирали вариант — в конце раздела.

Как проверялось. Исходники веб-порта Warsmash ([ErikSom/WarsmashModEngine](https://github.com/ErikSom/WarsmashModEngine/tree/d69e772b4dede6fd3569f9949a3180cdfea4635b), ветка `HTML`, коммит `d69e772b` от 2026-05-11 — он же последний в ветке на 2026-10-28) прочитаны целиком по нужным местам. Upstream Retera ([Retera/WarsmashModEngine](https://github.com/Retera/WarsmashModEngine), `main` = `f9e0aeed`, 2025-12-08) сверен по тем же пунктам — недостающего там тоже нет. Сборка — `scripts/build-wc3.sh` в GitHub Actions (workflow `wc3-engine`): в среде разработки нет доступа к Maven Central и npm. Сама игра не запускалась: в среде нет файлов Warcraft III, карты DotA и браузера с GPU. Всё, что известно только из исходников, а не из запуска, помечено «по исходникам»; всё, что нужно проверить руками, — **[НЕ СВЕРЕНО]**. Устройство самой карты (герои продаются в тавернах, режимы задаются командами в чате) взято из общеизвестного устройства DotA: `war3map.j` карты не разбирался — у нас нет её копии (чек-лист — [TEST_PLAN.md, раздел 5](TEST_PLAN.md#5-warcraft-iii--чек-лист-ручной-проверки)).

### Таблица совместимости: DotA Allstars 6.83d на Warsmash `d69e772b`

Пути — от корня исходников Warsmash.

| # | Что | Итог | Почему | Где |
|---|---|---|---|---|
| 39 | Сборка Warsmash на закреплённом коммите | ✓ собирается — сверено в GitHub Actions 2026-10-28 (запуски `40685178286`, `40685588716`) | JDK 17 (Temurin), Node 22, 2–9 минут. Результат: 28 МБ, 94 файла, главное — `app.js` 12,1 МБ и `engine-worker.js` 11,6 МБ; страницы `index.html`, `play/`, `multiplayer/`, `assets/`. Файлов игры в сборке нет, заставка с артом Blizzard удалена. Артефакт `wc3-warsmash` хранится 7 дней | `scripts/build-wc3.sh`, `.github/workflows/wc3-engine.yml` |
| 40 | Версия Warcraft III игрока | классика 1.22–1.28 (MPQ) — основной вариант; 1.29–1.32 — с оговорками; **1.33+ и нынешний Reforged из Battle.net — нет** (новый формат моделей) | по README upstream; запуском **[НЕ СВЕРЕНО]** | `README.md` |
| 41 | Мили-карта 1×1 офлайн | **[НЕ СВЕРЕНО]**. Ожидание: карта грузится, но компьютерного противника нет | ИИ компьютерных игроков вырезан из веб-сборки в 0.1.2 ради производительности | коммит `974afebc` «drop AI», `html/CHANGELOG.md` (0.1.2) |
| 42 | Загрузка DotA 6.83d | **[НЕ СВЕРЕНО]** (время загрузки, ошибки). Скорее всего, загрузится: неизвестные нативки JASS не роняют карту | нереализованная нативка возвращает «пустое» значение и пишет предупреждение один раз | `jassparser/…/function/NativeJassFunction.java:76` |
| 43 | **Выбор героя** | ✗ по исходникам | Таверны продают героев через поле юнита `Sellunits`. Warsmash читает только `Sellitems` и `Makeitems` — продажи юнитов нет совсем. Режимы `-ap`, `-ar`, `-random` вводятся в чат, а `TriggerRegisterPlayerChatEvent` и `GetEventPlayerChatString` не реализованы | `core/…/simulation/data/CUnitData.java:171–172, 336–349`; список нативок — `core/…/parsers/jass/Jass2.java` |
| 44 | **Способности героев** | ✗ в большинстве по исходникам | Channel (`ANcl`) — тестовая заглушка `CAbilityChannelTest`: приказ с целью (юнит или точка) отклоняется, без цели — бесконечно проигрывает анимацию; события заклинания (`EVENT_PLAYER_UNIT_SPELL_EFFECT` и др.) не возникают, Base Order ID не читается. Поэтому триггерные способности на основе Channel не срабатывают. Прочие базы: ~25 способностей в Java и ~94 в ability builder (`core/assets/abilityBehaviors`), остальные коды становятся `CAbilityGenericDoNothing` | `core/…/abilities/test/CAbilityChannelTest.java:67,73`, `…/behaviors/test/CBehaviorChannelTest.java`, `core/…/simulation/data/CAbilityData.java:231,354` |
| 45 | **Смерть и респаун героя** | ✗ вероятно | Нативка `ReviveHero` не реализована, `TimerDialogDisplay` тоже (таймера респауна не будет). Как именно 6.83d воскрешает героев, по самой карте **[НЕ СВЕРЕНО]** | `Jass2.java` (нативок нет) |
| 46 | Волны крипов | **[НЕ СВЕРЕНО]** | `CreateUnit`, `IssuePointOrderById`, `IssuePointOrderLoc` есть; строкового `IssuePointOrder` нет. Какой вариант использует карта — не сверено | `Jass2.java` |
| 47 | Магазины предметов | частично, **[НЕ СВЕРЕНО]** | Продажа по `Sellitems`/`Makeitems` есть (`CAbilitySellItems`). Рецепты DotA собираются триггерами; `UnitInventorySize` не реализована | `CUnitData.java:336–349` |
| 48 | Табло, квесты | ✗ по исходникам | `MultiboardCreate` и вся группа multiboard, `CreateQuest` не реализованы — таблицы счёта и списка команд не будет | `Jass2.java` |
| 49 | Прочие нативки, которые нужны DotA | ✗ по исходникам | Не реализованы: `UnitApplyTimedLife` (призывы, иллюзии), `UnitResetCooldown` (Refresher Orb), `UnitShareVision`, `SetUnitPathing`, `InitGameCache` / `StoreInteger` / `SyncStoredInteger` | `Jass2.java` |
| 50 | Офлайн с ботами | ✗ | ИИ выключен (п. 41). В обычной DotA Allstars ботов и так нет — AI-версии карты отдельные | — |
| 51 | Онлайн P2P | механизм есть, с DotA бессмысленно (п. 43–45). 10 игроков — **[НЕ СВЕРЕНО]** | lockstep поверх WebRTC через `@poki/netlib` 0.0.18: лобби, слоты, коды. Лицензия netlib — **ISC** (сверено: `LICENSE` и `package.json` на теге `v0.0.18`). Адрес сигналинга — **третий аргумент конструктора** `new Network(gameID, rtcConfig?, signalingURL?)`, опции `signalingServer` нет. По умолчанию — `wss://netlib.poki.io/v0/signaling`; условия Poki для сторонних игр не опубликованы, библиотека в бете. Свой сервер (`cmd/signaling`, Go) требует PostgreSQL (`DATABASE_URL`). ID игры Warsmash в Poki захардкожен | `html/web-src/src/lib/poki-bridge.ts:99`, `html/web-src/src/lib/lobbyClient.ts:69`; netlib `lib/network.ts:39`, `internal/signaling/stores/setup.go` |
| 52 | DotA 6.84+ и 7.x | не обещаем | требуют патчей 1.27+ / Reforged, см. п. 40 | — |

**Вывод фазы 0.** Выбрать героя нельзя (п. 43), а если бы было можно — не работала бы большая часть способностей (п. 44) и, вероятно, респаун (п. 45). Это не мелкие баги, которые закрываются патчем в `vendor-patches/wc3/`: нужны продажа юнитов в магазинах, полноценная реализация Channel и событий заклинаний, чат-события, `ReviveHero`, multiboard и ещё ряд нативок — по сути, доработка движка, которой нет и в upstream.

### Интеграция Warsmash в сайт

| # | Что | Как сделано / что осталось |
|---|---|---|
| 53 | Пути от корня домена | В upstream `versionedAsset()` приклеивает `/` в начало (`html/web-src/src/lib/version.ts:24`), а `global.css:121` берёт `url('/bg.png')` — из подкаталога это не работало. **Исправлено** патчем `vendor-patches/wc3/0001`: Astro собирается с `base` = `WARSMASH_BASE` (`/games/wc3/` на VPS, `/<репозиторий>/games/wc3/` на Pages), `versionedAsset()` берёт его из `import.meta.env.BASE_URL`; `build-wc3.sh` проверяет, что `play/index.html` ссылается на `<база>_astro/`. Сборка привязана к пути: при смене `VITE_BASE` её надо пересобрать (`npm run fetch:wc3`) |
| 54 | Арт Blizzard в upstream | Заставка `goblin-tinker.webp` — рендер модели гоблина-механика из Warcraft III; фон `bg.png` — происхождение не сверено. Патч 0001 их больше не использует, `build-wc3.sh` удаляет оба файла из сборки |
| 55 | Требования к браузеру | `SharedArrayBuffer` не нужен. Нужны `OffscreenCanvas` (движок рисует в воркере) и OPFS с `createSyncAccessHandle` в воркерах. Всё с того же origin. **Сверено дымовым тестом** (`web/scripts/smoke-wc3.mjs` в workflow `wc3-engine`, headless Chromium, заголовки как у Caddy, 2026-10-28): страницы по `/games/wc3/` открываются без единого 404, `crossOriginIsolated`, `OffscreenCanvas` и OPFS есть, движок стартует в воркере и грузит `engine-worker-boot.js`, `scripts/gdx.wasm.js`, `engine-worker.js`, `assets/preload.txt` из базы (84 запроса). Дальше он ожидаемо останавливается: без .mpq `Gdx.files` не заводится (`ini ERROR … '$internal'` в консоли). С настоящими файлами игры, под `coi-sw.js` на Pages и во фрейме плеера — **[НЕ СВЕРЕНО]** (тесты W-02…W-09). Выбор папки — только `<input webkitdirectory>`. Firefox и Safari 17+ — **[НЕ СВЕРЕНО]** |
| 56 | Лицензии | Warsmash — AGPL-3.0. Сайт даёт ссылку на исходник точного коммита (страницы `#/wc3` и `#/licenses`), патчи лежат в репозитории, в сборке — `BUILD-INFO.txt` (коммит, патчи с SHA-256, путь, сигналинг) и `LICENSE-Warsmash.txt`. Код сайта остаётся MIT: Warsmash — отдельная сборка в `public/games/wc3/`, наш TypeScript его не импортирует |
| 57 | Плеер и хранилище | Плеер больше не ставит своим играм атрибут `credentialless`: у такого фрейма временное хранилище, и OPFS с файлами игры пропадал бы после перезагрузки. Чужие игры (`https://…`) по-прежнему грузятся с `credentialless`. Правый клик внутри фрейма движок перехватывает сам (`oncontextmenu` на странице `play/`); Pointer Lock движку не нужен — курсор он рисует сам |
| 58 | Сигналинг | По умолчанию — сервер Poki (`wss://netlib.poki.io/v0/signaling`): условия для сторонних сайтов не опубликованы, `@poki/netlib` в бете («свяжитесь с нами, если выходите в прод» — README netlib). ID игры — тот же, что у Warsmash (`lobbyClient.ts:69`, должен совпадать с Java-стороной), поэтому лобби общие с другими сайтами на Warsmash той же версии. Свой сервер: `docker-compose.wc3-signaling.yml` (netlib v0.0.18 + PostgreSQL) и маршрут `/wc3-signaling/*` в Caddyfile; адрес — `VITE_WC3_SIGNALING` (в `.env` для VPS, переменная репозитория `WC3_SIGNALING` для Pages). Без ключей Cloudflare своему серверу нечем выдавать TURN — игроки за строгим NAT не подключатся; наш coturn для этого не открываем (п. 20). Сборка образа сервера из git по хешу коммита — **[НЕ СВЕРЕНО]** на реальном docker |
| 59 | Интерфейс движка на английском | Тексты меню Warsmash (Play, Multiplayer, Manage assets, Host, Join by code) не переведены; на странице `#/wc3` они названы как есть |
| 60 | Сборка дольше | Warsmash собирается TeaVM на JDK 17: в GitHub Actions 2–9 минут — и в `pages.yml`, и в образе `web` (стадия `wc3`, `node:22-bookworm` + `openjdk-17-jdk-headless`). На VPS без сети до Maven Central/jitpack — `WITH_WC3=0` в `.env` (карточка останется, игра не откроется) |

### Как выбирали вариант (2026-10-28)

Взят Warsmash: единственный вариант, который работает целиком в браузере с файлами игрока, на GitHub Pages и без своего игрового сервера. Честный объём — мили и простые карты по сети; DotA — после доработки движка (п. 43–49), которой нет и в upstream. Для «настоящей» DotA остаётся путь вне браузера (своя WC3 1.26a + сеть ZeroTier и хост-бот) — не сделан. Отвергнутые варианты:

1. **rgnv/wc3-wasm** — порт движка OpenRealm (MIT) в wasm64, по README работают меню, мили, обе кампании и мультиплеер; есть проверка защищённой DotA-карты на уровне MPQ, но не самой игры. Данные — Reforged SD (CASC) из установки Battle.net, их раздаёт сервер; для нашей модели загрузку пришлось бы переделать на файлы игрока в браузере. Мультиплеер — нативный выделенный сервер и мост WebSocket ⇄ UDP, на Pages не заработает. Нужна поддержка wasm64 (Memory64) в браузере **[НЕ СВЕРЕНО]** по Safari.
2. **Chuck3CZ/wc3-web** — статическая перекомпиляция настоящего 1.26a (`Game.dll`) в WebAssembly, теоретически DotA 1:1. Проект на нулевой фазе; только Chrome (WebGPU); перекомпилированный модуль — производное от кода Blizzard, сайт не может его раздавать, каждый игрок собирал бы сам.
3. **Эмуляция Windows в браузере (Boxedwine)** — в веб-версии нет JIT, по словам автора медленно; для WC3 с Direct3D нереально.
4. **Облачный стриминг** — сервер хранил бы и запускал копию игры (против нашего принципа) и требовал бы GPU на каждого игрока.
5. **Свой Battle.net (PvPGN)** — клиенту нужен W3L, отключающий проверку подписи сервера; прецедент Blizzard против bnetd (2005). Самый рискованный юридически.
