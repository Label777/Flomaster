#!/usr/bin/env bash
# Деплой одной командой на чистой VPS.
#
#   scripts/deploy.sh               проверка .env → рендер конфигов → pull → build → up → health-check
#   scripts/deploy.sh --pin         то же + закрепить образы по digest (scripts/pin-images.sh) после pull
#   scripts/deploy.sh --no-build    не пересобирать web/api (взять уже собранные образы)
#   scripts/deploy.sh --render-only только проверить .env и отрендерить конфиги
#
# Переменные окружения:
#   ENV_FILE        путь к .env (по умолчанию <репозиторий>/.env)
#   HEALTH_TIMEOUT  сколько секунд ждать https://$DOMAIN/api/health (по умолчанию 180)
set -euo pipefail

# shellcheck source=scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ENV_FILE=${ENV_FILE:-$REPO_ROOT/.env}
HEALTH_TIMEOUT=${HEALTH_TIMEOUT:-180}

# Переменные, без которых деплой невозможен
REQUIRED_VARS=(DOMAIN PUBLIC_IP ACME_EMAIL RCON_PASSWORD TURN_SECRET CS_SERVER_IMAGE COTURN_IMAGE CADDY_IMAGE NODE_IMAGE)
# Значения-заглушки из .env.example
PLACEHOLDER_RE='(change-me|example\.(com|org|net)|203\.0\.113\.10)'

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# check_env — проверяет обязательные значения, печатает все ошибки разом
check_env() {
  local name val errors=0
  for name in "${REQUIRED_VARS[@]}"; do
    val=$(env_get "$name")
    if [[ -z $val ]]; then
      log_error "$name не задана в $ENV_FILE"
      errors=$((errors + 1))
    elif [[ $val =~ $PLACEHOLDER_RE ]]; then
      log_error "$name содержит значение-заглушку из .env.example («$val») — замените его"
      errors=$((errors + 1))
    fi
  done

  local domain public_ip game_port turn_port tmin tmax sig
  domain=$(env_get DOMAIN)
  public_ip=$(env_get PUBLIC_IP)
  game_port=$(env_get GAME_PORT 27018)
  turn_port=$(env_get TURN_PORT 3478)
  tmin=$(env_get TURN_MIN_PORT 49160)
  tmax=$(env_get TURN_MAX_PORT 49200)
  sig=$(env_get CS_SIGNAL_PATH /websocket)

  if [[ -n $domain && ! $domain =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]]; then
    log_error "DOMAIN: ожидалось имя хоста без схемы и пути (например cs.mysite.ru), получено «$domain»"
    errors=$((errors + 1))
  fi
  if [[ -n $public_ip && ! $public_ip =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    log_error "PUBLIC_IP: ожидался IPv4-адрес, получено «$public_ip»"
    errors=$((errors + 1))
  fi
  local p
  for p in GAME_PORT:"$game_port" TURN_PORT:"$turn_port" TURN_MIN_PORT:"$tmin" TURN_MAX_PORT:"$tmax"; do
    if [[ ! ${p#*:} =~ ^[0-9]+$ ]] || ((${p#*:} < 1 || ${p#*:} > 65535)); then
      log_error "${p%%:*}: некорректный порт «${p#*:}»"
      errors=$((errors + 1))
    fi
  done
  if [[ $tmin =~ ^[0-9]+$ && $tmax =~ ^[0-9]+$ ]] && ((tmin > tmax)); then
    log_error "TURN_MIN_PORT ($tmin) больше TURN_MAX_PORT ($tmax)"
    errors=$((errors + 1))
  fi
  if [[ $game_port == 27016 ]]; then
    log_error "GAME_PORT не может быть 27016: этот порт занят HTTP/сигналингом cs-server"
    errors=$((errors + 1))
  fi
  if [[ ! $sig =~ ^/[A-Za-z0-9._~/-]*$ ]]; then
    log_error "CS_SIGNAL_PATH: ожидался путь вида /websocket, получено «$sig»"
    errors=$((errors + 1))
  fi
  # Значения, которые попадают в server.cfg внутри кавычек
  for name in SERVER_NAME RCON_PASSWORD; do
    val=$(env_get "$name")
    if [[ $val == *'"'* || $val == *';'* ]]; then
      log_error "$name не должна содержать символы \" и ; (они ломают server.cfg)"
      errors=$((errors + 1))
    fi
  done
  val=$(env_get TURN_SECRET)
  if [[ -n $val && ${#val} -lt 16 ]]; then
    log_error "TURN_SECRET слишком короткий (нужно ≥ 16 символов; сгенерируйте: openssl rand -hex 24)"
    errors=$((errors + 1))
  fi
  # Значения со знаком $ docker compose попытается интерполировать
  for name in "${!DOTENV[@]}"; do
    if [[ ${DOTENV[$name]} == *'$'* ]]; then
      log_error "$name содержит символ \$ — docker compose воспримет его как подстановку; уберите его"
      errors=$((errors + 1))
    fi
  done
  if [[ -n $(env_get ADMIN_PANEL_USER) && -z $(env_get ADMIN_PANEL_PASSWORD) ]]; then
    log_warn "ADMIN_PANEL_USER задан без ADMIN_PANEL_PASSWORD"
  fi

  if ((errors > 0)); then
    die "в $ENV_FILE найдено ошибок: $errors. Исправьте и запустите снова."
  fi
  env_warn_overrides "${REQUIRED_VARS[@]}" SERVER_NAME GAME_PORT CS_SIGNAL_PATH TURN_PORT
}

# render_configs — server.cfg и turnserver.conf из шаблонов
render_configs() {
  render_template "$REPO_ROOT/deploy/cs-server/server.cfg.tmpl" "$REPO_ROOT/deploy/cs-server/server.cfg" \
    "SERVER_NAME=$(env_get SERVER_NAME 'CS 1.6 Web')" \
    "RCON_PASSWORD=$(env_get RCON_PASSWORD)"
  render_template "$REPO_ROOT/deploy/coturn/turnserver.conf.tmpl" "$REPO_ROOT/deploy/coturn/turnserver.conf" \
    "TURN_PORT=$(env_get TURN_PORT 3478)" \
    "TURN_MIN_PORT=$(env_get TURN_MIN_PORT 49160)" \
    "TURN_MAX_PORT=$(env_get TURN_MAX_PORT 49200)" \
    "PUBLIC_IP=$(env_get PUBLIC_IP)" \
    "DOMAIN=$(env_get DOMAIN)" \
    "TURN_SECRET=$(env_get TURN_SECRET)"
  log_ok "конфиги отрендерены: deploy/cs-server/server.cfg, deploy/coturn/turnserver.conf"
}

check_docker() {
  command -v docker >/dev/null 2>&1 ||
    die "docker не найден. Установите Docker Engine: https://docs.docker.com/engine/install/"
  docker info >/dev/null 2>&1 ||
    die "docker daemon недоступен (запущен ли он? есть ли у пользователя права — группа docker или sudo?)"
  local v
  v=$(docker compose version --short 2>/dev/null) ||
    die "нет плагина Docker Compose v2 (команда «docker compose»). Установите пакет docker-compose-plugin."
  v=${v#v}
  if [[ ! $v =~ ^([2-9]|[1-9][0-9]+)\. ]]; then
    die "нужен Docker Compose v2+, найден $v"
  fi
  log_ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?'), compose $v"
}

ensure_env_file() {
  if [[ -f $ENV_FILE ]]; then
    return 0
  fi
  cp "$REPO_ROOT/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log_warn "файла $ENV_FILE не было — создан из .env.example."
  cat <<EOF

Заполните в $ENV_FILE как минимум:
  DOMAIN        домен сайта (A-запись → IP этой машины)
  PUBLIC_IP     публичный IPv4 этой машины
  ACME_EMAIL    почта для Let's Encrypt
  RCON_PASSWORD пароль RCON          (например: $(random_hex 12))
  TURN_SECRET   секрет coturn        (например: $(random_hex 24))

Затем снова запустите: scripts/deploy.sh
EOF
  exit 1
}

wait_health() {
  local domain=$1 url deadline
  url="https://$domain/api/health"
  deadline=$((SECONDS + HEALTH_TIMEOUT))
  log_info "жду $url (до ${HEALTH_TIMEOUT} с; первый запуск получает сертификат Let's Encrypt)…"
  while ((SECONDS < deadline)); do
    if curl -fsS -o /dev/null --max-time 5 "$url" 2>/dev/null; then
      log_ok "сайт отвечает: $url"
      return 0
    fi
    sleep 3
  done
  log_warn "$url не ответил за ${HEALTH_TIMEOUT} с. Состояние контейнеров:"
  docker compose ps || true
  log_warn "Проверьте DNS (A-запись $domain → $(env_get PUBLIC_IP)), открытые порты 80/443 и логи: docker compose logs web"
  return 1
}

print_summary() {
  local domain game_port turn_port tmin tmax
  domain=$(env_get DOMAIN)
  game_port=$(env_get GAME_PORT 27018)
  turn_port=$(env_get TURN_PORT 3478)
  tmin=$(env_get TURN_MIN_PORT 49160)
  tmax=$(env_get TURN_MAX_PORT 49200)
  cat <<EOF

────────────────────────────────────────────────────────────
 Сайт:            https://$domain/
 Статус серверов: https://$domain/api/servers
 Логи:            docker compose logs -f cs-server   (web, api, coturn)

 Откройте в файрволе (входящие):
   80/tcp, 443/tcp          сайт, Let's Encrypt
   443/udp                  HTTP/3 (необязательно)
   $game_port/udp, $game_port/tcp   WebRTC игрового сервера
   $turn_port/udp, $turn_port/tcp     STUN/TURN
   $tmin-$tmax/udp        ретрансляция TURN
 Порт 27016 (HTTP cs-server) открывать НЕ нужно.

 Пример для ufw:
   ufw allow 80,443/tcp && ufw allow 443/udp
   ufw allow $game_port && ufw allow $turn_port
   ufw allow $tmin:$tmax/udp
────────────────────────────────────────────────────────────
EOF
}

main() {
  local pin=0 build=1 render_only=0 arg
  for arg in "$@"; do
    case $arg in
      --pin) pin=1 ;;
      --no-build) build=0 ;;
      --render-only) render_only=1 ;;
      -h | --help)
        usage
        exit 0
        ;;
      *) die "неизвестный параметр: $arg (см. --help)" ;;
    esac
  done

  cd "$REPO_ROOT"
  ensure_env_file
  dotenv_load "$ENV_FILE"
  check_env
  render_configs
  if ((render_only)); then
    return 0
  fi

  check_docker
  command -v curl >/dev/null 2>&1 || die "нужен curl (apt install curl)"

  local -a compose=(docker compose --env-file "$ENV_FILE")
  log_info "проверяю docker-compose.yml…"
  "${compose[@]}" config -q

  log_info "загружаю образы…"
  "${compose[@]}" pull --ignore-buildable
  if ((pin)); then
    log_info "закрепляю образы по digest…"
    ENV_FILE="$ENV_FILE" "$REPO_ROOT/scripts/pin-images.sh"
    dotenv_load "$ENV_FILE"
  fi
  if ((build)); then
    log_info "собираю web и api…"
    "${compose[@]}" build --pull
  fi
  log_info "запускаю…"
  "${compose[@]}" up -d --remove-orphans

  local rc=0
  wait_health "$(env_get DOMAIN)" || rc=1
  print_summary
  return "$rc"
}

main "$@"
