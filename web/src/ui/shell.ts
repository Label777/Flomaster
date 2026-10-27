/** Общий каркас страниц: шапка, основная область, подвал с обязательной юридической строкой. */
import { h, svg, type Child } from './dom';

export const LEGAL_FOOTER = 'Не связан с Valve. Counter-Strike — товарный знак Valve Corporation.';

/** Оригинальный знак сайта: перекрестье в дальномерном кольце. */
export const MARK_SVG = `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false" class="mark">
  <circle cx="16" cy="16" r="11.5" fill="none" stroke="currentColor" stroke-width="2"/>
  <path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="currentColor" stroke-width="2" stroke-linecap="square"/>
  <rect x="14.5" y="14.5" width="3" height="3" fill="var(--accent)"/>
</svg>`;

const NAV: readonly { href: string; label: string; route: string }[] = [
  { href: '#/play', label: 'Играть', route: 'play' },
  { href: '#/servers', label: 'Серверы', route: 'servers' },
  { href: '#/guide', label: 'Подготовка файлов', route: 'guide' },
];

export function renderShell(root: HTMLElement, route: string, content: Child[]): HTMLElement {
  const main = h('main', { class: 'page', attrs: { id: 'main', tabindex: -1 } }, ...content);
  const header = h(
    'header',
    { class: 'site-header' },
    h('a', { class: 'skip-link', attrs: { href: '#main' }, text: 'К содержимому', on: { click: skipToMain } }),
    h('a', { class: 'brand', attrs: { href: '#/', 'aria-label': 'На главную' } }, svg(MARK_SVG), h('span', { text: 'CS 1.6 в браузере' })),
    h(
      'nav',
      { class: 'site-nav', attrs: { 'aria-label': 'Разделы' } },
      ...NAV.map((item) =>
        h('a', {
          attrs: { href: item.href, 'aria-current': item.route === route ? 'page' : null },
          text: item.label,
        }),
      ),
    ),
  );
  const footer = h(
    'footer',
    { class: 'site-footer' },
    h('p', { class: 'legal', text: LEGAL_FOOTER }),
    h('p', null, h('a', { attrs: { href: '#/licenses' }, text: 'Лицензии' })),
  );
  root.replaceChildren(header, main, footer);
  return main;
}

/** Ссылка-пропуск не должна менять hash (он у нас — маршрут). */
function skipToMain(ev: MouseEvent): void {
  ev.preventDefault();
  document.getElementById('main')?.focus();
}

/** Только подвал — для полноэкранной игры. */
export function legalFooter(cls = 'legal'): HTMLElement {
  return h('p', { class: cls, text: LEGAL_FOOTER });
}
