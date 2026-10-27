#!/usr/bin/env bash
# Ставит серверные файлы Half-Life Dedicated Server + Counter-Strike (app 90, mod cstrike)
# через steamcmd (образ steamcmd/steamcmd) в ./data/hlds. Нужен только если вы хотите,
# чтобы сервер использовал вашу копию, а не файлы из образа yohimik/cs-web-server.
# Потом:  docker compose -f docker-compose.yml -f docker-compose.steamcmd.yml up -d   (EXPERIMENTAL)
#
# Файлы остаются только на сервере, в git не попадают (data/ в .gitignore) и браузерам не раздаются.
#
# Переменные:
#   STEAM_USER     логин Steam (по умолчанию anonymous — для app 90 этого достаточно)
#   STEAMCMD_IMAGE образ steamcmd (по умолчанию steamcmd/steamcmd:latest)
#   HLDS_DIR       куда ставить (по умолчанию <репозиторий>/data/hlds)
set -euo pipefail

# shellcheck source=scripts/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STEAMCMD_IMAGE=${STEAMCMD_IMAGE:-steamcmd/steamcmd:latest}
HLDS_DIR=${HLDS_DIR:-$REPO_ROOT/data/hlds}
STEAM_USER=${STEAM_USER:-anonymous}

command -v docker >/dev/null 2>&1 || die "docker не найден"
mkdir -p "$HLDS_DIR"
HLDS_DIR=$(cd "$HLDS_DIR" && pwd)

log_info "устанавливаю HLDS (app 90, mod cstrike) в $HLDS_DIR от имени «$STEAM_USER»"
if [[ $STEAM_USER != anonymous ]]; then
  log_warn "steamcmd спросит пароль и, возможно, код Steam Guard — контейнер запускается интерактивно"
fi

tty_flags=(-i)
if [[ -t 0 && -t 1 ]]; then
  tty_flags=(-it)
fi

# app_update 90 запускается дважды: известная ошибка HLDS — первый проход часто
# завершается «Success», не докачав файлы cstrike (или с ошибкой 0x402/0x602).
run_steamcmd() {
  docker run --rm "${tty_flags[@]}" \
    -v "$HLDS_DIR:/data" \
    "$STEAMCMD_IMAGE" \
    +force_install_dir /data \
    +login "$STEAM_USER" \
    +app_set_config 90 mod cstrike \
    +app_update 90 validate \
    +quit
}

for pass in 1 2; do
  log_info "steamcmd, проход $pass из 2…"
  if ! run_steamcmd; then
    if [[ $pass == 2 ]]; then
      die "steamcmd завершился с ошибкой. Запустите скрипт ещё раз — для app 90 это нормально."
    fi
    log_warn "проход $pass завершился с ошибкой — повторяю"
  fi
done

missing=0
for d in valve cstrike; do
  if [[ ! -d $HLDS_DIR/$d ]]; then
    log_error "нет каталога $HLDS_DIR/$d"
    missing=1
  fi
done
if [[ ! -f $HLDS_DIR/cstrike/liblist.gam ]]; then
  log_error "нет $HLDS_DIR/cstrike/liblist.gam — установка mod cstrike не завершилась, запустите скрипт ещё раз"
  missing=1
fi
((missing == 0)) || exit 1

# Контейнер steamcmd пишет от своего пользователя; серверу (пользователь xashds в образе)
# достаточно прав на чтение
chmod -R a+rX "$HLDS_DIR" 2>/dev/null || log_warn "не удалось выставить права на чтение для $HLDS_DIR"

log_ok "готово: $HLDS_DIR/valve, $HLDS_DIR/cstrike"
cat <<EOF

Запуск сервера с этими файлами (EXPERIMENTAL — оверлей скрывает файлы, которые образ
кладёт в /xashds/valve и /xashds/cstrike):

  docker compose -f docker-compose.yml -f docker-compose.steamcmd.yml up -d

Вернуться к файлам из образа:  docker compose up -d --force-recreate cs-server
EOF
