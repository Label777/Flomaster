#!/usr/bin/env bash
# CI-проверка: в репозитории нет файлов игры Valve.
# Падает, если среди отслеживаемых git файлов (git ls-files) есть:
#   - расширения ресурсов движка: .bsp .wad .mdl .spr .pak .gcf .wav .mp3 .res
#   - файлы игры вне valve/ и cstrike/: .gam (liblist.gam) .dem (демо) .sav (сохранения) .nav
#   - архивы .zip / .pk3
#   - любой файл внутри каталога с именем valve/ или cstrike/ (на любой глубине)
# Регистр расширений и имён каталогов не учитывается. Нарушители печатаются списком.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ОШИБКА: $(pwd) — не git-репозиторий" >&2
  exit 2
fi

ext_re='\.(bsp|wad|mdl|spr|pak|gcf|wav|mp3|res|gam|dem|sav|nav|zip|pk3)$'
dir_re='(^|/)(valve|cstrike)/'

offenders=()
while IFS= read -r -d '' f; do
  lower=${f,,}
  reason=''
  if [[ $lower =~ $ext_re ]]; then
    reason="расширение ${BASH_REMATCH[0]}"
  elif [[ $lower =~ $dir_re ]]; then
    reason="каталог ${BASH_REMATCH[2]}/"
  fi
  if [[ -n $reason ]]; then
    offenders+=("$f  ($reason)")
  fi
done < <(git ls-files -z --cached)

if ((${#offenders[@]} > 0)); then
  echo "ОШИБКА: в репозитории найдены файлы, похожие на файлы игры Valve (${#offenders[@]}):" >&2
  printf '  %s\n' "${offenders[@]}" >&2
  echo "Файлы игры нельзя хранить и распространять. Удалите их: git rm --cached <файл>" >&2
  exit 1
fi

echo "OK: файлов игры Valve в репозитории нет ($(git ls-files | wc -l | tr -d ' ') файлов проверено)"
