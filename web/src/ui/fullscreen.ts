/** Полноэкранный режим с запасным webkit-вариантом (Safari до 16.4). */
import { log } from './log';

type WebkitDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type WebkitEl = HTMLElement & { webkitRequestFullscreen?: () => void };

export function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement ?? (document as WebkitDoc).webkitFullscreenElement);
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as WebkitDoc;
  try {
    if (!isFullscreen()) return;
    if (typeof document.exitFullscreen === 'function') await document.exitFullscreen();
    else doc.webkitExitFullscreen?.();
  } catch (err) {
    log.warn('fullscreen', err);
  }
}

export async function toggleFullscreen(target: HTMLElement = document.documentElement): Promise<void> {
  if (isFullscreen()) return exitFullscreen();
  const el = target as WebkitEl;
  try {
    if (typeof el.requestFullscreen === 'function') await el.requestFullscreen();
    else el.webkitRequestFullscreen?.();
  } catch (err) {
    log.warn('fullscreen', err);
  }
}
