/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** '' — тот же origin, URL — внешний сервер, 'none' — только офлайн. См. src/net/endpoints.ts. */
  readonly VITE_API_BASE?: string;
  /** '1' — регистрировать coi-sw.js (COOP/COEP на хостингах без своих заголовков, например GitHub Pages). */
  readonly VITE_COI_SW?: string;
  /** Название сайта в шапке и заголовках (по умолчанию Flomaster). */
  readonly VITE_SITE_NAME?: string;
}
