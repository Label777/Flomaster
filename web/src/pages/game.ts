/** #/game — полноэкранный canvas, движок, панель управления, обработка обрыва связи. */
import { Net } from 'xash3d-fwgs';
import { toggleFullscreen } from '../ui/fullscreen';
import { h } from '../ui/dom';
import { legalFooter } from '../ui/shell';
import { errorMessage, formatMB } from '../ui/format';
import { log } from '../ui/log';
import { bindCanvasSize, initialCommands, startEngine, type Engine, type EngineStage } from '../game/engine';
import { parseResolution } from '../game/settings';
import { markEngineStarted, takeLaunchPlan, type LaunchPlan } from '../game/session';
import { fetchIce } from '../net/api';
import { WebRTCTransport } from '../net/webrtc';
import { FAKE_SERVER_ADDRESS } from '../net/protocol';
import { navigate, type Route } from '../router';

const STAGES: readonly { id: EngineStage; label: string }[] = [
  { id: 'engine', label: 'Загрузка движка' },
  { id: 'mount', label: 'Монтирование файлов' },
  { id: 'connect', label: 'Подключение к серверу' },
];

const PING_INTERVAL_MS = 2000;
const HISTORY_MAX = 50;

export function renderGame(root: HTMLElement, _route: Route): (() => void) | void {
  const plan = takeLaunchPlan();
  if (!plan) {
    // Перезагрузка на #/game: файлов в памяти уже нет.
    navigate('#/play');
    return;
  }
  markEngineStarted();
  return mountGame(root, plan);
}

function mountGame(root: HTMLElement, plan: LaunchPlan): () => void {
  const { settings } = plan;
  const online = settings.mode === 'online' && plan.server !== null;
  const resolution = parseResolution(settings.resolution);

  const canvas = h('canvas', { attrs: { id: 'canvas', tabindex: 0, 'aria-label': 'Игра' } });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  // --- загрузка ---
  const stageItems = new Map<EngineStage, { li: HTMLLIElement; detail: HTMLElement }>();
  const stageList = h(
    'ol',
    { class: 'stages' },
    ...STAGES.filter((s) => online || s.id !== 'connect').map((s) => {
      const detail = h('span', { class: 'stage-detail' });
      const li = h('li', { attrs: { 'data-state': 'pending' } }, h('span', { class: 'stage-label', text: s.label }), detail);
      stageItems.set(s.id, { li, detail });
      return li;
    }),
  );
  const loading = h(
    'div',
    { class: 'overlay loading', attrs: { role: 'status', 'aria-live': 'polite' } },
    h('div', { class: 'overlay-card' }, h('h1', { text: 'Запуск' }), stageList, h('p', { class: 'muted', text: `Файлы игры: ${formatMB(plan.totalBytes)}.` })),
  );

  const setStage = (stage: EngineStage, detail = ''): void => {
    let reached = false;
    for (const s of STAGES) {
      const item = stageItems.get(s.id);
      if (!item) continue;
      if (s.id === stage) {
        reached = true;
        item.li.dataset.state = 'active';
        item.detail.textContent = detail;
      } else {
        item.li.dataset.state = reached ? 'pending' : 'done';
        if (!reached) item.detail.textContent = '';
      }
    }
  };
  const finishStages = (): void => {
    for (const item of stageItems.values()) {
      item.li.dataset.state = 'done';
      item.detail.textContent = '';
    }
  };

  // --- ошибки и обрыв связи ---
  const panel = h('div', { class: 'overlay panel-overlay', attrs: { hidden: true } });
  const showPanel = (title: string, message: string, actions: HTMLElement[]): void => {
    loading.hidden = true;
    if (document.pointerLockElement) document.exitPointerLock();
    panel.replaceChildren(
      h(
        'div',
        { class: 'overlay-card', attrs: { role: 'alertdialog', 'aria-labelledby': 'panel-title', 'aria-describedby': 'panel-text' } },
        h('h1', { attrs: { id: 'panel-title' }, text: title }),
        h('p', { attrs: { id: 'panel-text' }, text: message }),
        h('div', { class: 'panel-actions' }, ...actions),
      ),
    );
    panel.hidden = false;
    actions[0]?.focus();
  };
  const leaveButton = (text = 'Назад'): HTMLButtonElement =>
    h('button', { class: 'btn btn-primary', attrs: { type: 'button' }, text, on: { click: () => leave(false) } });

  const showFatal = (err: unknown): void => {
    log.error('запуск', err);
    showPanel('Игра не запустилась', errorMessage(err), [leaveButton()]);
  };

  // --- панель управления (видна, когда мышь не захвачена) ---
  const consoleInput = h('input', {
    class: 'console-input',
    attrs: { type: 'text', 'aria-label': 'Команда консоли', placeholder: 'Команда, например: cl_showfps 1', autocomplete: 'off', spellcheck: 'false' },
  });
  const consoleForm = h('form', { class: 'console', attrs: { hidden: true } }, consoleInput);
  const pingBadge = h('span', { class: 'ping', attrs: { hidden: true, 'aria-live': 'off', title: 'Задержка до сервера' } });

  const toolbar = h(
    'div',
    { class: 'toolbar', attrs: { role: 'toolbar', 'aria-label': 'Управление игрой' } },
    h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text: 'Во весь экран', on: { click: () => void toggleFullscreen() } }),
    h('button', { class: 'btn btn-small', attrs: { type: 'button', 'aria-expanded': 'false' }, text: 'Консоль', on: { click: (ev) => toggleConsole(ev.currentTarget as HTMLButtonElement) } }),
    h('button', { class: 'btn btn-small btn-danger', attrs: { type: 'button' }, text: 'Выйти', on: { click: () => leave(true) } }),
    h('span', { class: 'toolbar-hint', text: 'Esc освобождает мышь, клик по игре — снова захватывает' }),
    pingBadge,
  );
  const topBar = h('div', { class: 'game-top' }, toolbar, consoleForm);

  const screen = h('div', { class: 'game-screen' }, canvas, topBar, loading, panel, legalFooter('legal game-legal'));
  root.replaceChildren(screen);
  document.body.classList.add('in-game');

  // --- поведение ---
  let engine: Engine | null = null;
  let transport: WebRTCTransport | null = null;
  let pingTimer: number | undefined;
  let leaving = false;
  const history: string[] = [];
  let historyPos = 0;

  const unbindSize = bindCanvasSize(canvas, resolution);

  canvas.addEventListener('click', () => {
    if (!engine || !panel.hidden) return;
    // В старых Safari/Firefox requestPointerLock() ничего не возвращает, в новых — Promise.
    const request = canvas.requestPointerLock() as Promise<void> | undefined;
    request?.catch(() => {
      /* отказ сразу после выхода из захвата — следующий клик повторит */
    });
  });

  const onPointerLock = (): void => {
    const locked = document.pointerLockElement === canvas;
    screen.classList.toggle('locked', locked);
    if (locked) consoleInput.blur();
  };
  document.addEventListener('pointerlockchange', onPointerLock);

  function toggleConsole(btn: HTMLButtonElement): void {
    consoleForm.hidden = !consoleForm.hidden;
    btn.setAttribute('aria-expanded', String(!consoleForm.hidden));
    if (!consoleForm.hidden) consoleInput.focus();
  }

  consoleForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const cmd = consoleInput.value.trim();
    if (!cmd || !engine) return;
    engine.exec(cmd);
    if (history[history.length - 1] !== cmd) history.push(cmd);
    if (history.length > HISTORY_MAX) history.shift();
    historyPos = history.length;
    consoleInput.value = '';
  });
  consoleInput.addEventListener('keydown', (ev) => {
    // Клавиши консоли не должны уходить в игру.
    ev.stopPropagation();
    if (ev.key === 'ArrowUp' && historyPos > 0) {
      ev.preventDefault();
      consoleInput.value = history[--historyPos] ?? '';
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      historyPos = Math.min(history.length, historyPos + 1);
      consoleInput.value = history[historyPos] ?? '';
    } else if (ev.key === 'Escape') {
      consoleInput.blur();
      canvas.focus();
    }
  });
  consoleInput.addEventListener('keyup', (ev) => ev.stopPropagation());

  const onBeforeUnload = (ev: BeforeUnloadEvent): void => {
    if (leaving) return;
    ev.preventDefault();
    ev.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  /** Движок нельзя переинициализировать — выход только перезагрузкой страницы. */
  function leave(ask: boolean): void {
    if (ask && !confirm('Выйти из игры? Файлы игры придётся выбрать заново.')) return;
    leaving = true;
    transport?.close();
    location.hash = '#/g/cs16';
    location.reload();
  }

  const showConnectionLost = (reason: string, title = 'Соединение потеряно'): void => {
    clearInterval(pingTimer);
    pingBadge.hidden = true;
    const retry = h('button', {
      class: 'btn btn-primary',
      attrs: { type: 'button' },
      text: 'Переподключиться',
      on: { click: () => void reconnect() },
    });
    showPanel(title, reason, [retry, leaveButton('Выйти')]);
  };

  const startPing = (): void => {
    clearInterval(pingTimer);
    pingBadge.hidden = false;
    pingBadge.textContent = '… мс';
    pingTimer = window.setInterval(() => {
      void transport?.getRttMs().then((rtt) => {
        pingBadge.textContent = rtt === null ? '— мс' : `${Math.round(rtt)} мс`;
        pingBadge.dataset.level = rtt === null ? '' : rtt < 60 ? 'good' : rtt < 120 ? 'ok' : 'bad';
      });
    }, PING_INTERVAL_MS);
  };

  /** Новый WebRTC-канал + `connect`. Движок и Net остаются те же — меняется только транспорт под Net. */
  const connectTransport = async (net: Net | null): Promise<WebRTCTransport> => {
    const server = plan.server;
    if (!server) throw new Error('Сервер не выбран.');
    setStage('connect', 'получаем адреса STUN/TURN');
    const ice = await fetchIce();
    setStage('connect', `сервер «${server.name}»`);
    const t = new WebRTCTransport();
    if (net) t.net = net;
    t.onClose = (reason) => {
      if (!leaving) showConnectionLost(reason);
    };
    await t.connect(server.signalUrl, ice.iceServers);
    return t;
  };

  let netRef: Net | null = null;
  /** Пересылка в текущий транспорт: Net создаётся один раз, транспорт под ним можно заменить. */
  const relay = {
    sendto: (packet: Parameters<WebRTCTransport['sendto']>[0]) => transport?.sendto(packet),
  };

  async function reconnect(): Promise<void> {
    panel.hidden = true;
    loading.hidden = false;
    transport?.close();
    try {
      transport = await connectTransport(netRef);
      setStage('connect', 'вход на сервер');
      await engine?.execSequence([`connect ${FAKE_SERVER_ADDRESS}`]);
      finishStages();
      loading.hidden = true;
      canvas.focus();
      startPing();
    } catch (err) {
      showConnectionLost(errorMessage(err), 'Не удалось подключиться');
    }
  }

  const onVisibility = (): void => {
    if (document.visibilityState !== 'visible' || !online || !engine || !panel.hidden) return;
    const state = transport?.state;
    if (state === 'closed' || state === 'failed') showConnectionLost('Пока вкладка была скрыта, соединение с сервером прервалось.');
  };
  document.addEventListener('visibilitychange', onVisibility);

  // --- запуск ---
  const run = async (): Promise<void> => {
    // Net создаётся с ретранслятором и присваивается xash.net до init() (внутри startEngine).
    if (online) netRef = new Net(relay);
    engine = await startEngine(
      {
        canvas,
        renderer: settings.renderer,
        resolution,
        net: netRef ?? undefined,
        onStage: (stage) => setStage(stage),
        onMountProgress: (done, total) => setStage('mount', `${done.toLocaleString('ru-RU')} из ${total.toLocaleString('ru-RU')}`),
      },
      plan.files,
    );
    await engine.execSequence(initialCommands(settings.nickname, settings.sensitivity));

    if (online) {
      try {
        transport = await connectTransport(netRef);
      } catch (err) {
        log.warn('подключение', err);
        showConnectionLost(errorMessage(err), 'Не удалось подключиться');
        return;
      }
      setStage('connect', 'вход на сервер');
      await engine.execSequence([`connect ${FAKE_SERVER_ADDRESS}`]);
      startPing();
    } else {
      await engine.execSequence([`map ${settings.map}`]);
    }
    finishStages();
    loading.hidden = true;
    canvas.focus();
  };

  void run().catch(showFatal);

  return () => {
    clearInterval(pingTimer);
    unbindSize();
    transport?.close();
    document.removeEventListener('pointerlockchange', onPointerLock);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.body.classList.remove('in-game');
  };
}
