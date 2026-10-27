/** Настройки лаунчера (localStorage — только настройки, не файлы игры). */
import { log } from '../ui/log';

export const RESOLUTIONS = ['auto', '800x600', '1024x768', '1280x720', '1600x900', '1920x1080'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export type RendererChoice = 'webgl2' | 'soft';
export type LaunchMode = 'offline' | 'online';

export interface LaunchSettings {
  nickname: string;
  resolution: Resolution;
  sensitivity: number;
  renderer: RendererChoice;
  mode: LaunchMode;
  /** Последняя выбранная офлайн-карта. */
  map: string;
  /** Последний выбранный сервер. */
  serverId: string;
}

export const SENSITIVITY = { min: 0.5, max: 10, step: 0.1, default: 3 } as const;
export const NICKNAME_MAX = 31;

const KEY = 'cs16-web:launcher';

export const DEFAULT_SETTINGS: LaunchSettings = {
  nickname: 'Player',
  resolution: 'auto',
  sensitivity: SENSITIVITY.default,
  renderer: 'webgl2',
  mode: 'offline',
  map: '',
  serverId: '',
};

/** Убирает то, что сломает консольную команду `name "…"`: кавычки, `;`, переводы строк, управляющие символы. */
export function sanitizeNickname(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[";\r\n\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, NICKNAME_MAX).trim();
}

export function clampSensitivity(value: number): number {
  if (!Number.isFinite(value)) return SENSITIVITY.default;
  const clamped = Math.min(SENSITIVITY.max, Math.max(SENSITIVITY.min, value));
  return Math.round(clamped * 10) / 10;
}

export function parseResolution(r: Resolution): { width: number; height: number } | null {
  if (r === 'auto') return null;
  const [w, h] = r.split('x').map(Number);
  return w && h ? { width: w, height: h } : null;
}

export function loadSettings(): LaunchSettings {
  let raw: unknown = null;
  try {
    const text = localStorage.getItem(KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const r = raw as Partial<Record<keyof LaunchSettings, unknown>>;
  const nickname = typeof r.nickname === 'string' ? sanitizeNickname(r.nickname) : '';
  return {
    nickname: nickname || DEFAULT_SETTINGS.nickname,
    resolution: RESOLUTIONS.includes(r.resolution as Resolution) ? (r.resolution as Resolution) : 'auto',
    sensitivity: typeof r.sensitivity === 'number' ? clampSensitivity(r.sensitivity) : SENSITIVITY.default,
    renderer: r.renderer === 'soft' ? 'soft' : 'webgl2',
    mode: r.mode === 'online' ? 'online' : 'offline',
    map: typeof r.map === 'string' ? r.map : '',
    serverId: typeof r.serverId === 'string' ? r.serverId : '',
  };
}

export function saveSettings(s: LaunchSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (err) {
    log.warn('настройки не сохранены', err);
  }
}
