# THIRD_PARTY_NOTICES

Сторонние компоненты, которые сайт «CS 1.6 в браузере» раздаёт браузерам, запускает на сервере или использует при сборке. Собственный код репозитория — MIT, см. [LICENSE](LICENSE).

Этот файл при сборке копируется в `dist/THIRD_PARTY_NOTICES.txt` и показывается на странице «Лицензии» (`#/licenses`).

> **Как читать статус лицензии.** «сверено» — лицензия видна в первичном источнике (файл `package.json` пакета, README образа на Docker Hub). «по вторичным источникам» — лицензия взята из пакетов дистрибутивов или описаний (nixpkgs, Gentoo, DeepWiki), а не из LICENSE самого проекта. Где лицензию не удалось увидеть ни в одном источнике, написано: «лицензию сверить с LICENSE в репозитории upstream». До публичного запуска все такие пункты нужно закрыть: скачать upstream на закреплённых версиях (`scripts/verify-upstream.sh`, `KEEP=1`) и сверить файлы `LICENSE`/`COPYING`.

## 1. Компоненты, которые раздаются браузерам

Эти файлы лежат в `dist/` и скачиваются браузером игрока.

| Компонент | Версия | Upstream | Лицензия | Статус |
|---|---|---|---|---|
| `xash3d-fwgs` (npm): JS-обёртка `Xash3D`, `Net` | `1.2.2` (сборка `1.2.2+commit.7c58854`) | https://github.com/yohimik/webxash3d-fwgs (`packages/xash3d-fwgs`) | MIT | сверено: поле `license` в `package.json` пакета. Файла LICENSE в пакете нет (в нём только `dist/`, `README.md`, `package.json`). Строку copyright сверить с LICENSE в репозитории upstream |
| Движок Xash3D FWGS, скомпилированный в WebAssembly: `xash.wasm`, `filesystem_stdio.wasm`, `libref_webgl2.wasm`, `libref_soft.wasm` (входят в npm-пакет `xash3d-fwgs`) | исходники — submodule `packages/xash3d-fwgs/xash3d-fwgs` → https://github.com/yohimik/xash3d-fwgs (форк https://github.com/FWGS/xash3d-fwgs) на коммите сборки `1.2.2` | https://github.com/FWGS/xash3d-fwgs | GPL-3.0-or-later | по вторичным источникам: nixpkgs (`gpl3Plus`), Gentoo (`VALVE GPL-2+ GPL-3+ Half-Life-1-SDK`). Gentoo указывает и лицензии Valve, то есть в движке есть файлы под лицензией Half-Life SDK. Лицензию сверить с LICENSE в репозитории upstream |
| `cs16-client` (npm): `cl_dlls/client_emscripten_wasm32.wasm`, `cl_dlls/menu_emscripten_wasm32.wasm`, `dlls/cs_emscripten_wasm32.wasm`, `extras.pk3` | `0.1.2` (версия по DeepWiki, **с npm не сверена**) | https://github.com/yohimik/webxash3d-fwgs (`packages/cs16-client`), submodule https://github.com/yohimik/cs16-client | MIT для npm-обёртки (по DeepWiki). Скомпилированный игровой код — лицензию сверить с LICENSE в репозитории upstream | по вторичным источникам. Код клиента и сервера CS происходит от Half-Life SDK, поэтому на него, вероятно, распространяются условия лицензии Half-Life 1 SDK (см. §4) |
| Half-Life SDK (`hlsdk-portable`) — основа игрового кода в `cs16-client` | как в `cs16-client` | https://github.com/FWGS/hlsdk-portable (форк для wasm: https://github.com/yohimik/hlsdk-portable), исходный SDK: https://github.com/ValveSoftware/halflife | Half-Life 1 SDK LICENSE (Valve) | по первичному источнику (LICENSE в `ValveSoftware/halflife`): бесплатное использование и распространение модов, коммерческое использование — только по договорённости с Valve |
| SDL2 (порт Emscripten), вероятно, вкомпилирован в `xash.wasm` | версия порта Emscripten 4.0.17 | https://github.com/libsdl-org/SDL | zlib | **не подтверждено**, что SDL2 входит в сборку: SDL2 упоминается в инструкции по сборке webxash3d и в зависимостях пакета движка в Gentoo. Лицензию и факт использования сверить с LICENSE и скриптами сборки в репозитории upstream |
| Среда выполнения Emscripten (JS-«клей» и libc/libc++ в wasm) | 4.0.17 (версия сборки по DeepWiki) | https://github.com/emscripten-core/emscripten | MIT или University of Illinois/NCSA (на выбор), для musl/libc++ — их собственные разрешительные лицензии | лицензию сверить с LICENSE в репозитории upstream |
| JSZip — чтение `.zip` в браузере | `3.10.1` | https://github.com/Stuk/jszip | двойная: MIT **или** GPL-3.0. **Мы используем JSZip под MIT** | сверено по описанию пакета. Текст MIT и строку copyright сверить с LICENSE в репозитории upstream |
| pako — распаковка deflate, входит в сборку JSZip | зависимость `jszip@3.10.1` | https://github.com/nodeca/pako | MIT (часть кода — zlib) | лицензию сверить с LICENSE в репозитории upstream |
| Служебный JS-код Vite в бандле (preload-хелперы) | `7.1.11` | https://github.com/vitejs/vite | MIT | лицензию сверить с LICENSE в репозитории upstream |

**Не раздаётся сайтом**, хотя и есть в npm-пакете `cs16-client`: модуль ботов YaPB (`dlls/yapb_emscripten_wasm32.wasm`). Наш код его не импортирует, поэтому Vite не кладёт его в `dist/`. Upstream YaPB: https://github.com/yapb/yapb. Лицензию сверить с LICENSE в репозитории upstream до того, как модуль будет подключён (см. KNOWN_ISSUES, офлайн-боты).

Шрифты, иконки и изображения со стороны не используются: шрифты системные, знак сайта и `favicon.svg` нарисованы для проекта.

## 2. Компоненты, которые работают на сервере

Образы скачивает администратор с Docker Hub на свою VPS. Репозиторий их не содержит и не распространяет.

| Компонент | Версия | Upstream | Лицензия | Статус |
|---|---|---|---|---|
| `yohimik/cs-web-server` — игровой сервер и WebRTC-сигналинг | `latest`, закрепляется по digest `scripts/pin-images.sh` | https://hub.docker.com/r/yohimik/cs-web-server, исходники: https://github.com/yohimik/webxash3d-fwgs (`docker/cs-web-server`) | MIT (код образа) | сверено: README на Docker Hub («This project is licensed under the MIT License»). Внутри образа — компоненты со своими лицензиями (ниже) |
| ├ Pion WebRTC (Go) | по `go.mod` образа | https://github.com/pion/webrtc | MIT | лицензию и версию сверить с LICENSE и `go.mod` в репозитории upstream |
| ├ Xash3D FWGS (нативная сборка i386, выделенный сервер) | по образу | https://github.com/FWGS/xash3d-fwgs | GPL-3.0-or-later | по вторичным источникам, см. §1 |
| ├ Игровой код CS (серверная DLL) | по образу | см. `cs16-client` / HLSDK | см. §1 и §4 | лицензию сверить с LICENSE в репозитории upstream |
| └ Файлы Half-Life Dedicated Server (`valve/`, `cstrike/`), которые образ ставит через steamcmd | — | Valve | проприетарные, Steam Subscriber Agreement | наш сайт их **не раздаёт** (`valve.zip` не монтируется, порт 27016 не публикуется) |
| `yohimik/cs-web-server-metpamx` (вариант с Metamod/AMX Mod X, у нас не используется) | — | https://hub.docker.com/r/yohimik/cs-web-server-metpamx | Metamod — GPL-2.0, AMX Mod X — GPL-2.0 (по общеизвестным данным, не сверено) | лицензию сверить с LICENSE в репозиториях upstream, если вариант будет включён |
| Caddy — HTTPS, статика, прокси | `2.11-alpine` → digest | https://github.com/caddyserver/caddy | Apache-2.0 | лицензию сверить с LICENSE в репозитории upstream |
| coturn — STUN/TURN | `4.6.3-alpine` → digest | https://github.com/coturn/coturn | BSD-3-Clause | лицензию сверить с LICENSE в репозитории upstream |
| Node.js — API (`api/`) и сборка сайта | `22` (`node:22-alpine`) → digest | https://github.com/nodejs/node | MIT (плюс лицензии встроенных библиотек, файл LICENSE в дистрибутиве Node) | лицензию сверить с LICENSE в репозитории upstream |
| Alpine Linux — базовый слой образов `caddy`, `coturn`, `node` | по образам | https://alpinelinux.org | разные (пакеты дистрибутива) | — |
| `steamcmd/steamcmd` — только для необязательного `scripts/install-server-files.sh` | `latest` | https://hub.docker.com/r/steamcmd/steamcmd | образ — лицензию сверить с LICENSE в репозитории upstream; сам SteamCMD — проприетарный (Valve) | используется только по желанию администратора |

Если вы публикуете собранный образ `web` (Caddy + статика) в реестр, вы распространяете Caddy (Apache-2.0) и всё из §1. Тогда к образу нужно приложить этот файл и тексты лицензий. Пока образы собираются только на своей VPS, они не распространяются.

## 3. Инструменты сборки (в сайт не попадают)

| Компонент | Версия | Upstream | Лицензия |
|---|---|---|---|
| Vite | `7.1.11` | https://github.com/vitejs/vite | MIT (лицензию сверить с LICENSE в репозитории upstream) |
| TypeScript | `5.9.3` | https://github.com/microsoft/TypeScript | Apache-2.0 (лицензию сверить с LICENSE в репозитории upstream). Код рантайма TypeScript (`tslib`) в бандл не попадает |
| Транзитивные зависимости Vite (Rollup, esbuild и др.) | по `package-lock.json` | — | в основном MIT/ISC/BSD. Полный список — `npx license-checker --production=false` после первого `npm install` |
| GitHub Actions: `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `docker/setup-buildx-action` | `v4`/`v3` | github.com/actions, github.com/docker | MIT/Apache-2.0 (лицензию сверить с LICENSE в репозиториях upstream) |

## 4. GPL: где взять исходный код движка

Браузеру отдаются скомпилированные в WebAssembly файлы движка Xash3D FWGS (`xash.wasm`, `filesystem_stdio.wasm`, `libref_webgl2.wasm`, `libref_soft.wasm`). Если движок под GPL-3.0, раздача этих файлов — распространение объектного кода. GPL-3.0 §6 требует дать получателю доступ к соответствующему исходному коду.

Исходный код для закреплённой версии:

- npm-пакет: `xash3d-fwgs@1.2.2`, в `package.json` версия `1.2.2+commit.7c58854`;
- репозиторий сборки: https://github.com/yohimik/webxash3d-fwgs, коммит `7c58854` (пакет `packages/xash3d-fwgs`, скрипты сборки, Emscripten 4.0.17);
- исходники движка: submodule `packages/xash3d-fwgs/xash3d-fwgs` → https://github.com/yohimik/xash3d-fwgs, на коммите, который записан в submodule на коммите `7c58854`. Узнать его:
  ```bash
  UPSTREAM_REF=7c58854 KEEP=1 scripts/verify-upstream.sh   # путь клона печатается в конце
  git -C <клон> ls-tree HEAD packages/xash3d-fwgs/xash3d-fwgs
  ```
- основной проект движка: https://github.com/FWGS/xash3d-fwgs.

**Что сделать до публичного запуска** (оператор сайта):

1. Сверить, что `7c58854` — коммит репозитория `yohimik/webxash3d-fwgs`, и записать сюда точный хэш коммита submodule движка.
2. Сделать архив исходников (`git archive` для обоих коммитов, включая submodule) и положить его рядом с сайтом или в свой публичный репозиторий. По GPL-3.0 §6(d) ссылка на чужой сервер допустима, но доступность исходников обязан обеспечивать тот, кто распространяет. Своя копия снимает риск, что upstream удалит коммит.
3. То же для `cs16-client@0.1.2`, если после сверки его лицензия окажется copyleft.

## 5. Ограничение Half-Life SDK: сайт должен быть бесплатным

Игровой код Counter-Strike в `cs16-client` (клиентская и серверная библиотеки) и часть движка происходят от Half-Life 1 SDK. Лицензия SDK (https://github.com/ValveSoftware/halflife/blob/master/LICENSE) разрешает бесплатно использовать SDK для модов к играм на движке Half-Life и **распространять их только бесплатно**. Для коммерческого использования нужно отдельное разрешение Valve (sourceengine@valvesoftware.com).

Следствия для сайта:

- **за клиент, вход в игру или доступ к серверу нельзя брать плату** (подписки, платный доступ, продажа предметов и т. п.);
- распространяя код, производный от SDK, нужно сохранять его уведомления об авторских правах и отказ от гарантий;
- лицензия SDK не совместима с GPL. Это давняя известная проблема экосистемы Xash3D/HLSDK, и решать её — дело upstream. Мы не меняем и не перелицензируем эти компоненты, а раздаём их в том виде, в каком они опубликованы.

## 6. Товарные знаки и файлы игры

Не связан с Valve. Counter-Strike — товарный знак Valve Corporation.

Half-Life, Counter-Strike, Steam и связанные с ними названия и логотипы — товарные знаки Valve Corporation. Сайт не связан с Valve, Valve его не одобряла и не поддерживает. Сайт не хранит и не раздаёт файлы игры (`valve/`, `cstrike/`: карты, модели, звуки, текстуры). Каждый игрок использует свою копию из Steam: файлы читаются только в его браузере и никуда не отправляются. Файлы на сервере ставит администратор из своей копии.

## 7. Тексты лицензий

Короткие разрешительные лицензии требуют приложить свой текст. Полные тексты:

- MIT — https://opensource.org/license/mit (для `xash3d-fwgs`, `cs16-client`, JSZip, pako, Vite, Pion, Node.js и образа `cs-web-server` — со строками copyright из их файлов LICENSE);
- GPL-3.0 — https://www.gnu.org/licenses/gpl-3.0.txt;
- Apache-2.0 — https://www.apache.org/licenses/LICENSE-2.0.txt;
- BSD-3-Clause — https://opensource.org/license/bsd-3-clause;
- zlib — https://zlib.net/zlib_license.html;
- Half-Life 1 SDK LICENSE — https://github.com/ValveSoftware/halflife/blob/master/LICENSE.

После первого `npm install` с сетью (появятся `web/package-lock.json` и `web/node_modules`) тексты лицензий с настоящими строками copyright собираются командой `npx license-checker --production --files <каталог>`. Её результат стоит добавить в этот файл.
