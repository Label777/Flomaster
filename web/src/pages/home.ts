/** Главная — каталог игр: поиск, фильтр по жанрам, сетка карточек. */
import { h } from '../ui/dom';
import { renderShell } from '../ui/shell';
import { cover } from '../ui/cover';
import { GAMES, allGenres, type GameEntry } from '../catalog/games';
import type { Route } from '../router';

const ALL = '';

export function renderHome(root: HTMLElement, route: Route): void {
  let query = '';
  let genre = route.params.get('genre') ?? ALL;

  const search = h('input', {
    class: 'catalog-search',
    attrs: { type: 'search', placeholder: 'Найти игру', 'aria-label': 'Поиск по каталогу', autocomplete: 'off' },
    on: {
      input: () => {
        query = search.value.trim().toLowerCase();
        update();
      },
    },
  });

  const chips = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': 'Жанры' } });
  const chipButtons = [ALL, ...allGenres()].map((g) =>
    h('button', {
      class: 'chip',
      attrs: { type: 'button', 'aria-pressed': g === genre ? 'true' : 'false' },
      text: g || 'Все',
      on: {
        click: () => {
          genre = g;
          for (const b of chipButtons) b.setAttribute('aria-pressed', b === chipButtonFor(g) ? 'true' : 'false');
          update();
        },
      },
    }),
  );
  const chipButtonFor = (g: string): HTMLButtonElement | undefined => chipButtons[[ALL, ...allGenres()].indexOf(g)];
  chips.append(...chipButtons);

  const grid = h('ul', { class: 'game-grid', attrs: { 'aria-live': 'polite' } });
  const count = h('p', { class: 'catalog-count muted' });

  function matches(game: GameEntry): boolean {
    if (genre && !game.genres.includes(genre)) return false;
    if (!query) return true;
    const hay = [game.title, game.tagline, ...game.genres].join(' ').toLowerCase();
    return hay.includes(query);
  }

  function update(): void {
    const list = GAMES.filter(matches);
    grid.replaceChildren(...list.map((g) => h('li', null, card(g))));
    count.textContent = list.length === 0 ? 'Ничего не найдено. Попробуйте другой запрос или жанр.' : `Игр: ${list.length}`;
  }

  renderShell(root, route.name, [
    h(
      'section',
      { class: 'catalog-hero' },
      h('h1', { text: 'Игры прямо в браузере' }),
      h(
        'p',
        { class: 'hero-lead' },
        'Без установки и без загрузки игр с сайта: HTML5-игры запускаются сразу, а для классики вроде Counter-Strike 1.6 браузер использует файлы вашей собственной копии.',
      ),
      h('div', { class: 'catalog-tools' }, search, chips),
    ),
    count,
    grid,
  ]);
  update();
}

function card(game: GameEntry): HTMLElement {
  const soon = game.status === 'soon';
  return h(
    'a',
    { class: `game-card${soon ? ' is-soon' : ''}`, attrs: { href: `#/g/${encodeURIComponent(game.id)}` } },
    cover(game),
    h(
      'div',
      { class: 'game-card-body' },
      h('h2', { class: 'game-card-title', text: game.title }),
      h('p', { class: 'game-card-tagline', text: game.tagline }),
      h(
        'ul',
        { class: 'tags', attrs: { 'aria-label': 'Метки' } },
        ...(soon ? [h('li', { class: 'tag tag-soon', text: 'Скоро' })] : []),
        ...game.badges.map((b) => h('li', { class: 'tag tag-badge', text: b })),
        ...game.genres.map((g) => h('li', { class: 'tag', text: g })),
      ),
    ),
  );
}
