/**
 * Нормализация путей файлов игры.
 *
 * На входе — относительный путь в том виде, в каком его дал источник (папка, webkitdirectory, zip),
 * включая имя выбранной корневой папки: «Half-Life/valve/liblist.gam», «valve/gfx.wad»,
 * «cs-files/cstrike/maps/de_dust2.bsp». На выходе — «valve/…» или «cstrike/…» с корнем в нижнем
 * регистре и внутренним путём без изменений. Допускается ровно одна обёртывающая папка.
 */

export type GameRoot = 'valve' | 'cstrike';

const ROOTS: readonly GameRoot[] = ['valve', 'cstrike'];

/** Нативные бинарники движка/модов — в браузере бесполезны. */
const NATIVE_EXT = /\.(dll|so|dylib|exe)$/i;

/** Контент одиночной кампании Half-Life, не нужный CS (сравнение без учёта регистра). */
const SKIPPED_PREFIXES: readonly string[] = ['valve/maps/', 'valve/media/', 'valve/save/'];

function asRoot(segment: string | undefined): GameRoot | null {
  if (segment === undefined) return null;
  const lower = segment.toLowerCase();
  return (ROOTS as readonly string[]).includes(lower) ? (lower as GameRoot) : null;
}

export function splitPath(raw: string): string[] {
  return raw.split(/[\\/]+/).filter((s) => s !== '' && s !== '.');
}

/** Служебный мусор архиваторов и macOS. */
function isJunk(segments: readonly string[]): boolean {
  const base = segments[segments.length - 1] ?? '';
  return segments.includes('__MACOSX') || base.startsWith('._') || base === '.DS_Store' || base === 'Thumbs.db';
}

/**
 * @param hint если пользователь выбирал папку «valve» или «cstrike» отдельной кнопкой, корень
 *             выбранной папки считается этой папкой, даже если она называется иначе.
 * @returns нормализованный путь или null, если файл не относится к valve/ и cstrike/.
 */
export function normalizeGamePath(raw: string, hint?: GameRoot): string | null {
  const s = splitPath(raw);
  if (s.length < 2 || isJunk(s) || s.includes('..')) return null;

  const at0 = asRoot(s[0]);
  if (at0) return [at0, ...s.slice(1)].join('/');
  if (hint) return [hint, ...s.slice(1)].join('/');

  const at1 = asRoot(s[1]);
  if (at1 && s.length >= 3) return [at1, ...s.slice(2)].join('/');
  return null;
}

/**
 * Может ли внутри каталога (по его сегментам пути) лежать что-то из valve/ или cstrike/.
 * Нужно, чтобы не обходить лишние каталоги Steam-папки (bshift, gearbox, valve_hd…).
 */
export function isRelevantDir(segments: readonly string[], hint?: GameRoot): boolean {
  if (segments.length <= 1) return true;
  if (hint || asRoot(segments[0])) return true;
  return asRoot(segments[1]) !== null;
}

export type SkipReason = 'native' | 'hl-campaign';

/** Почему файл не монтируется (или null, если монтируется). Путь уже нормализован. */
export function skipReason(path: string): SkipReason | null {
  if (NATIVE_EXT.test(path)) return 'native';
  const lower = path.toLowerCase();
  if (SKIPPED_PREFIXES.some((p) => lower.startsWith(p))) return 'hl-campaign';
  return null;
}
