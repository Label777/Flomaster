# CS 1.6 в браузере

Сайт, на котором Counter-Strike 1.6 запускается прямо во вкладке браузера: офлайн на любой карте и онлайн на вашем сервере. Движок — [Xash3D FWGS](https://github.com/FWGS/xash3d-fwgs), собранный в WebAssembly проектом [webxash3d-fwgs](https://github.com/yohimik/webxash3d-fwgs). Сеть браузер ↔ сервер — WebRTC.

Сайт **не хранит и не раздаёт файлы игры**. Игрок выбирает папки `valve` и `cstrike` из своей копии Half-Life/Counter-Strike в Steam; файлы читаются только в браузере и монтируются в память вкладки.

> Не связан с Valve. Counter-Strike — товарный знак Valve Corporation.

- Архитектура: [ARCHITECTURE.md](ARCHITECTURE.md)
- Ограничения и обходы: [KNOWN_ISSUES.md](KNOWN_ISSUES.md)
- Лицензии зависимостей: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- Приёмочные тесты: [TEST_PLAN.md](TEST_PLAN.md)
- Как добавить игру в каталог: [docs/ADDING_GAMES.md](docs/ADDING_GAMES.md)

Главная страница — каталог игр (поиск, фильтр по жанрам, карточки). Сейчас в нём Counter-Strike 1.6, Warcraft III: The Frozen Throne (бета: движок [Warsmash](https://github.com/ErikSom/WarsmashModEngine), свои файлы игрока, сеть между браузерами; DotA пока не работает — [KNOWN_ISSUES, раздел G](KNOWN_ISSUES.md#g-warcraft-iii-the-frozen-throne-warsmash-и-dota)) и демо-игра «Реакция». Новая игра добавляется одной записью в `web/src/catalog/games.ts`. Название сайта в шапке задаётся при сборке переменной `VITE_SITE_NAME` (по умолчанию Flomaster).

## Перед запуском (обязательно)

Среда, в которой писался код, не имела доступа к npm, GitHub и Docker Hub, поэтому три вещи надо сделать на машине с интернетом:

1. `cd web && npm run fetch:cs16 && npm run fetch:wc3 && npm install && npm run build` — локальная сборка (пакет `cs16-client` снят с npm, первая команда скачивает его файлы с jsDelivr со сверкой хешей; вторая собирает Warcraft III — нужен JDK 17); закоммитьте появившийся `package-lock.json`. В GitHub Actions сборка уже проходит.
2. `scripts/verify-upstream.sh` — сверить протокол WebRTC-сигналинга с upstream и при расхождении поправить `web/src/net/protocol.ts` и `CS_SIGNAL_PATH` (KNOWN_ISSUES №1).
3. Пройти тесты T-01…T-18 из TEST_PLAN.md, прежде всего онлайн-игру двух игроков.

## Состав

| Каталог | Что внутри |
|---|---|
| `web/` | сайт и игровой клиент (Vite + TypeScript), образ Caddy со статикой |
| `api/` | `/api/servers`, `/api/ice` (TURN-учётки), `/api/health` — Node без зависимостей |
| `deploy/` | Caddyfile, шаблоны `server.cfg` и `turnserver.conf`, `mapcycle.txt` |
| `scripts/` | деплой одной командой, закрепление образов, steamcmd, проверки |
| `docker-compose.yml` | caddy (`web`), `api`, `cs-server` (`yohimik/cs-web-server`), `coturn` |

## Сайт на GitHub Pages

Сайт можно бесплатно опубликовать на GitHub Pages: `https://<владелец>.github.io/<репозиторий>/`.

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Сделайте push в `main` — workflow `.github/workflows/pages.yml` соберёт и опубликует сайт (вкладка Actions).

На Pages работает **офлайн-игра**. Игровой сервер на GitHub запустить нельзя: Pages раздаёт только статические файлы, а GitHub Actions не предназначены для постоянно работающих серверов. Для онлайна нужен VPS:

1. Поднимите сервер по разделу «Деплой на VPS» ниже и добавьте в его `.env` строку `ALLOWED_ORIGINS=https://<владелец>.github.io`.
2. В репозитории: Settings → Secrets and variables → Actions → Variables → `API_BASE` = `https://<домен-вашего-VPS>`.
3. Перезапустите workflow `pages` — в «Серверах» и лаунчере появится ваш сервер.

На Pages нельзя задать заголовки COOP/COEP, поэтому их добавляет service worker (`web/public/coi-sw.js`); при самом первом заходе страница один раз перезагрузится.

## Деплой на VPS

Нужно: Linux VPS с публичным IPv4, Docker Engine 24+ с плагином Compose v2, домен с A-записью на IP сервера.

```bash
git clone <ваш-репозиторий> cs16-web && cd cs16-web
cp .env.example .env
nano .env                 # DOMAIN, PUBLIC_IP, ACME_EMAIL, RCON_PASSWORD, TURN_SECRET
scripts/deploy.sh --pin   # одна команда: сборка, запуск, закрепление образов по digest
```

Откройте в файрволе:

| Порт | Протокол | Зачем |
|---|---|---|
| 80, 443 | TCP | сайт, Let's Encrypt |
| 443 | UDP | HTTP/3 (необязательно) |
| `GAME_PORT` (27018) | UDP и TCP | WebRTC игрового сервера |
| 3478 | UDP и TCP | STUN/TURN |
| 49160–49200 | UDP | ретрансляция TURN |

Повторный деплой после `git pull` — снова `scripts/deploy.sh`. Логи — `docker compose logs -f cs-server`. Без скрипта: `docker compose up -d --build` (шаблоны конфигов при этом должны быть уже отрендерены скриптом хотя бы один раз).

### Файлы игры на сервере

По умолчанию сервер использует файлы из образа `yohimik/cs-web-server` (образ при сборке ставит Half-Life Dedicated Server через steamcmd). Чтобы поставить свою копию:

```bash
scripts/install-server-files.sh               # steamcmd → ./data/hlds (app 90, mod cstrike)
docker compose -f docker-compose.yml -f docker-compose.steamcmd.yml up -d
```

В репозитории файлов Valve нет и быть не должно — это проверяет `scripts/check-no-valve-files.sh` в CI.

### Настройка сервера

`.env` → `START_MAP`, `MAX_PLAYERS`, `SERVER_NAME`, `RCON_PASSWORD`. Остальное — в `deploy/cs-server/server.cfg.tmpl` (рендерится в `server.cfg` при деплое) и `deploy/cs-server/mapcycle.txt`. В ротации только стандартные карты: у игроков нет докачки карт с сервера.

## Как игроку подготовить файлы

1. Установите Counter-Strike (1.6) в Steam.
2. Steam → Библиотека → Counter-Strike → Управление → Просмотреть локальные файлы. Откроется папка `Half-Life`, в ней есть `valve` и `cstrike`.
   - Windows: `C:\Program Files (x86)\Steam\steamapps\common\Half-Life`
   - macOS: `~/Library/Application Support/Steam/steamapps/common/Half-Life`
   - Linux: `~/.steam/steam/steamapps/common/Half-Life`
3. На сайте нажмите «Играть» → «Выбрать папку игры» и укажите папку `Half-Life` (или по отдельности `valve` и `cstrike`, или `.zip`, в корне которого лежат `valve/` и `cstrike/`).
4. Укажите ник, разрешение, чувствительность и режим → «Запустить».

Поддерживаются настольные Chrome, Edge, Firefox и Safari 15+. В Chrome и Edge папку можно запомнить, чтобы не выбирать её каждый раз.

## Разработка

```bash
cd web && npm run fetch:cs16 && npm install && npm run dev   # http://localhost:5173
cd api && npm start                       # http://localhost:8080
```

`web` в режиме разработки проксирует `/api` и `/rtc` на `DEV_API_TARGET` (по умолчанию `http://localhost:8080`). Проверки: `npm run typecheck` в `web/`, `npm test` в `api/`, `scripts/check-no-valve-files.sh`.

Сверка сетевого протокола с upstream: `scripts/verify-upstream.sh` (см. KNOWN_ISSUES.md, п. 1).

## Лицензия

Код репозитория — MIT ([LICENSE](LICENSE)). Сторонние компоненты — на их условиях, см. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
