/**
 * Откуда брать API и сигналинг.
 *
 * VITE_API_BASE при сборке:
 *   ''                       — тот же origin (деплой на VPS через docker compose, по умолчанию);
 *   'https://cs.example.com' — внешний сервер (сайт на GitHub Pages, игровой сервер на VPS);
 *   'none'                   — серверов нет: только офлайн-игра (GitHub Pages без VPS).
 */
const raw = (import.meta.env.VITE_API_BASE ?? '').trim();

export const API_DISABLED = raw.toLowerCase() === 'none';
const API_BASE = API_DISABLED ? '' : raw.replace(/\/+$/, '');

/** Полный URL запроса к API: apiUrl('/api/servers'). */
export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Хост и протокол, к которым идёт WebSocket сигналинга. */
export function apiOrigin(): URL {
  return new URL(API_BASE || location.origin);
}

/** Путь к файлу из public/ с учётом base (сайт может жить в /<repo>/ на GitHub Pages). */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
}
