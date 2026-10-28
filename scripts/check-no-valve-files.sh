#!/usr/bin/env bash
# CI-проверка: в репозитории нет файлов игр (Valve — CS 1.6, Blizzard — Warcraft III).
# Сайт не хранит и не раздаёт файлы игр: игрок выбирает свою копию, файлы читаются только в браузере.
# Падает, если среди отслеживаемых git файлов (git ls-files) есть:
#   Valve (Half-Life / Counter-Strike):
#   - расширения ресурсов движка: .bsp .wad .mdl .spr .pak .gcf .wav .mp3 .res
#   - файлы игры вне valve/ и cstrike/: .gam (liblist.gam) .dem (демо) .sav (сохранения) .nav
#   - архивы .zip / .pk3
#   - любой файл внутри каталога с именем valve/ или cstrike/ (на любой глубине)
#   Blizzard (Warcraft III):
#   - архивы и карты: .mpq .casc .w3x .w3m .w3n (кампании) .w3g (реплеи)
#   - ресурсы: .blp (текстуры) .mdx (модели; MDX-документы в проекте не используются)
#   - любой файл внутри каталога «Warcraft III/» или «Maps/» (на любой глубине)
# Регистр расширений и имён каталогов не учитывается. Нарушители печатаются списком.
# Имя файла историческое (CI и документация ссылаются на него), проверяет он все игры каталога.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "ОШИБКА: $(pwd) — не git-репозиторий" >&2
  exit 2
fi

ext_re='\.(bsp|wad|mdl|spr|pak|gcf|wav|mp3|res|gam|dem|sav|nav|zip|pk3|mpq|casc|w3x|w3m|w3n|w3g|blp|mdx)$'
dir_re='(^|/)(valve|cstrike|warcraft iii|maps)/'

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
  echo "ОШИБКА: в репозитории найдены файлы, похожие на файлы игр (${#offenders[@]}):" >&2
  printf '  %s\n' "${offenders[@]}" >&2
  echo "Файлы игр (Valve, Blizzard и др.) нельзя хранить и распространять. Удалите их из индекса: git rm --cached <файл>" >&2
  exit 1
fi

echo "OK: файлов игр в репозитории нет ($(git ls-files | wc -l | tr -d ' ') файлов проверено)"
