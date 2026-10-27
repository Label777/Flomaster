/**
 * Запуск Xash3D FWGS + cs16-client. Конфигурация повторяет upstream (ARCHITECTURE.md §3).
 * Используются только API из опубликованных .d.ts xash3d-fwgs@1.2.2:
 * new Xash3D(opts), xash.net (до init), init(), em.FS.{mkdirTree,writeFile,chdir}, main(),
 * Cmd_ExecuteString(), exited.
 */
import { Xash3D, type Net } from 'xash3d-fwgs';
import xashURL from 'xash3d-fwgs/xash.wasm?url';
import filesystemURL from 'xash3d-fwgs/filesystem_stdio.wasm?url';
import webgl2URL from 'xash3d-fwgs/libref_webgl2.wasm?url';
import softURL from 'xash3d-fwgs/libref_soft.wasm?url';
import clientURL from 'cs16-client/cl_dlls/client_emscripten_wasm32.wasm?url';
import menuURL from 'cs16-client/cl_dlls/menu_emscripten_wasm32.wasm?url';
import serverURL from 'cs16-client/dlls/cs_emscripten_wasm32.wasm?url';
import csExtrasURL from 'cs16-client/extras.pk3?url';
import { nextFrame, sleep } from '../ui/dom';
import { log } from '../ui/log';
import type { RendererChoice } from './settings';

const ROOT = '/rodir';
/** Пауза между консольными командами: upstream предупреждает против пачек в одном тике. */
const COMMAND_GAP_MS = 150;

export type EngineStage = 'engine' | 'mount' | 'connect';

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  renderer: RendererChoice;
  /** null — «Авто» (размер окна). */
  resolution: { width: number; height: number } | null;
  /** Для онлайна — Net с WebRTC-транспортом; присваивается xash.net ДО init(). */
  net?: Net;
  onStage(stage: EngineStage): void;
  onMountProgress(done: number, total: number): void;
}

export interface Engine {
  xash: Xash3D;
  /** Консольная команда. */
  exec(cmd: string): void;
  /** Несколько команд с паузами между ними. */
  execSequence(cmds: readonly string[]): Promise<void>;
  readonly exited: boolean;
}

function buildArguments(resolution: EngineOptions['resolution']): string[] {
  const args = ['-windowed', '-game', 'cstrike'];
  // -width/-height — CLI-флаги движка; если движок их проигнорирует, всё равно действует размер canvas.
  if (resolution) args.push('-width', String(resolution.width), '-height', String(resolution.height));
  return args;
}

async function fetchExtras(): Promise<Uint8Array> {
  const res = await fetch(csExtrasURL);
  if (!res.ok) throw new Error(`Не удалось загрузить extras.pk3 (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Пишет файлы игрока в /rodir/<path>. Записанные элементы удаляются из Map — ссылки отпускаются
 * по ходу, чтобы данные не держались в памяти дважды (Map и MEMFS).
 */
async function mountFiles(xash: Xash3D, files: Map<string, Uint8Array>, extras: Uint8Array, onProgress: EngineOptions['onMountProgress']): Promise<void> {
  const FS = xash.em?.FS;
  if (!FS) throw new Error('Файловая система движка недоступна после init().');
  const madeDirs = new Set<string>();
  const ensureDir = (dir: string): void => {
    if (madeDirs.has(dir)) return;
    FS.mkdirTree(dir);
    madeDirs.add(dir);
  };

  const total = files.size;
  let done = 0;
  for (const [path, data] of files) {
    const full = `${ROOT}/${path}`;
    ensureDir(full.slice(0, full.lastIndexOf('/')));
    FS.writeFile(full, data);
    files.delete(path);
    done++;
    if (done % 64 === 0) {
      onProgress(done, total);
      await sleep(0); // даём браузеру перерисовать прогресс
    }
  }
  ensureDir(`${ROOT}/cstrike`);
  FS.writeFile(`${ROOT}/cstrike/extras.pk3`, extras);
  onProgress(total, total);
  FS.chdir(ROOT);
}

export async function startEngine(opts: EngineOptions, files: Map<string, Uint8Array>): Promise<Engine> {
  opts.onStage('engine');
  const xash = new Xash3D({
    canvas: opts.canvas,
    renderer: opts.renderer === 'soft' ? 'soft' : 'gl4es',
    arguments: buildArguments(opts.resolution),
    libraries: {
      xash: xashURL,
      filesystem: filesystemURL,
      client: clientURL,
      menu: menuURL,
      server: serverURL,
      render: { gl4es: webgl2URL, soft: softURL },
    },
    dynamicLibraries: ['dlls/cs_emscripten_wasm32.so', '/rwdir/filesystem_stdio.wasm'],
    filesMap: {
      'dlls/cs_emscripten_wasm32.so': serverURL,
      '/rwdir/filesystem_stdio.wasm': filesystemURL,
    },
  });
  if (opts.net) xash.net = opts.net;

  const [, extras] = await Promise.all([xash.init(), fetchExtras()]);
  log.debug('движок инициализирован');

  opts.onStage('mount');
  await mountFiles(xash, files, extras, opts.onMountProgress);
  log.debug('файлы смонтированы');

  xash.main();
  await nextFrame();

  const exec = (cmd: string): void => {
    log.debug('>', cmd);
    xash.Cmd_ExecuteString(cmd);
  };
  return {
    xash,
    exec,
    async execSequence(cmds) {
      for (const cmd of cmds) {
        await sleep(COMMAND_GAP_MS);
        await nextFrame();
        exec(cmd);
      }
    },
    get exited() {
      return xash.exited;
    },
  };
}

/** Команды после main(): отключение VGUI-меню, ник, чувствительность. */
export function initialCommands(nickname: string, sensitivity: number): string[] {
  return ['_vgui_menus 0', `name "${nickname}"`, `sensitivity ${sensitivity.toFixed(1)}`];
}

/**
 * Размер canvas. «Авто» — размер окна × devicePixelRatio (не больше 1, ради производительности),
 * пересчитывается при resize. Фиксированное разрешение — буфер W×H, CSS растягивает с сохранением пропорций.
 * Возвращает функцию отписки.
 */
export function bindCanvasSize(canvas: HTMLCanvasElement, resolution: EngineOptions['resolution']): () => void {
  if (resolution) {
    canvas.width = resolution.width;
    canvas.height = resolution.height;
    canvas.dataset.fit = 'contain';
    canvas.style.aspectRatio = `${resolution.width} / ${resolution.height}`;
    return () => {};
  }
  const apply = (): void => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1);
    canvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
  };
  canvas.dataset.fit = 'fill';
  apply();
  window.addEventListener('resize', apply);
  return () => window.removeEventListener('resize', apply);
}
