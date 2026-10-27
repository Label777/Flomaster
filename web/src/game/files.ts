/**
 * Сбор файлов игры с диска игрока. Ничего никуда не отправляется и не кэшируется:
 * содержимое читается в память вкладки и потом пишется только в MEMFS движка.
 */
import { isRelevantDir, normalizeGamePath, skipReason, splitPath, type GameRoot } from './paths';
import { validateGamePaths, type Validation } from './validate';

export interface ScannedFile {
  /** Нормализованный путь: «valve/gfx.wad». */
  path: string;
  /** Размер в байтах; null — неизвестен до чтения (zip). */
  size: number | null;
  read(): Promise<Uint8Array>;
}

export interface SkipStats {
  files: number;
  bytes: number;
}

export interface SourceScan {
  /** Подпись для интерфейса: имя папки или архива. */
  label: string;
  files: ScannedFile[];
  skipped: Record<GameRoot, SkipStats>;
}

export type ScanProgress = (filesSeen: number) => void;

export function emptySkip(): Record<GameRoot, SkipStats> {
  return { valve: { files: 0, bytes: 0 }, cstrike: { files: 0, bytes: 0 } };
}

function rootOf(path: string): GameRoot {
  return path.startsWith('valve/') ? 'valve' : 'cstrike';
}

/** Общая сортировка найденного файла: в набор, в пропущенные или мимо. */
export class ScanBuilder {
  readonly files: ScannedFile[] = [];
  readonly skipped = emptySkip();
  private seen = 0;

  constructor(
    private readonly hint: GameRoot | undefined,
    private readonly onProgress?: ScanProgress,
  ) {}

  add(rawPath: string, size: number | null, read: () => Promise<Uint8Array>): void {
    this.seen++;
    if (this.onProgress && this.seen % 50 === 0) this.onProgress(this.seen);
    const path = normalizeGamePath(rawPath, this.hint);
    if (!path) return;
    if (skipReason(path)) {
      const s = this.skipped[rootOf(path)];
      s.files++;
      s.bytes += size ?? 0;
      return;
    }
    this.files.push({ path, size, read });
  }

  finish(label: string): SourceScan {
    this.onProgress?.(this.seen);
    return { label, files: this.files, skipped: this.skipped };
  }
}

const readFile = (file: File) => async (): Promise<Uint8Array> => new Uint8Array(await file.arrayBuffer());

/** Обход папки, выбранной через showDirectoryPicker (Chromium). */
export async function scanDirectoryHandle(
  dir: FileSystemDirectoryHandle,
  hint?: GameRoot,
  onProgress?: ScanProgress,
): Promise<SourceScan> {
  const builder = new ScanBuilder(hint, onProgress);

  const walk = async (handle: FileSystemDirectoryHandle, segments: string[]): Promise<void> => {
    if (!isRelevantDir(segments, hint)) return;
    for await (const entry of handle.values()) {
      const childSegments = [...segments, entry.name];
      if (entry.kind === 'directory') {
        await walk(entry, childSegments);
      } else {
        const file = await entry.getFile();
        builder.add(childSegments.join('/'), file.size, readFile(file));
      }
    }
  };

  await walk(dir, [dir.name]);
  return builder.finish(dir.name);
}

/** Файлы из <input type=file webkitdirectory> (Firefox, Safari). */
export function scanFileList(files: ArrayLike<File>, hint?: GameRoot): SourceScan {
  const builder = new ScanBuilder(hint);
  let label = '';
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file) continue;
    const rel = file.webkitRelativePath || file.name;
    if (!label) label = splitPath(rel)[0] ?? '';
    builder.add(rel, file.size, readFile(file));
  }
  return builder.finish(label || 'выбранная папка');
}

export interface ReadProgress {
  files: number;
  totalFiles: number;
  bytes: number;
  /** null, если размеры заранее неизвестны (zip). */
  totalBytes: number | null;
}

/** Читает содержимое всех файлов источника в память. */
export async function readScan(
  scan: SourceScan,
  onProgress: (p: ReadProgress) => void,
  concurrency = 4,
): Promise<Map<string, Uint8Array>> {
  const files = scan.files;
  const unknown = files.some((f) => f.size === null);
  const totalBytes = unknown ? null : files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  const out = new Map<string, Uint8Array>();
  const progress: ReadProgress = { files: 0, totalFiles: files.length, bytes: 0, totalBytes };
  let next = 0;
  let lastReport = 0;

  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++];
      if (!file) break;
      let data: Uint8Array;
      try {
        data = await file.read();
      } catch (err) {
        throw new Error(`Не удалось прочитать ${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
      out.set(file.path, data);
      progress.files++;
      progress.bytes += data.byteLength;
      const now = performance.now();
      if (now - lastReport > 80 || progress.files === files.length) {
        lastReport = now;
        onProgress({ ...progress });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  return out;
}

/**
 * Прочитанные файлы игры из одного или нескольких источников. Источник с valve/ или cstrike/
 * заменяет ранее выбранные файлы этого корня — так работают отдельные кнопки «valve» и «cstrike».
 * Содержимое живёт только в памяти вкладки до передачи движку (take()).
 */
export class GameFileSet {
  private data = new Map<string, Uint8Array>();
  private skipped = emptySkip();
  private labels: Partial<Record<GameRoot, string>> = {};

  add(scan: SourceScan, data: Map<string, Uint8Array>): void {
    const roots = new Set<GameRoot>([...data.keys()].map(rootOf));
    for (const root of roots) {
      for (const path of [...this.data.keys()]) if (rootOf(path) === root) this.data.delete(path);
      this.skipped[root] = scan.skipped[root];
      this.labels[root] = scan.label;
    }
    for (const [path, bytes] of data) this.data.set(path, bytes);
  }

  clear(): void {
    this.data = new Map();
    this.skipped = emptySkip();
    this.labels = {};
  }

  get size(): number {
    return this.data.size;
  }

  label(root: GameRoot): string | undefined {
    return this.labels[root];
  }

  validate(): Validation {
    return validateGamePaths(this.data.keys());
  }

  totalBytes(): number {
    let total = 0;
    for (const bytes of this.data.values()) total += bytes.byteLength;
    return total;
  }

  skippedTotal(): SkipStats {
    return {
      files: this.skipped.valve.files + this.skipped.cstrike.files,
      bytes: this.skipped.valve.bytes + this.skipped.cstrike.bytes,
    };
  }

  /** Отдаёт файлы движку и забывает их: дальше ссылками владеет только вызывающий. */
  take(): Map<string, Uint8Array> {
    const out = this.data;
    this.clear();
    return out;
  }
}

/** Файлы, выбранные на #/play; переживают переходы между страницами, но не перезагрузку. */
export const gameFiles = new GameFileSet();
