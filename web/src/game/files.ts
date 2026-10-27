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

/**
 * Набор файлов из одного или нескольких источников. Источник, содержащий valve/ или cstrike/,
 * заменяет ранее выбранные файлы этого корня — так работают отдельные кнопки «valve» и «cstrike».
 */
export class GameFileSet {
  private readonly byPath = new Map<string, ScannedFile>();
  private skipped = emptySkip();
  private readonly labels: Partial<Record<GameRoot, string>> = {};

  addSource(scan: SourceScan): void {
    const roots = new Set<GameRoot>(scan.files.map((f) => rootOf(f.path)));
    for (const root of roots) {
      for (const path of [...this.byPath.keys()]) if (rootOf(path) === root) this.byPath.delete(path);
      this.skipped[root] = scan.skipped[root];
      this.labels[root] = scan.label;
    }
    for (const file of scan.files) this.byPath.set(file.path, file);
  }

  clear(): void {
    this.byPath.clear();
    this.skipped = emptySkip();
    delete this.labels.valve;
    delete this.labels.cstrike;
  }

  get size(): number {
    return this.byPath.size;
  }

  label(root: GameRoot): string | undefined {
    return this.labels[root];
  }

  validate(): Validation {
    return validateGamePaths(this.byPath.keys());
  }

  /** Сумма известных размеров (для zip — 0, пока не прочитано). */
  knownBytes(): number {
    let total = 0;
    for (const f of this.byPath.values()) total += f.size ?? 0;
    return total;
  }

  hasUnknownSizes(): boolean {
    for (const f of this.byPath.values()) if (f.size === null) return true;
    return false;
  }

  skippedTotal(): SkipStats {
    return {
      files: this.skipped.valve.files + this.skipped.cstrike.files,
      bytes: this.skipped.valve.bytes + this.skipped.cstrike.bytes,
    };
  }

  /** Читает всё в память. Карта «путь → содержимое» живёт до монтирования в движок. */
  async readAll(onProgress: (p: ReadProgress) => void, concurrency = 4): Promise<Map<string, Uint8Array>> {
    const files = [...this.byPath.values()];
    const totalBytes = this.hasUnknownSizes() ? null : this.knownBytes();
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
}
