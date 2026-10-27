/** #/play — шаг 1 (файлы) и шаг 2 (настройки запуска). */
import { h } from '../ui/dom';
import { renderShell } from '../ui/shell';
import { errorMessage } from '../ui/format';
import { createLoader } from './play-loader';
import { gameFiles } from '../game/files';
import { defaultMap, type Validation } from '../game/validate';
import {
  NICKNAME_MAX,
  RESOLUTIONS,
  SENSITIVITY,
  clampSensitivity,
  loadSettings,
  sanitizeNickname,
  saveSettings,
  type LaunchSettings,
  type Resolution,
} from '../game/settings';
import { setLaunchPlan } from '../game/session';
import { fetchServers, type ServerInfo } from '../net/api';
import { detectSupport } from '../ui/support';
import { navigate, type Route } from '../router';

const RESOLUTION_LABEL: Record<Resolution, string> = {
  auto: 'Авто — размер окна',
  '800x600': '800 × 600',
  '1024x768': '1024 × 768',
  '1280x720': '1280 × 720',
  '1600x900': '1600 × 900',
  '1920x1080': '1920 × 1080',
};

export function renderPlay(root: HTMLElement, route: Route): () => void {
  const support = detectSupport();
  const settings = loadSettings();
  const preselect = route.params.get('server');
  if (preselect) {
    settings.mode = 'online';
    settings.serverId = preselect;
  }
  if (!support.online) settings.mode = 'offline';

  const controller = new AbortController();
  let validation: Validation | null = null;
  let servers: ServerInfo[] = [];

  // --- поля формы ---
  const nick = h('input', {
    attrs: { id: 'f-nick', type: 'text', required: true, maxlength: NICKNAME_MAX, autocomplete: 'nickname', spellcheck: 'false', value: settings.nickname },
  });
  const nickError = h('p', { class: 'field-error', attrs: { id: 'f-nick-err', hidden: true } });
  nick.setAttribute('aria-describedby', 'f-nick-err');

  const resolution = h(
    'select',
    { attrs: { id: 'f-res' } },
    ...RESOLUTIONS.map((r) => h('option', { attrs: { value: r, selected: r === settings.resolution }, text: RESOLUTION_LABEL[r] })),
  );

  const sensValue = h('output', { attrs: { for: 'f-sens', id: 'f-sens-out' }, text: settings.sensitivity.toFixed(1) });
  const sens = h('input', {
    attrs: { id: 'f-sens', type: 'range', min: SENSITIVITY.min, max: SENSITIVITY.max, step: SENSITIVITY.step, value: settings.sensitivity },
  });
  sens.addEventListener('input', () => (sensValue.textContent = Number(sens.value).toFixed(1)));

  const radio = <V extends string>(name: string, value: V, label: string, checked: boolean, disabled = false): HTMLLabelElement =>
    h('label', { class: 'choice' }, h('input', { attrs: { type: 'radio', name, value, checked, disabled } }), h('span', { text: label }));

  const rendererGroup = h(
    'fieldset',
    { class: 'field' },
    h('legend', { text: 'Отрисовка' }),
    radio('renderer', 'webgl2', 'WebGL 2', settings.renderer === 'webgl2'),
    radio('renderer', 'soft', 'Программный', settings.renderer === 'soft'),
    h('p', { class: 'field-hint', text: 'Программный режим медленнее, но может помочь, если WebGL работает с ошибками.' }),
  );

  const modeGroup = h(
    'fieldset',
    { class: 'field mode' },
    h('legend', { text: 'Режим' }),
    radio('mode', 'offline', 'Офлайн-карта', settings.mode === 'offline'),
    radio('mode', 'online', 'Подключиться к серверу', settings.mode === 'online', !support.online),
    support.online ? null : h('p', { class: 'field-hint', text: 'Онлайн недоступен: браузер не поддерживает WebRTC.' }),
  );

  const mapSelect = h('select', { attrs: { id: 'f-map' } });
  const mapField = h('div', { class: 'field' }, h('label', { attrs: { for: 'f-map' }, text: 'Карта' }), mapSelect);
  const serverSelect = h('select', { attrs: { id: 'f-server' } }, h('option', { attrs: { value: '' }, text: 'Загрузка списка…' }));
  const serverHint = h('p', { class: 'field-hint', attrs: { 'aria-live': 'polite' } });
  const serverField = h('div', { class: 'field' }, h('label', { attrs: { for: 'f-server' }, text: 'Сервер' }), serverSelect, serverHint);

  const launchBtn = h('button', { class: 'btn btn-primary btn-xl', attrs: { type: 'submit' }, text: 'Запустить' });
  const launchHint = h('p', { class: 'muted launch-hint', attrs: { 'aria-live': 'polite' } });

  const form = h(
    'form',
    { class: 'panel launcher', attrs: { novalidate: true, 'aria-labelledby': 'launcher-title' } },
    h('h2', { attrs: { id: 'launcher-title' } }, h('span', { class: 'step-no', text: '2' }), 'Запуск'),
    h(
      'div',
      { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', { attrs: { for: 'f-nick' }, text: 'Ник' }), nick, nickError),
      h('div', { class: 'field' }, h('label', { attrs: { for: 'f-res' }, text: 'Разрешение' }), resolution),
      h('div', { class: 'field' }, h('label', { attrs: { for: 'f-sens' } }, 'Чувствительность мыши ', sensValue), sens),
      rendererGroup,
      modeGroup,
      mapField,
      serverField,
    ),
    h('div', { class: 'launch-row' }, launchBtn, launchHint),
  );

  const selected = (name: string): string => (form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '');
  const currentMode = (): LaunchSettings['mode'] => (selected('mode') === 'online' ? 'online' : 'offline');

  const readForm = (): LaunchSettings => ({
    nickname: sanitizeNickname(nick.value),
    resolution: (RESOLUTIONS as readonly string[]).includes(resolution.value) ? (resolution.value as Resolution) : 'auto',
    sensitivity: clampSensitivity(Number(sens.value)),
    renderer: selected('renderer') === 'soft' ? 'soft' : 'webgl2',
    mode: currentMode(),
    map: mapSelect.value || settings.map,
    serverId: serverSelect.value || settings.serverId,
  });

  const fillMaps = (maps: readonly string[]): void => {
    const keep = mapSelect.value || settings.map;
    const pick = maps.includes(keep) ? keep : defaultMap(maps);
    mapSelect.replaceChildren(...maps.map((m) => h('option', { attrs: { value: m, selected: m === pick }, text: m })));
    mapSelect.disabled = maps.length === 0;
    if (maps.length === 0) mapSelect.append(h('option', { attrs: { value: '' }, text: 'Сначала выберите файлы игры' }));
  };

  const fillServers = (): void => {
    const keep = serverSelect.value || settings.serverId;
    if (servers.length === 0) {
      serverSelect.replaceChildren(h('option', { attrs: { value: '' }, text: 'Серверов нет' }));
      serverSelect.disabled = true;
      return;
    }
    serverSelect.disabled = false;
    const firstOnline = servers.find((s) => s.status === 'online')?.id ?? servers[0]?.id;
    const pick = servers.some((s) => s.id === keep) ? keep : firstOnline;
    serverSelect.replaceChildren(
      ...servers.map((s) => {
        const players = s.players !== null && s.maxPlayers !== null ? `, ${s.players}/${s.maxPlayers}` : '';
        const map = s.map ? `, ${s.map}` : '';
        const off = s.status === 'offline' ? ' — выключен' : '';
        return h('option', { attrs: { value: s.id, selected: s.id === pick }, text: `${s.name}${map}${players}${off}` });
      }),
    );
    if (preselect && !servers.some((s) => s.id === preselect)) serverHint.textContent = 'Сервер из ссылки не найден, выбран другой.';
  };

  const loadServers = async (): Promise<void> => {
    if (!support.online) return;
    try {
      servers = await fetchServers(controller.signal);
      serverHint.textContent = '';
      fillServers();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      serverSelect.replaceChildren(h('option', { attrs: { value: '' }, text: 'Список недоступен' }));
      serverSelect.disabled = true;
      serverHint.textContent = `${errorMessage(err)} Офлайн-режим работает без сервера.`;
    }
    refreshState();
  };

  /** Показ полей по режиму и доступность кнопки «Запустить». */
  const refreshState = (): void => {
    const mode = currentMode();
    mapField.hidden = mode !== 'offline';
    serverField.hidden = mode !== 'online';

    let reason = '';
    if (!validation?.ok) reason = gameFiles.size === 0 ? 'Сначала выберите файлы игры.' : 'Не хватает файлов игры — см. список выше.';
    else if (!sanitizeNickname(nick.value)) reason = 'Введите ник.';
    else if (mode === 'offline' && !mapSelect.value) reason = 'Выберите карту.';
    else if (mode === 'online') {
      const server = servers.find((s) => s.id === serverSelect.value);
      if (!server) reason = 'Выберите сервер.';
      else if (server.status === 'offline') reason = 'Этот сервер сейчас выключен.';
    }
    launchBtn.setAttribute('aria-disabled', String(reason !== ''));
    launchHint.textContent = reason;
  };

  const validateNick = (): boolean => {
    const clean = sanitizeNickname(nick.value);
    const message = clean ? '' : `Ник — от 1 до ${NICKNAME_MAX} символов. Кавычки, «;» и переносы строк убираются.`;
    nickError.hidden = message === '';
    nickError.textContent = message;
    nick.setAttribute('aria-invalid', String(message !== ''));
    return message === '';
  };

  form.addEventListener('input', () => {
    refreshState();
    saveSettings(readForm());
  });
  form.addEventListener('change', () => {
    refreshState();
    saveSettings(readForm());
  });
  nick.addEventListener('blur', () => {
    validateNick();
    const clean = sanitizeNickname(nick.value);
    if (clean) nick.value = clean;
  });

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    refreshState();
    if (!validateNick()) {
      nick.focus();
      return;
    }
    if (launchBtn.getAttribute('aria-disabled') === 'true') {
      launchHint.classList.add('attention');
      setTimeout(() => launchHint.classList.remove('attention'), 600);
      return;
    }
    const s = readForm();
    saveSettings(s);
    const server = s.mode === 'online' ? (servers.find((x) => x.id === s.serverId) ?? null) : null;
    const totalBytes = gameFiles.totalBytes();
    setLaunchPlan({ settings: s, files: gameFiles.take(), totalBytes, server });
    navigate('#/game');
  });

  const loader = createLoader();
  loader.onChange = (v) => {
    validation = v;
    fillMaps(v.ok ? v.maps : []);
    refreshState();
  };

  fillMaps([]);
  renderShell(root, route.name, [
    h('h1', { class: 'page-title', text: 'Играть' }),
    h('div', { class: 'play-layout' }, loader.el, form),
  ]);
  refreshState();
  void loadServers();

  return () => controller.abort();
}
