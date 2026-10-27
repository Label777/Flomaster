import { h } from '../ui/dom';
import { renderShell } from '../ui/shell';
import { detectSupport } from '../ui/support';
import type { Route } from '../router';

export function renderUnsupported(root: HTMLElement, route: Route): void {
  const s = detectSupport();
  const reasons: string[] = [];
  if (s.mobile) reasons.push('Похоже, это телефон или планшет. Игре нужны клавиатура и мышь.');
  if (!s.wasm) reasons.push('Браузер не поддерживает WebAssembly.');
  if (!s.webgl2) reasons.push('Браузер не дал доступ к WebGL 2 — возможно, отключено аппаратное ускорение.');

  renderShell(root, route.name, [
    h(
      'section',
      { class: 'prose stub' },
      h('h1', { text: 'Нужен компьютер' }),
      h('p', { class: 'lead', text: 'Игра запускается в браузере на компьютере с клавиатурой и мышью.' }),
      h('ul', { class: 'reasons' }, ...reasons.map((r) => h('li', { text: r }))),
      h('h2', { text: 'Подойдут' }),
      h(
        'ul',
        null,
        h('li', { text: 'Chrome или Edge последних версий — удобнее всего, можно выбрать папку игры целиком;' }),
        h('li', { text: 'Firefox последних версий;' }),
        h('li', { text: 'Safari 15 и новее.' }),
      ),
      h('p', { text: 'Для онлайн-игры браузер должен поддерживать WebRTC. Включите аппаратное ускорение, если оно выключено.' }),
      h(
        'p',
        { class: 'stub-links' },
        h('a', { class: 'btn', attrs: { href: '#/guide' }, text: 'Как подготовить файлы игры' }),
        h('a', { class: 'btn', attrs: { href: '#/servers' }, text: 'Список серверов' }),
      ),
    ),
  ]);
}
