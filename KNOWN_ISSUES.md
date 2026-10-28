# KNOWN_ISSUES

Что не работает в браузере, что не удалось проверить без доступа к upstream и как это обойти. Пункты с пометкой **[НЕ СВЕРЕНО]** написаны по документации upstream (DeepWiki, README на Docker Hub, `.d.ts` пакета на unpkg) без доступа к исходникам. Их нужно проверить до публичного запуска: ручные проверки описаны в [TEST_PLAN.md](TEST_PLAN.md).

Содержание: [A. Не сверено с upstream](#a-не-сверено-с-upstream) · [B. Браузеры](#b-ограничения-браузеров) · [C. Сервер и сеть](#c-сервер-и-сеть) · [D. Игра и моды](#d-игра-и-моды) · [E. Сборка и деплой](#e-сборка-и-деплой) · [F. Список неподдерживаемых модов Xash3D FWGS](#f-сверка-со-списком-неподдерживаемых-модов-xash3d-fwgs)

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
