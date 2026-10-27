import { h, svg } from '../ui/dom';
import { renderShell } from '../ui/shell';
import type { Route } from '../router';

const HERO_MARK = `<svg viewBox="0 0 200 200" class="hero-mark" aria-hidden="true" focusable="false">
  <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/>
  <circle cx="100" cy="100" r="64" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".6"/>
  <circle cx="100" cy="100" r="34" fill="none" stroke="currentColor" stroke-width="2"/>
  <g class="spread" stroke="var(--text)" stroke-width="3" stroke-linecap="square">
    <path d="M100 18v52"/><path d="M100 130v52"/><path d="M18 100h52"/><path d="M130 100h52"/>
  </g>
  <g stroke="currentColor" stroke-width="1" opacity=".5">
    <path d="M100 8v6M100 186v6M8 100h6M186 100h6"/>
    <path d="M35 35l4 4M161 161l4 4M165 35l-4 4M39 161l-4 4"/>
  </g>
  <rect x="96" y="96" width="8" height="8" fill="var(--accent)"/>
</svg>`;

export function renderHome(root: HTMLElement, route: Route): void {
  renderShell(root, route.name, [
    h(
      'section',
      { class: 'hero' },
      h(
        'div',
        { class: 'hero-text' },
        h('h1', { class: 'hero-title', text: 'Counter\u2011Strike 1.6 прямо в браузере' }),
        h(
          'p',
          { class: 'hero-lead' },
          'Офлайн на любой своей карте или онлайн на нашем сервере. Нужна только своя копия игры из Steam.',
        ),
        h(
          'div',
          { class: 'hero-actions' },
          h('a', { class: 'btn btn-primary btn-xl', attrs: { href: '#/play' }, text: 'Играть' }),
          h('a', { class: 'btn btn-xl', attrs: { href: '#/servers' }, text: 'Серверы' }),
          h('a', { class: 'btn btn-xl', attrs: { href: '#/guide' }, text: 'Как подготовить файлы игры' }),
        ),
        h(
          'p',
          { class: 'hero-privacy' },
          'Файлы игры остаются на вашем компьютере: браузер читает их сам и никуда не отправляет.',
        ),
      ),
      svg(HERO_MARK),
    ),
    h(
      'section',
      { class: 'facts', attrs: { 'aria-label': 'Как это устроено' } },
      fact('Свои файлы', 'Вы выбираете папку Half-Life из Steam или .zip с папками valve и cstrike. На сайте файлов игры нет.'),
      fact('Офлайн', 'Карта запускается прямо во вкладке — без сервера и без интернета после загрузки страницы.'),
      fact('Онлайн', 'Подключение к нашему серверу через WebRTC. Нужен компьютер с клавиатурой и мышью.'),
    ),
  ]);
}

function fact(title: string, text: string): HTMLElement {
  return h('div', { class: 'fact' }, h('h2', { text: title }), h('p', { text }));
}
