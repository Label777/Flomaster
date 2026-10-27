#!/usr/bin/env bash
# Закрепляет образы по digest: для CS_SERVER_IMAGE, COTURN_IMAGE, CADDY_IMAGE, NODE_IMAGE
# делает docker pull и записывает в .env точное  имя@sha256:…  (перед правкой — копия .env.bak).
# Повторный деплой после этого берёт ровно те же образы, даже если тег latest сдвинулся.
#
#   scripts/pin-images.sh            закрепить текущие значения
#   scripts/pin-images.sh --unpin    вернуть теги из .env.example (для обновления образов)
#
# ENV_FILE — путь к .env (по умолчанию <репозиторий>/.env)
set -euo pipefail

# shellcheck source=scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENV_FILE=${ENV_FILE:-$REPO_ROOT/.env}
IMAGE_VARS=(CS_SERVER_IMAGE COTURN_IMAGE CADDY_IMAGE NODE_IMAGE)

[[ -f $ENV_FILE ]] || die "нет файла $ENV_FILE (скопируйте .env.example в .env)"

mode=pin
case ${1:-} in
  '') ;;
  --unpin) mode=unpin ;;
  -h | --help)
    sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *) die "неизвестный параметр: $1" ;;
esac

cp -p "$ENV_FILE" "$ENV_FILE.bak"
log_info "резервная копия: $ENV_FILE.bak"

if [[ $mode == unpin ]]; then
  dotenv_load "$REPO_ROOT/.env.example"
  declare -A defaults=()
  for name in "${IMAGE_VARS[@]}"; do
    defaults[$name]=${DOTENV[$name]:-}
  done
  for name in "${IMAGE_VARS[@]}"; do
    [[ -n ${defaults[$name]} ]] || continue
    env_set_in_file "$ENV_FILE" "$name" "${defaults[$name]}"
    log_ok "$name=${defaults[$name]}"
  done
  exit 0
fi

command -v docker >/dev/null 2>&1 || die "docker не найден"
dotenv_load "$ENV_FILE"

# Платформа, под которую нужен digest (cs-server — linux/386, остальные — платформа хоста)
platform_for() {
  case $1 in
    CS_SERVER_IMAGE) printf '%s' linux/386 ;;
    *) printf '' ;;
  esac
}

failed=0
for name in "${IMAGE_VARS[@]}"; do
  ref=$(env_get "$name")
  if [[ -z $ref ]]; then
    log_warn "$name не задана — пропускаю"
    continue
  fi
  platform=$(platform_for "$name")
  log_info "$name: docker pull $ref${platform:+ ($platform)}"
  pull_args=()
  if [[ -n $platform ]]; then
    pull_args=(--platform "$platform")
  fi
  if ! docker pull "${pull_args[@]}" "$ref" >/dev/null; then
    log_error "$name: не удалось скачать $ref"
    failed=1
    continue
  fi
  # Ссылка без digest: repo[:tag] → repo; с digest — оставить repo
  repo=${ref%@*}
  last=${repo##*/}
  if [[ $last == *:* ]]; then
    repo=${repo%:*}
  fi
  digest=$(docker image inspect --format '{{index .RepoDigests 0}}' "$ref" 2>/dev/null || true)
  # RepoDigests может содержать несколько записей — берём ту, что от нужного репозитория
  all=$(docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$ref" 2>/dev/null || true)
  while IFS= read -r d; do
    [[ -z $d ]] && continue
    if [[ ${d%@*} == "$repo" || ${d%@*} == "docker.io/$repo" || ${d%@*} == "docker.io/library/$repo" ]]; then
      digest=$d
      break
    fi
  done <<<"$all"
  if [[ -z $digest || $digest != *@sha256:* ]]; then
    log_error "$name: у образа $ref нет RepoDigests (собран локально?)"
    failed=1
    continue
  fi
  pinned="$repo@${digest##*@}"
  if [[ $pinned == "$ref" ]]; then
    log_ok "$name уже закреплён: $pinned"
    continue
  fi
  env_set_in_file "$ENV_FILE" "$name" "$pinned"
  log_ok "$name=$pinned"
done

if ((failed)); then
  die "не все образы закреплены (см. ошибки выше); .env.bak — копия до изменений"
fi
log_ok "готово. Чтобы обновить образы позже: scripts/pin-images.sh --unpin && scripts/deploy.sh --pin"
