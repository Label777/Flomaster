/** Шаг 1 на #/play: выбор и чтение файлов игры. */
import { h } from '../ui/dom';
import { progressBar } from '../ui/progress';
import { countFiles, errorMessage, formatMB } from '../ui/format';
import { gameFiles, readScan, scanDirectoryHandle, scanFileList, type ReadProgress, type SourceScan } from '../game/files';
import { scanZip } from '../game/zip';
import { canSaveHandles, ensureReadPermission, forgetDirs, loadDirs, saveDirs, type SavedDir } from '../game/handles';
import type { GameRoot } from '../game/paths';
import type { Validation } from '../game/validate';
import { detectSupport } from '../ui/support';
import { log } from '../ui/log';

/** Выше этого объёма предупреждаем о памяти. */
const MEMORY_WARN_BYTES = 700 * 1024 * 1024;

export interface Loader {
  el: HTMLElement;
  /** Вызывается после каждого изменения набора файлов. */
  onChange: ((v: Validation) => void) | null;
}

type Target = 'full' | GameRoot;

const TARGET_TITLE: Record<Target, string> = {
  full: 'Выбрать папку игры',
  valve: 'Папка valve',
  cstrike: 'Папка cstrike',
};

/** Папки, выбранные через showDirectoryPicker в этой сессии: запоминаются после успешной проверки. */
let sessionDirs: SavedDir[] = [];

export function createLoader(): Loader {
  const support = detectSupport();
  const loader: Loader = { el: h('section'), onChange: null };
  let busy = false;

  const progress = progressBar('Чтение файлов игры');
  const errorBox = h('div', { class: 'alert alert-error', attrs: { role: 'alert', hidden: true } });
  const checklist = h('ul', { class: 'checklist', attrs: { 'aria-label': 'Что найдено' } });
  const summary = h('div', { class: 'summary', attrs: { 'aria-live': 'polite' } });
  const savedSlot = h('div', { class: 'saved-slot' });
  const buttons: HTMLButtonElement[] = [];

  const setBusy = (value: boolean): void => {
    busy = value;
    for (const b of buttons) b.disabled = value;
    loader.el.setAttribute('aria-busy', String(value));
  };

  const showError = (message: string | null): void => {
    errorBox.hidden = message === null;
    errorBox.textContent = message ?? '';
  };

  /**
   * Общий путь: скан → проверка, что там вообще что-то есть → чтение → обновление состояния.
   * Если источник — папка из showDirectoryPicker, getScan возвращает и её handle (для «запомнить папку»).
   */
  const ingest = async (getScan: () => Promise<{ scan: SourceScan; dir?: SavedDir }>): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    showError(null);
    try {
      progress.set(null, 'Ищем файлы…');
      const { scan, dir } = await getScan();
      if (scan.files.length === 0) {
        throw new Error(
          `В «${scan.label}» не найдено папок valve и cstrike. Выберите папку Half-Life (в ней лежат valve и cstrike) или каждую папку отдельно.`,
        );
      }
      const data = await readScan(scan, (p) => progress.set(fraction(p), progressText(p)));
      gameFiles.add(scan, data);
      rememberSessionDir(dir ?? null);
      return true;
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        log.warn('загрузка файлов', err);
        showError(errorMessage(err));
      }
      return false;
    } finally {
      progress.hide();
      setBusy(false);
      update();
    }
  };

  const scanDir = async (handle: FileSystemDirectoryHandle, hint?: GameRoot): Promise<{ scan: SourceScan; dir: SavedDir }> => {
    const scan = await scanDirectoryHandle(handle, hint, (n) => progress.set(null, `Найдено ${countFiles(n)}…`));
    return { scan, dir: { handle, hint } };
  };

  const pickDirectory = (target: Target): void => {
    const hint = target === 'full' ? undefined : target;
    const picker = window.showDirectoryPicker;
    if (support.directoryPicker && picker) {
      void ingest(async () => scanDir(await picker.call(window, { id: 'cs16-gamedir', mode: 'read' }), hint)).then(persistIfValid);
      return;
    }
    // Фолбэк: <input webkitdirectory> (Firefox, Safari).
    const input = h('input', { attrs: { type: 'file', webkitdirectory: true, multiple: true, hidden: true } });
    input.addEventListener('change', () => {
      const files = input.files;
      input.remove();
      if (files && files.length > 0) void ingest(async () => ({ scan: scanFileList(files, hint) }));
    });
    document.body.append(input);
    input.click();
  };

  const pickZip = (): void => {
    const input = h('input', { attrs: { type: 'file', accept: '.zip,application/zip', hidden: true } });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (file) {
        void ingest(async () => ({ scan: await scanZip(file, (n) => progress.set(null, `Разбираем архив: ${countFiles(n)}…`)) }));
      }
    });
    document.body.append(input);
    input.click();
  };

  const useSaved = async (saved: SavedDir[]): Promise<void> => {
    for (const s of saved) {
      if (!(await ensureReadPermission(s.handle))) {
        showError('Браузер не дал доступ к сохранённой папке. Выберите её заново.');
        return;
      }
    }
    for (const s of saved) {
      if (!(await ingest(() => scanDir(s.handle, s.hint)))) return;
    }
  };

  const persistIfValid = async (): Promise<void> => {
    if (canSaveHandles() && sessionDirs.length > 0 && gameFiles.validate().ok) await saveDirs(sessionDirs);
  };

  const button = (text: string, onClick: () => void, cls = 'btn'): HTMLButtonElement => {
    const b = h('button', { class: cls, attrs: { type: 'button' }, text, on: { click: onClick } });
    buttons.push(b);
    return b;
  };

  const update = (): void => {
    const v = gameFiles.validate();
    renderChecklist(checklist, v);
    renderSummary(summary, v);
    loader.onChange?.(v);
  };

  const renderSaved = async (): Promise<void> => {
    const saved = await loadDirs();
    if (saved.length === 0) {
      savedSlot.replaceChildren();
      return;
    }
    const names = saved.map((s) => `«${s.handle.name}»`).join(' и ');
    const useBtn = button('Использовать сохранённую папку', () => void useSaved(saved).then(persistIfValid), 'btn btn-primary');
    const forgetBtn = h('button', {
      class: 'btn-link',
      attrs: { type: 'button' },
      text: 'Забыть',
      on: {
        click: () => {
          void forgetDirs();
          savedSlot.replaceChildren();
        },
      },
    });
    savedSlot.replaceChildren(h('div', { class: 'saved' }, useBtn, h('span', { class: 'muted', text: `В прошлый раз: ${names}.` }), forgetBtn));
  };

  loader.el = h(
    'section',
    { class: 'panel loader', attrs: { 'aria-labelledby': 'loader-title' } },
    h('h2', { attrs: { id: 'loader-title' } }, h('span', { class: 'step-no', text: '1' }), 'Файлы игры'),
    h(
      'p',
      { class: 'muted' },
      'Выберите папку Half-Life из Steam — в ней лежат valve и cstrike. Файлы читаются только в этой вкладке и никуда не отправляются. ',
      h('a', { attrs: { href: '#/guide' }, text: 'Где её найти?' }),
    ),
    savedSlot,
    h(
      'div',
      { class: 'pickers' },
      button(TARGET_TITLE.full, () => pickDirectory('full'), 'btn btn-primary btn-lg'),
      button('Загрузить .zip', pickZip, 'btn btn-lg'),
    ),
    h(
      'details',
      { class: 'separate' },
      h('summary', { text: 'Папки valve и cstrike лежат отдельно' }),
      h('p', { class: 'muted', text: 'Выберите каждую папку своей кнопкой. Повторный выбор заменяет ранее выбранную папку.' }),
      h('div', { class: 'pickers' }, button(TARGET_TITLE.valve, () => pickDirectory('valve')), button(TARGET_TITLE.cstrike, () => pickDirectory('cstrike'))),
    ),
    progress.el,
    errorBox,
    checklist,
    summary,
  );

  void renderSaved();
  queueMicrotask(update);
  return loader;
}

/** Запоминает папку, из которой пришли файлы. null — источник не папка (zip/webkitdirectory). */
function rememberSessionDir(dir: SavedDir | null): void {
  if (!dir) sessionDirs = [];
  else if (!dir.hint) sessionDirs = [dir];
  else sessionDirs = [...sessionDirs.filter((d) => d.hint !== undefined && d.hint !== dir.hint), dir];
}

function fraction(p: ReadProgress): number | null {
  if (p.totalBytes) return p.bytes / p.totalBytes;
  return p.totalFiles ? p.files / p.totalFiles : null;
}

function progressText(p: ReadProgress): string {
  const bytes = p.totalBytes !== null ? `${formatMB(p.bytes)} из ${formatMB(p.totalBytes)}` : formatMB(p.bytes);
  return `Читаем: ${bytes}, ${p.files.toLocaleString('ru-RU')} из ${countFiles(p.totalFiles)}`;
}

function renderChecklist(list: HTMLElement, v: Validation): void {
  if (gameFiles.size === 0) {
    list.replaceChildren();
    return;
  }
  const where = (root: GameRoot): string => {
    const label = gameFiles.label(root);
    return label ? ` — из «${label}»` : '';
  };
  list.replaceChildren(
    ...v.checks.map((c) => {
      const source = c.id === 'valve-liblist' ? where('valve') : c.id === 'cstrike-liblist' ? where('cstrike') : '';
      return h(
        'li',
        { class: c.ok ? 'ok' : 'missing' },
        h('span', { class: 'check-icon', attrs: { 'aria-hidden': 'true' }, text: c.ok ? '✓' : '✗' }),
        h('span', { class: 'visually-hidden', text: c.ok ? 'Есть: ' : 'Нет: ' }),
        h('span', null, h('span', { class: 'check-label', text: c.label + source }), c.ok ? null : h('span', { class: 'check-hint', text: c.hint })),
      );
    }),
  );
}

function renderSummary(box: HTMLElement, v: Validation): void {
  if (gameFiles.size === 0) {
    box.replaceChildren();
    return;
  }
  const total = gameFiles.totalBytes();
  const skipped = gameFiles.skippedTotal();
  const parts: HTMLElement[] = [
    h('p', null, `В памяти: ${countFiles(gameFiles.size)}, ${formatMB(total)}.`, v.maps.length ? ` Карт: ${v.maps.length}.` : ''),
  ];
  if (skipped.files > 0) {
    parts.push(
      h('p', { class: 'muted', text: `Пропущено ${countFiles(skipped.files)} (${formatMB(skipped.bytes)}): программы для Windows/macOS/Linux и карты одиночной кампании Half-Life — для CS они не нужны.` }),
    );
  }
  if (total > MEMORY_WARN_BYTES) {
    parts.push(
      h('p', { class: 'alert alert-warn', text: `Файлов больше 700 МБ — игре понадобится много памяти. Используйте 64-битный браузер на компьютере и закройте лишние вкладки. Чтобы уменьшить объём, уберите из cstrike/maps ненужные карты.` }),
    );
  }
  if (v.ok) parts.push(h('p', { class: 'ready', text: 'Всё на месте — можно запускать.' }));
  box.replaceChildren(...parts);
}
