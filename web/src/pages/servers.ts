import { h } from '../ui/dom';
import { renderShell } from '../ui/shell';
import { errorMessage, formatTime } from '../ui/format';
import { fetchServers, measurePing, type ServerInfo, type ServerStatus } from '../net/api';
import { detectSupport } from '../ui/support';
import type { Route } from '../router';
import { API_DISABLED } from '../net/endpoints';

const REFRESH_MS = 10_000;
const NO_DATA = 'нет данных';

const STATUS_LABEL: Record<ServerStatus, string> = {
  online: 'Работает',
  offline: 'Выключен',
  unknown: 'Неизвестно',
};

export function renderServers(root: HTMLElement, route: Route): (() => void) | void {
  if (API_DISABLED) return renderNoServers(root, route);
  const canPlay = detectSupport().online;
  const tbody = h('tbody');
  const status = h('p', { class: 'muted', attrs: { role: 'status', 'aria-live': 'polite' }, text: 'Загрузка списка…' });
  const refreshBtn = h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text: 'Обновить', on: { click: () => void refresh() } });

  renderShell(root, route.name, [
    h(
      'section',
      { class: 'servers' },
      h('div', { class: 'section-head' }, h('h1', { text: 'Серверы' }), refreshBtn),
      h('p', { class: 'lead', text: 'Список обновляется каждые 10 секунд. Пинг — время ответа нашего сайта, сервер игры стоит на той же машине.' }),
      canPlay ? null : h('p', { class: 'notice', text: 'В этом браузере онлайн-игра недоступна (нужны компьютер и WebRTC), но список можно смотреть.' }),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'server-table' },
          h('caption', { class: 'visually-hidden', text: 'Список игровых серверов' }),
          h(
            'thead',
            null,
            h(
              'tr',
              null,
              ...['Название', 'Карта', 'Игроки', 'Пинг', 'Статус', ''].map((t) => h('th', { attrs: { scope: 'col' }, text: t })),
            ),
          ),
          tbody,
        ),
      ),
      status,
    ),
  ]);

  let timer: number | undefined;
  let controller: AbortController | null = null;
  let disposed = false;
  let ping: number | null = null;
  let loading = false;

  const refresh = async (): Promise<void> => {
    if (loading || disposed) return;
    loading = true;
    refreshBtn.disabled = true;
    controller?.abort();
    controller = new AbortController();
    try {
      const [servers, pingMs] = await Promise.all([fetchServers(controller.signal), measurePing(3)]);
      if (disposed) return;
      ping = pingMs;
      renderRows(tbody, servers, ping, canPlay);
      status.textContent = servers.length === 0 ? 'Серверов пока нет.' : `Обновлено в ${formatTime(new Date())}`;
    } catch (err) {
      if (disposed || (err instanceof DOMException && err.name === 'AbortError')) return;
      status.textContent = `Не удалось получить список: ${errorMessage(err)} Повторим через 10 секунд.`;
    } finally {
      loading = false;
      refreshBtn.disabled = false;
      schedule();
    }
  };

  const schedule = (): void => {
    clearTimeout(timer);
    if (!disposed && document.visibilityState === 'visible') timer = window.setTimeout(() => void refresh(), REFRESH_MS);
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') void refresh();
    else clearTimeout(timer);
  };
  document.addEventListener('visibilitychange', onVisibility);
  void refresh();

  return () => {
    disposed = true;
    clearTimeout(timer);
    controller?.abort();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

function renderRows(tbody: HTMLElement, servers: ServerInfo[], ping: number | null, canPlay: boolean): void {
  if (servers.length === 0) {
    tbody.replaceChildren(h('tr', null, h('td', { attrs: { colspan: 6 }, class: 'empty', text: 'Серверов пока нет.' })));
    return;
  }
  tbody.replaceChildren(
    ...servers.map((s) => {
      const players = s.players === null ? NO_DATA : `${s.players}${s.maxPlayers !== null ? ` / ${s.maxPlayers}` : ''}`;
      // «unknown» — сервер мог не ответить на A2S, но работать; играть разрешаем, кроме явного offline.
      const online = s.status !== 'offline';
      const action =
        online && canPlay
          ? h('a', { class: 'btn btn-primary btn-small', attrs: { href: `#/play?server=${encodeURIComponent(s.id)}`, 'aria-label': `Играть на сервере ${s.name}` }, text: 'Играть' })
          : h('span', { class: 'muted', text: online ? '' : '—' });
      return h(
        'tr',
        null,
        h('th', { attrs: { scope: 'row' }, text: s.name }),
        h('td', { attrs: { 'data-label': 'Карта' }, class: s.map ? '' : 'muted', text: s.map ?? NO_DATA }),
        h('td', { attrs: { 'data-label': 'Игроки' }, class: s.players === null ? 'muted' : 'num', text: players }),
        h('td', { attrs: { 'data-label': 'Пинг' }, class: ping === null ? 'muted' : 'num', text: online && ping !== null ? `${Math.round(ping)} мс` : NO_DATA }),
        h('td', { attrs: { 'data-label': 'Статус' } }, h('span', { class: `status status-${s.status}`, text: STATUS_LABEL[s.status] })),
        h('td', { class: 'action' }, action),
      );
    }),
  );
}

/** Сборка без API (например, GitHub Pages без VPS): опрашивать нечего. */
function renderNoServers(root: HTMLElement, route: Route): void {
  renderShell(root, route.name, [
    h(
      'section',
      { class: 'prose' },
      h('h1', { text: 'Серверы' }),
      h('p', { class: 'lead', text: 'К этой версии сайта игровой сервер не подключён.' }),
      h('p', { text: 'Counter-Strike 1.6 можно запустить офлайн на любой карте из вашей папки игры, а HTML5-игры каталога работают без сервера.' }),
      h('p', null, h('a', { class: 'btn btn-primary', attrs: { href: '#/g/cs16' }, text: 'К Counter-Strike 1.6' }), ' ', h('a', { class: 'btn', attrs: { href: '#/' }, text: 'В каталог' })),
    ),
  ]);
}
