/**
 * Запоминание выбранной папки (только Chromium). В IndexedDB хранится лишь FileSystemDirectoryHandle —
 * разрешение на чтение, а не файлы. Файлы игры никогда не кладутся ни в IndexedDB, ни в Cache API.
 */
import type { GameRoot } from './paths';
import { log } from '../ui/log';

export interface SavedDir {
  handle: FileSystemDirectoryHandle;
  hint?: GameRoot;
}

const DB = 'cs16-web';
const STORE = 'handles';
const KEY = 'gamedirs';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB недоступна'));
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Ошибка IndexedDB'));
    });
  } finally {
    db.close();
  }
}

export const canSaveHandles = (): boolean =>
  typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';

export async function saveDirs(dirs: SavedDir[]): Promise<void> {
  if (!canSaveHandles()) return;
  try {
    await tx('readwrite', (s) => s.put(dirs, KEY));
  } catch (err) {
    log.warn('не удалось запомнить папку', err);
  }
}

export async function loadDirs(): Promise<SavedDir[]> {
  if (!canSaveHandles()) return [];
  try {
    const value: unknown = await tx('readonly', (s) => s.get(KEY));
    if (!Array.isArray(value)) return [];
    return value.filter(
      (v): v is SavedDir => typeof v === 'object' && v !== null && 'handle' in v && v.handle instanceof FileSystemDirectoryHandle,
    );
  } catch (err) {
    log.warn('не удалось прочитать сохранённую папку', err);
    return [];
  }
}

export async function forgetDirs(): Promise<void> {
  if (!canSaveHandles()) return;
  try {
    await tx('readwrite', (s) => s.delete(KEY));
  } catch (err) {
    log.warn('не удалось забыть папку', err);
  }
}

/** Должен вызываться из обработчика клика (нужен жест пользователя). */
export async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const desc: FileSystemHandlePermissionDescriptor = { mode: 'read' };
  if (handle.queryPermission && (await handle.queryPermission(desc)) === 'granted') return true;
  if (!handle.requestPermission) return true;
  return (await handle.requestPermission(desc)) === 'granted';
}
