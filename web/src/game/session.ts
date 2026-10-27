/**
 * Состояние между #/play и #/game внутри одной загрузки страницы. Файлы игры живут только здесь
 * (в памяти вкладки) и отдаются движку один раз. После перезагрузки их нет — это намеренно.
 */
import type { LaunchSettings } from './settings';
import type { ServerInfo } from '../net/api';

export interface LaunchPlan {
  settings: LaunchSettings;
  files: Map<string, Uint8Array>;
  totalBytes: number;
  /** Для онлайна — выбранный сервер. */
  server: ServerInfo | null;
}

let pending: LaunchPlan | null = null;
let engineStarted = false;

export function setLaunchPlan(plan: LaunchPlan): void {
  pending = plan;
}

export function hasLaunchPlan(): boolean {
  return pending !== null;
}

/** Забирает план; повторный вызов вернёт null. */
export function takeLaunchPlan(): LaunchPlan | null {
  const plan = pending;
  pending = null;
  return plan;
}

/** Движок нельзя инициализировать в той же странице дважды. */
export function markEngineStarted(): void {
  engineStarted = true;
}

export function isEngineStarted(): boolean {
  return engineStarted;
}
