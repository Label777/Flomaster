/**
 * На GitHub Pages нельзя задать COOP/COEP, поэтому в сборке с VITE_COI_SW=1
 * заголовки добавляет service worker (public/coi-sw.js). При первом визите
 * страница один раз перезагружается, чтобы оказаться под его контролем.
 */
import { assetUrl } from './net/endpoints';
import { log } from './ui/log';

const RELOAD_FLAG = 'coi-sw-reloaded';

export function ensureCrossOriginIsolation(): void {
  if (import.meta.env.VITE_COI_SW !== '1') return;
  if (window.crossOriginIsolated || !window.isSecureContext || !('serviceWorker' in navigator)) return;

  let reloaded = false;
  try {
    reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
  } catch {
    // sessionStorage недоступен — без перезагрузки, чтобы не зациклиться
    reloaded = true;
  }

  void navigator.serviceWorker
    .register(assetUrl('coi-sw.js'), { scope: import.meta.env.BASE_URL })
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      if (reloaded || window.crossOriginIsolated) return;
      try {
        sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        return;
      }
      location.reload();
    })
    .catch((err: unknown) => log.warn('coi-sw не зарегистрирован', err));
}
