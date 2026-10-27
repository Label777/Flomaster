#!/usr/bin/env bash
# Общие функции скриптов: сообщения, чтение .env (без source), правка .env, рендер шаблонов.
# Подключается из других скриптов:  source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# Требуется bash 4.4+ (ассоциативные массивы, [[ -v ]], пустые массивы при set -u).

# Корень репозитория (каталог над scripts/)
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
export REPO_ROOT

# ---------------------------------------------------------------------------
# Сообщения
# ---------------------------------------------------------------------------

if [[ -t 1 && -z ${NO_COLOR:-} ]]; then
  __c_info=$'\033[1;34m' __c_ok=$'\033[1;32m' __c_warn=$'\033[1;33m' __c_err=$'\033[1;31m' __c_off=$'\033[0m'
else
  __c_info='' __c_ok='' __c_warn='' __c_err='' __c_off=''
fi

log_info() { printf '%s==>%s %s\n' "$__c_info" "$__c_off" "$*"; }
log_ok() { printf '%s✓%s %s\n' "$__c_ok" "$__c_off" "$*"; }
log_warn() { printf '%sВНИМАНИЕ:%s %s\n' "$__c_warn" "$__c_off" "$*" >&2; }
log_error() { printf '%sОШИБКА:%s %s\n' "$__c_err" "$__c_off" "$*" >&2; }
die() {
  log_error "$*"
  exit 1
}

# ---------------------------------------------------------------------------
# .env: чтение без source (значения вида  SERVER_NAME=CS 1.6 Web  в bash не «сорсятся»)
# ---------------------------------------------------------------------------

# Значения из последнего прочитанного файла
declare -gA DOTENV=()

# _dotenv_unescape_dq STRING — раскрывает \" и \\ внутри двойных кавычек
_dotenv_unescape_dq() {
  local s=$1 out='' c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    if [[ $c == '\' && $((i + 1)) -lt ${#s} ]]; then
      i=$((i + 1))
      c=${s:i:1}
    fi
    out+=$c
  done
  printf '%s' "$out"
}

# dotenv_load FILE — читает KEY=VALUE в DOTENV. Поддерживает комментарии, `export `,
# значения в "двойных" и 'одинарных' кавычках, комментарий ` #` после значения без кавычек.
# Подстановки ${VAR} внутри значений не выполняются (скрипты запрещают `$` в значениях).
dotenv_load() {
  local file=$1 line key val n=0
  local re_kv='^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$'
  local re_dq='^"(([^"\\]|\\.)*)"'
  local re_sq="^'([^']*)'"
  DOTENV=()
  [[ -r $file ]] || die "не удаётся прочитать $file"
  while IFS= read -r line || [[ -n $line ]]; do
    n=$((n + 1))
    line=${line%$'\r'}
    line=${line#"${line%%[![:space:]]*}"}
    [[ -z $line || $line == '#'* ]] && continue
    if [[ $line =~ ^export[[:space:]]+(.*)$ ]]; then
      line=${BASH_REMATCH[1]}
    fi
    if [[ ! $line =~ $re_kv ]]; then
      log_warn "$file:$n: строка не распознана и пропущена"
      continue
    fi
    key=${BASH_REMATCH[1]}
    val=${BASH_REMATCH[2]}
    if [[ $val == '"'* ]]; then
      if [[ $val =~ $re_dq ]]; then
        val=$(_dotenv_unescape_dq "${BASH_REMATCH[1]}")
      else
        log_warn "$file:$n: нет закрывающей кавычки у $key"
        val=${val#\"}
      fi
    elif [[ $val == "'"* ]]; then
      if [[ $val =~ $re_sq ]]; then
        val=${BASH_REMATCH[1]}
      else
        log_warn "$file:$n: нет закрывающей кавычки у $key"
        val=${val#\'}
      fi
    else
      # без кавычек: всё после « #» — комментарий; хвостовые пробелы срезаются
      val=${val%%[[:space:]]#*}
      val=${val%"${val##*[![:space:]]}"}
    fi
    DOTENV[$key]=$val
  done <"$file"
}

# _is_exported NAME — переменная есть в окружении процесса (export)
_is_exported() {
  local decl
  decl=$(declare -p "$1" 2>/dev/null) || return 1
  [[ $decl =~ ^declare\ -[a-zA-Z]*x ]]
}

# env_get NAME [DEFAULT] — значение как его увидит docker compose:
# переменная окружения процесса важнее .env; пустое значение заменяется DEFAULT
# (как ${NAME:-DEFAULT} в docker-compose.yml).
env_get() {
  local name=$1 def=${2-} val=''
  if _is_exported "$name"; then
    val=${!name}
  elif [[ -v "DOTENV[$name]" ]]; then
    val=${DOTENV[$name]}
  fi
  if [[ -z $val ]]; then
    val=$def
  fi
  printf '%s' "$val"
}

# env_warn_overrides NAME... — предупреждает, если переменная окружения перекрывает .env
env_warn_overrides() {
  local name
  for name in "$@"; do
    if _is_exported "$name" && [[ -v "DOTENV[$name]" && ${!name} != "${DOTENV[$name]}" ]]; then
      log_warn "$name задана в окружении оболочки и перекрывает значение из .env (так же поступит docker compose)"
    fi
  done
}

# env_set_in_file FILE NAME VALUE — заменяет строку NAME=... (или дописывает в конец).
# Значение пишется как есть, без кавычек: допустимы значения без пробелов по краям и без #, ", ', $.
# Права и владелец файла сохраняются.
env_set_in_file() {
  local file=$1 name=$2 value=$3 line found=0 tmp
  local re="^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*="
  tmp=$(mktemp "${file}.tmp.XXXXXX")
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $found -eq 0 && $line =~ $re ]]; then
      printf '%s=%s\n' "$name" "$value" >>"$tmp"
      found=1
    else
      printf '%s\n' "$line" >>"$tmp"
    fi
  done <"$file"
  if [[ $found -eq 0 ]]; then
    printf '%s=%s\n' "$name" "$value" >>"$tmp"
  fi
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

# random_hex N — N случайных байт в hex (без openssl)
random_hex() {
  od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'
}

# ---------------------------------------------------------------------------
# Рендер шаблонов (чистый bash, без envsubst)
# ---------------------------------------------------------------------------

# render_template SRC DST NAME=VALUE...
# Заменяет ${NAME} для перечисленных имён за один проход: подставленные значения повторно
# не разбираются (значение "${RCON_PASSWORD}" останется текстом), спецсимволы (\ & / $ "
# и т.п.) копируются буквально. Прочие ${...} с именами в верхнем регистре считаются
# ошибкой шаблона; остальной текст (в т.ч. $VAR без скобок) копируется как есть.
# Значения с переводом строки запрещены. Результат пишется атомарно с правами 0644
# (файл читают непривилегированные процессы в контейнерах).
render_template() {
  local src=$1 dst=$2
  shift 2
  local -A vals=()
  local pair name line rest res tmp out='' n=0
  local re_name='^([A-Za-z_][A-Za-z0-9_]*)\}'
  [[ -r $src ]] || die "шаблон не найден: $src"
  for pair in "$@"; do
    [[ $pair == *=* ]] || die "render_template: ожидалось ИМЯ=ЗНАЧЕНИЕ, получено «$pair»"
    name=${pair%%=*}
    vals[$name]=${pair#*=}
    if [[ ${vals[$name]} == *$'\n'* || ${vals[$name]} == *$'\r'* ]]; then
      die "$name: значение не должно содержать перевод строки"
    fi
  done
  while IFS= read -r line || [[ -n $line ]]; do
    n=$((n + 1))
    rest=$line
    res=''
    while [[ $rest == *'${'* ]]; do
      res+=${rest%%'${'*}
      rest=${rest#*'${'}
      if [[ $rest =~ $re_name ]]; then
        name=${BASH_REMATCH[1]}
        if [[ -v "vals[$name]" ]]; then
          res+=${vals[$name]}
          rest=${rest#"$name"\}}
          continue
        fi
        if [[ $name =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
          die "$src:$n: неизвестная переменная \${$name} (допустимы: ${!vals[*]})"
        fi
      fi
      res+='${'
    done
    out+=$res$rest$'\n'
  done <"$src"
  tmp=$(mktemp "${dst}.tmp.XXXXXX")
  printf '%s' "$out" >"$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$dst"
}
