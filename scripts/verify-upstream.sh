#!/usr/bin/env bash
# Сверка сетевого протокола с upstream (KNOWN_ISSUES.md, п. 1).
# Клонирует yohimik/webxash3d-fwgs на ref UPSTREAM_REF (по умолчанию main) во временный каталог
# и печатает места кода, по которым надо сверить web/src/net/protocol.ts и CS_SIGNAL_PATH:
#   - браузерный клиент docker/cs-web-server/src/client: WebSocket, data channel, формат сообщений;
#   - Go-сервер: HTTP-маршруты, WebSocket, настройки ICE/NAT, переменные IP/PORT.
# Ничего не меняет. Код выхода: 0 — вывод для ручной проверки, 2 — не удалось клонировать.
#
#   UPSTREAM_REF=<тег|коммит> scripts/verify-upstream.sh
#   KEEP=1 — не удалять клон (путь будет напечатан)
set -euo pipefail

# shellcheck source=scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/yohimik/webxash3d-fwgs}
UPSTREAM_REF=${UPSTREAM_REF:-main}

command -v git >/dev/null 2>&1 || {
  log_error "нужен git"
  exit 2
}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/webxash3d-verify.XXXXXX")
# shellcheck disable=SC2317  # вызывается через trap
cleanup() {
  if [[ -n ${KEEP:-} ]]; then
    log_info "клон сохранён: $tmp/repo"
  else
    rm -rf "$tmp"
  fi
}
trap cleanup EXIT

log_info "клонирую $UPSTREAM_URL ($UPSTREAM_REF)…"
if ! git clone --quiet --depth 1 --branch "$UPSTREAM_REF" "$UPSTREAM_URL" "$tmp/repo" 2>"$tmp/clone.err"; then
  # --branch не принимает хэш коммита — пробуем fetch конкретного коммита
  rm -rf "$tmp/repo"
  if ! {
    git init --quiet "$tmp/repo" &&
      git -C "$tmp/repo" remote add origin "$UPSTREAM_URL" &&
      git -C "$tmp/repo" fetch --quiet --depth 1 origin "$UPSTREAM_REF" &&
      git -C "$tmp/repo" checkout --quiet FETCH_HEAD
  } 2>>"$tmp/clone.err"; then
    log_error "не удалось клонировать $UPSTREAM_URL на $UPSTREAM_REF:"
    cat "$tmp/clone.err" >&2
    exit 2
  fi
fi
up=$tmp/repo
log_ok "upstream: $(git -C "$up" log -1 --format='%H %cs %s')"

section() {
  printf '\n\033[1m════ %s ════\033[0m\n' "$*"
}

# show DIR PATTERN [GREP_INCLUDE...] — grep -rn -C3 с фиксированной строкой или ERE
show() {
  local dir=$1 pat=$2
  shift 2
  local -a inc=()
  local g
  for g in "$@"; do
    inc+=(--include="$g")
  done
  section "$pat  [${dir#"$up"/}]"
  if [[ ! -d $dir ]]; then
    log_warn "каталог не найден: ${dir#"$up"/}"
    return 0
  fi
  grep -rnE -C3 "${inc[@]}" --exclude-dir=node_modules --exclude-dir=dist -- "$pat" "$dir" |
    sed "s|$up/||" || echo "(не найдено)"
}

client=$up/docker/cs-web-server/src/client
client_globs=('*.ts' '*.tsx' '*.js' '*.mjs' '*.html')

for pat in 'new WebSocket' 'createDataChannel' 'JSON\.stringify' '"type"|type:' 'connect ' 'Xash3DWebRTC' 'iceServers'; do
  show "$client" "$pat" "${client_globs[@]}"
done

# Go-сервер: ищем во всём docker/cs-web-server, кроме клиента
server_dir=$up/docker/cs-web-server
mapfile -t go_dirs < <(find "$server_dir" -name '*.go' -not -path '*/node_modules/*' -printf '%h\n' 2>/dev/null | sort -u)
go_root=$server_dir
if ((${#go_dirs[@]} == 0)); then
  go_root=$up
  log_warn "Go-исходники в docker/cs-web-server не найдены — ищу по всему репозиторию"
  mapfile -t go_dirs < <(find "$up" -name '*.go' -not -path '*/node_modules/*' -printf '%h\n' 2>/dev/null | sort -u)
fi
for pat in 'HandleFunc|Handle\(' 'websocket|Upgrade' 'NAT1To1' 'SetICE' 'UDPMux' '"IP"|\bIP\b' '"PORT"|\bPORT\b'; do
  if ((${#go_dirs[@]} > 0)); then
    show "$go_root" "$pat" '*.go'
  fi
done

section "Наш клиент: web/src/net/protocol.ts"
if [[ -f $REPO_ROOT/web/src/net/protocol.ts ]]; then
  grep -nE 'export|const|=' "$REPO_ROOT/web/src/net/protocol.ts" || cat "$REPO_ROOT/web/src/net/protocol.ts"
else
  log_warn "web/src/net/protocol.ts ещё не создан"
fi

section "CS_SIGNAL_PATH"
sig=''
for f in "$REPO_ROOT/.env" "$REPO_ROOT/.env.example"; do
  if [[ -f $f ]]; then
    dotenv_load "$f"
    if [[ -v "DOTENV[CS_SIGNAL_PATH]" ]]; then
      sig=${DOTENV[CS_SIGNAL_PATH]}
      echo "${f#"$REPO_ROOT"/}: CS_SIGNAL_PATH=$sig"
      break
    fi
  fi
done
sig=${sig:-/websocket}

found=0
if ((${#go_dirs[@]} > 0)) && grep -rqF --include='*.go' -- "\"$sig\"" "$up"; then
  found=1
fi
if ((found == 0)) && grep -rqF --include='*.go' --include='*.ts' --exclude-dir=node_modules -- "$sig" "$server_dir" 2>/dev/null; then
  found=2
fi
case $found in
  1) log_ok "строка \"$sig\" найдена в Go-исходниках upstream:" && grep -rnF --include='*.go' -- "\"$sig\"" "$up" | sed "s|$up/||" ;;
  2)
    log_warn "\"$sig\" как отдельный маршрут в Go не найден, но строка встречается:"
    grep -rnF --include='*.go' --include='*.ts' --exclude-dir=node_modules -- "$sig" "$server_dir" | sed "s|$up/||"
    ;;
  *)
    printf '\n\033[1;31m!!! CS_SIGNAL_PATH=%s НЕ НАЙДЕН в исходниках upstream-сервера !!!\033[0m\n' "$sig" >&2
    echo "Онлайн-подключение, скорее всего, не заработает. Найдите путь WebSocket в выводе выше" >&2
    echo "(HandleFunc / websocket / Upgrade) и исправьте CS_SIGNAL_PATH в .env и web/src/net/protocol.ts." >&2
    ;;
esac

echo
log_info "Сверьте вручную: путь WS, формат JSON (offer/answer/candidate), метку и параметры data channel."
exit 0
