/** Название сайта: VITE_SITE_NAME при сборке, по умолчанию — Flomaster. */
export const SITE_NAME = (import.meta.env.VITE_SITE_NAME ?? '').trim() || 'Flomaster';

export function pageTitle(title?: string): string {
  return title ? `${title} — ${SITE_NAME}` : `${SITE_NAME} — игры в браузере`;
}
