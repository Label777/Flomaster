import { h } from '../ui/dom';
import { renderShell } from '../ui/shell';
import type { Route } from '../router';

export function renderNotFound(root: HTMLElement, route: Route): void {
  renderShell(root, route.name, [
    h(
      'section',
      { class: 'prose' },
      h('h1', { text: 'Такой страницы нет' }),
      h('p', null, 'Проверьте адрес или вернитесь ', h('a', { attrs: { href: '#/' }, text: 'на главную' }), '.'),
    ),
  ]);
}
