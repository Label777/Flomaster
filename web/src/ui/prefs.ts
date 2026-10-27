/** Избранное и недавние игры — только в localStorage этого браузера. */
const FAV_KEY = 'catalog-favorites';
const RECENT_KEY = 'catalog-recent';
const RECENT_MAX = 6;

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // хранилище недоступно (приватный режим) — работаем без сохранения
  }
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export function favorites(): Set<string> {
  return new Set(strings(read(FAV_KEY)));
}

export function isFavorite(id: string): boolean {
  return favorites().has(id);
}

/** Переключает избранное; возвращает новое состояние. */
export function toggleFavorite(id: string): boolean {
  const set = favorites();
  const now = !set.has(id);
  if (now) set.add(id);
  else set.delete(id);
  write(FAV_KEY, [...set]);
  return now;
}

/** id недавно запущенных игр, свежие первыми. */
export function recent(): string[] {
  return strings(read(RECENT_KEY));
}

export function markPlayed(id: string): void {
  write(RECENT_KEY, [id, ...recent().filter((x) => x !== id)].slice(0, RECENT_MAX));
}

export function clearRecent(): void {
  write(RECENT_KEY, []);
}
