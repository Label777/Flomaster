#!/usr/bin/env bash
# Сборка веб-порта Warsmash (Warcraft III) на закреплённом коммите (KNOWN_ISSUES.md, раздел G).
#
# Что делает:
#   1. берёт исходники ErikSom/WarsmashModEngine ровно на коммите WC3_COMMIT и сверяет хеш;
#   2. накладывает наши патчи vendor-patches/wc3/*.patch (если они есть) по алфавиту;
#   3. собирает ./gradlew :html:buildWeb (TeaVM → JS, затем сайт-оболочка Astro + Preact);
#   4. удаляет из результата картинки, которые мы не раздаём (арт Blizzard в заставке upstream и фон
#      неизвестного происхождения; наш патч 0001 их больше не использует);
#   5. падает, если в результате оказались файлы игры (.mpq .w3x .blp .mdx …);
#   6. копирует результат в OUT и пишет туда BUILD-INFO.txt (коммит, патчи, где исходники — AGPL-3.0).
#
#   scripts/build-wc3.sh [OUT]          OUT по умолчанию — build/wc3 (в git не попадает)
#   WC3_SRC=<каталог>   — использовать готовый клон (коммит всё равно сверяется, патчи накладываются)
#   WC3_LOG=<файл>      — куда писать лог Gradle/npm (по умолчанию <временный каталог>/build.log)
#   KEEP=1              — не удалять временный клон (путь будет напечатан)
#   WC3_BASE=<путь>     — где сборка будет лежать на сайте: /games/wc3/ (по умолчанию) или
#                         /<репозиторий>/games/wc3/ на GitHub Pages; начинается и заканчивается на «/»
#   VITE_WC3_SIGNALING=<wss://…> — свой сервер сигналинга @poki/netlib; пусто — сервер Poki
#
# Нужно: git, JDK 17 (Gradle 7.3.3 из wrapper upstream на JDK 21 не запускается), Node 18+ с npm,
# сеть до github.com, services.gradle.org, Maven Central, jitpack.io и registry.npmjs.org.
# Код выхода: 0 — собрано; 1 — ошибка сборки или проверки результата; 2 — не хватает инструментов или сети.
set -euo pipefail

# shellcheck source=scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WC3_REPO=${WC3_REPO:-https://github.com/ErikSom/WarsmashModEngine}
# Ветка HTML, коммит от 2026-05-11 «sim determinism fixes + version-gated lobbies + dump diagnostics».
# Менять только вместе с таблицей совместимости в KNOWN_ISSUES.md (раздел G).
WC3_COMMIT=${WC3_COMMIT:-d69e772b4dede6fd3569f9949a3180cdfea4635b}
OUT=${1:-$REPO_ROOT/build/wc3}
PATCH_DIR=$REPO_ROOT/vendor-patches/wc3

# Картинки upstream, которые мы не раздаём: рендер модели юнита из Warcraft III (арт Blizzard).
STRIP_FILES=(goblin-tinker.webp bg.png)
# Расширения файлов игры: их в сборке быть не должно ни при каких условиях.
GAME_EXT_RE='\.(mpq|w3x|w3m|w3n|w3g|w3z|blp|mdx|mdl|casc|dds|flac|wav|mp3)$'
# Что должно появиться после сборки (имена из BuildWorkerTeaVM, BuildEngineWorkerTeaVM, webapp-src, Astro).
REQUIRED_FILES=(index.html play/index.html multiplayer/index.html engine-worker.js engine-worker-boot.js worker.js worker-boot.js)

WC3_BASE=${WC3_BASE:-/games/wc3/}
[[ $WC3_BASE == /*/ || $WC3_BASE == / ]] || {
  log_error "WC3_BASE должен начинаться и заканчиваться на «/», получено «$WC3_BASE»"
  exit 2
}
WC3_SIGNALING=${VITE_WC3_SIGNALING:-}
if [[ -n $WC3_SIGNALING && ! $WC3_SIGNALING =~ ^wss?:// ]]; then
  log_error "VITE_WC3_SIGNALING должен начинаться с wss:// (или ws:// для локальной проверки), получено «$WC3_SIGNALING»"
  exit 2
fi

[[ $WC3_COMMIT =~ ^[0-9a-f]{40}$ ]] || {
  log_error "WC3_COMMIT должен быть полным SHA-1 из 40 символов, получено «$WC3_COMMIT»"
  exit 2
}

need() {
  command -v "$1" >/dev/null 2>&1 || {
    log_error "нужен $1 ($2)"
    exit 2
  }
}
need git 'для исходников Warsmash'
need node 'Node 18+ для сборки сайта-оболочки Astro'
need npm 'для зависимостей сайта-оболочки'

# Gradle wrapper берёт java из JAVA_HOME, иначе из PATH.
java_bin=java
if [[ -n ${JAVA_HOME:-} ]]; then
  java_bin=$JAVA_HOME/bin/java
fi
command -v "$java_bin" >/dev/null 2>&1 || {
  log_error "нужен JDK 17: не найден $java_bin (задайте JAVA_HOME)"
  exit 2
}
# Первая строка может быть «Picked up JAVA_TOOL_OPTIONS…» — ищем строку с version "…".
java_ver=$("$java_bin" -version 2>&1 | grep -m1 -oE 'version "[0-9][^"]*"' | grep -oE '[0-9][^"]*' || true)
java_major=${java_ver%%.*}
if [[ $java_major != 17 ]]; then
  log_error "нужен JDK 17, найдена Java ${java_ver:-неизвестной версии} ($java_bin)."
  log_error "Gradle 7.3.3 из wrapper Warsmash не запускается на JDK 21. Укажите JAVA_HOME на Temurin 17."
  exit 2
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/wc3-build.XXXXXX")
# shellcheck disable=SC2317  # вызывается через trap
cleanup() {
  if [[ -n ${KEEP:-} ]]; then
    log_info "временный каталог сохранён: $tmp"
  else
    rm -rf "$tmp"
  fi
}
trap cleanup EXIT
LOG=${WC3_LOG:-$tmp/build.log}
: >"$LOG"

# fail_with_log MESSAGE — печатает хвост лога и выходит с кодом 1
fail_with_log() {
  log_error "$1"
  if [[ -s $LOG ]]; then
    printf '\n---- последние строки лога (%s) ----\n' "$LOG" >&2
    grep -vE '^[[:space:]]*$' "$LOG" | tail -n 40 >&2 || true
  fi
  exit 1
}

# --- 1. Исходники на закреплённом коммите -----------------------------------
if [[ -n ${WC3_SRC:-} ]]; then
  src=$(cd "$WC3_SRC" && pwd)
  log_info "исходники: готовый клон $src"
else
  src=$tmp/warsmash
  log_info "скачиваю $WC3_REPO на коммите ${WC3_COMMIT:0:12}…"
  # fetch по хешу: GitHub отдаёт достижимый коммит, а --depth 1 не тянет историю
  if ! {
    git init --quiet "$src" &&
      git -C "$src" remote add origin "$WC3_REPO" &&
      git -C "$src" fetch --quiet --depth 1 origin "$WC3_COMMIT" &&
      git -C "$src" checkout --quiet --detach FETCH_HEAD
  } 2>"$tmp/clone.err"; then
    log_error "не удалось скачать $WC3_REPO на коммите $WC3_COMMIT:"
    cat "$tmp/clone.err" >&2
    exit 2
  fi
fi

head=$(git -C "$src" rev-parse HEAD 2>/dev/null || true)
if [[ $head != "$WC3_COMMIT" ]]; then
  log_error "в $src коммит ${head:-<не git-репозиторий>}, а закреплён $WC3_COMMIT"
  exit 1
fi
if [[ -z ${WC3_SRC:-} ]] && [[ -n $(git -C "$src" status --porcelain) ]]; then
  log_error "в свежем клоне есть изменения — исходники не совпадают с коммитом"
  exit 1
fi
log_ok "исходники: $(git -C "$src" log -1 --format='%H %cs %s')"

# --- 2. Наши патчи -----------------------------------------------------------
patches=()
if [[ -d $PATCH_DIR ]]; then
  while IFS= read -r -d '' p; do
    patches+=("$p")
  done < <(find "$PATCH_DIR" -maxdepth 1 -type f -name '*.patch' -print0 | sort -z)
fi
for p in "${patches[@]}"; do
  if ! git -C "$src" apply --check "$p" 2>"$tmp/patch.err"; then
    log_error "патч не накладывается: ${p#"$REPO_ROOT"/}"
    cat "$tmp/patch.err" >&2
    exit 1
  fi
  git -C "$src" apply "$p"
  log_ok "патч: ${p#"$REPO_ROOT"/}"
done
((${#patches[@]} > 0)) || log_info "патчей в ${PATCH_DIR#"$REPO_ROOT"/} нет — собираю upstream как есть"

# --- 3. Сборка ---------------------------------------------------------------
web_src=$src/html/web-src
if [[ -f $web_src/package-lock.json ]]; then
  log_info "npm ci в html/web-src (лог: $LOG)…"
  # Если node_modules уже есть, :html:buildWebSrc не запускает свой npm install без lock-файла.
  if ! (cd "$web_src" && npm ci --no-audit --no-fund) >>"$LOG" 2>&1; then
    if grep -qiE 'ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network' "$LOG"; then
      log_error "нет доступа к registry.npmjs.org"
      exit 2
    fi
    fail_with_log "npm ci в html/web-src завершился ошибкой"
  fi
fi

log_info "./gradlew :html:buildWeb (TeaVM, в GitHub Actions 2–9 минут; лог: $LOG)…"
chmod +x "$src/gradlew"
log_info "путь на сайте: $WC3_BASE; сигналинг: ${WC3_SIGNALING:-сервер Poki по умолчанию}"
# WARSMASH_BASE читает astro.config.mjs (патч 0001), PUBLIC_WC3_SIGNALING — poki-bridge.ts.
if ! (cd "$src" && WARSMASH_BASE=$WC3_BASE PUBLIC_WC3_SIGNALING=$WC3_SIGNALING \
  ./gradlew --no-daemon --console=plain :html:buildWeb) >>"$LOG" 2>&1; then
  if grep -qiE 'Could not resolve|UnknownHostException|Connection refused|Could not GET|Could not HEAD|Unable to tunnel|403 Forbidden' "$LOG"; then
    log_error "Gradle не смог скачать зависимости или сам себя (нужен доступ к services.gradle.org, Maven Central, jitpack.io)"
    grep -m5 -iE 'Could not resolve|UnknownHostException|Could not GET|Unable to tunnel|403 Forbidden' "$LOG" >&2 || true
    exit 2
  fi
  fail_with_log "сборка Warsmash завершилась ошибкой"
fi

dist=$src/html/build/dist/webapp
[[ -d $dist ]] || fail_with_log "после сборки нет каталога html/build/dist/webapp"
missing=()
for f in "${REQUIRED_FILES[@]}"; do
  [[ -f $dist/$f ]] || missing+=("$f")
done
((${#missing[@]} == 0)) || fail_with_log "в сборке нет файлов: ${missing[*]}"
# Патч 0001 должен был перевести Astro на WC3_BASE: скрипты страниц грузятся из <база>_astro/.
if [[ $WC3_BASE != / ]] && ! grep -qF "${WC3_BASE}_astro/" "$dist/play/index.html"; then
  fail_with_log "play/index.html не ссылается на ${WC3_BASE}_astro/ — путь сборки не применился (патч vendor-patches/wc3/0001?)"
fi

# --- 4–5. Чистка и проверка результата ----------------------------------------
stripped=()
for name in "${STRIP_FILES[@]}"; do
  while IFS= read -r -d '' f; do
    rm -f "$f"
    stripped+=("${f#"$dist"/}")
    log_warn "удалён ${f#"$dist"/}: картинка upstream, которую сайт не раздаёт"
  done < <(find "$dist" -type f -iname "$name" -print0)
done

game_files=()
while IFS= read -r -d '' f; do
  rel=${f#"$dist"/}
  lower=${rel,,}
  if [[ $lower =~ $GAME_EXT_RE ]]; then
    game_files+=("$rel")
  fi
done < <(find "$dist" -type f -print0)
if ((${#game_files[@]} > 0)); then
  log_error "в сборке есть файлы, похожие на файлы игры (${#game_files[@]}) — такую сборку раздавать нельзя:"
  printf '  %s\n' "${game_files[@]}" >&2
  exit 1
fi

# --- 6. Результат --------------------------------------------------------------
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

{
  echo "Warsmash (веб-порт Warcraft III), сборка для Flomaster"
  echo
  echo "Лицензия: GNU AGPL-3.0 (LICENSE в исходниках)."
  echo "Исходники: $WC3_REPO/tree/$WC3_COMMIT"
  echo "Коммит:    $(git -C "$src" log -1 --format='%H (%cs) %s')"
  if ((${#patches[@]} > 0)); then
    echo "Патчи Flomaster поверх коммита (vendor-patches/wc3 в репозитории сайта):"
    for p in "${patches[@]}"; do
      printf '  %s  sha256:%s\n' "${p##*/}" "$(sha256_of "$p")"
    done
  else
    echo "Патчей нет: сборка соответствует коммиту upstream."
  fi
  if ((${#stripped[@]} > 0)); then
    echo "Удалено из сборки (арт upstream, который сайт не раздаёт): ${stripped[*]}."
  else
    echo "Удалять из сборки ничего не пришлось (искали: ${STRIP_FILES[*]})."
  fi
  echo "Путь на сайте: $WC3_BASE"
  echo "Сигналинг: ${WC3_SIGNALING:-wss://netlib.poki.io/v0/signaling (Poki, по умолчанию)}"
  echo "Собрано: $(date -u +%Y-%m-%dT%H:%M:%SZ), JDK $java_ver, Node $(node -v)"
  echo
  echo "Файлы игры Warcraft III в сборку не входят: игрок выбирает свою копию, файлы читаются только в его браузере."
} >"$dist/BUILD-INFO.txt"
# AGPL-3.0 §4–6: текст лицензии едет вместе с объектным кодом.
cp "$src/LICENSE" "$dist/LICENSE-Warsmash.txt"

mkdir -p "$(dirname "$OUT")"
rm -rf "$OUT"
cp -a "$dist" "$OUT"
size=$(du -sh "$OUT" | cut -f1)
log_ok "сборка Warsmash ${WC3_COMMIT:0:12}: $OUT ($size, $(find "$OUT" -type f | wc -l | tr -d ' ') файлов)"
log_info "сборка рассчитана на адрес $WC3_BASE: раздайте каталог так, чтобы она открывалась по этому пути (чек-лист — TEST_PLAN.md, раздел 5)"
