/** Главная — каталог: поиск («/»), жанры, избранное, сортировка, случайная игра, «Недавние». */
import { h } from '../ui/dom';
import { renderShell } from '../ui/shell';
import { gameCard } from '../ui/game-card';
import { favorites, recent, clearRecent } from '../ui/prefs';
import { GAMES, allGenres, findGame, type GameEntry } from '../catalog/games';
import { navigate, type Route } from '../router';

const ALL = '';
const FAV = '\u0000fav';
type Sort = 'default' | 'title' | 'recent';

export function renderHome(root: HTMLElement, route: Route): () => void {
  let query = '';
  let genre = route.params.get('genre') ?? ALL;
  let sort: Sort = 'default';

  const search = h('input', {
    class: 'catalog-search',
    attrs: { type: 'search', placeholder: 'Найти игру', 'aria-label': 'Поиск по каталогу', autocomplete: 'off', enterkeyhint: 'search' },
    on: {
      input: () => {
        query = search.value.trim().toLowerCase();
        update();
      },
      keydown: (ev) => {
        if (ev.key === 'Escape' && search.value) {
          search.value = '';
          query = '';
          update();
        }
      },
    },
  });
  const searchWrap = h('label', { class: 'search-wrap' }, search, h('kbd', { class: 'search-kbd', attrs: { 'aria-hidden': 'true' }, text: '/' }));

  const chipValues = [ALL, FAV, ...allGenres()];
  const chipLabel = (v: string): string => (v === ALL ? 'Все' : v === FAV ? '★ Избранное' : v);
  const chipButtons = chipValues.map((v) =>
    h('button', {
      class: `chip${v === FAV ? ' chip-fav' : ''}`,
      attrs: { type: 'button', 'aria-pressed': v === genre ? 'true' : 'false' },
      text: chipLabel(v),
      on: {
        click: () => {
          genre = v;
          chipButtons.forEach((b, i) => b.setAttribute('aria-pressed', chipValues[i] === v ? 'true' : 'false'));
          update();
        },
      },
    }),
  );
  const chips = h('div', { class: 'chips', attrs: { role: 'group', 'aria-label': 'Фильтр' } }, ...chipButtons);

  const sortSelect = h(
    'select',
    {
      class: 'sort-select',
      attrs: { 'aria-label': 'Сортировка' },
      on: {
        change: () => {
          sort = sortSelect.value as Sort;
          update();
        },
      },
    },
    h('option', { attrs: { value: 'default' }, text: 'Сначала рекомендуемые' }),
    h('option', { attrs: { value: 'title' }, text: 'По названию' }),
    h('option', { attrs: { value: 'recent' }, text: 'Недавние сверху' }),
  );

  const randomBtn = h('button', {
    class: 'btn btn-small dice-btn',
    attrs: { type: 'button', title: 'Открыть случайную игру' },
    text: '🎲 Случайная игра',
    on: {
      click: () => {
        const pool = GAMES.filter((g) => g.status === 'ready');
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) navigate(`#/g/${encodeURIComponent(pick.id)}`);
      },
    },
  });

  const recentSection = h('section', { class: 'recent', attrs: { 'aria-label': 'Недавние' } });
  const grid = h('ul', { class: 'game-grid' });
  const count = h('p', { class: 'catalog-count muted', attrs: { 'aria-live': 'polite' } });

  function matches(game: GameEntry, favs: Set<string>): boolean {
    if (genre === FAV && !favs.has(game.id)) return false;
    if (genre && genre !== FAV && !game.genres.includes(genre)) return false;
    if (!query) return true;
    return [game.title, game.tagline, ...game.genres].join(' ').toLowerCase().includes(query);
  }

  function sorted(list: GameEntry[]): GameEntry[] {
    if (sort === 'title') return [...list].sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    if (sort === 'recent') {
      const order = recent();
      const rank = (g: GameEntry): number => {
        const i = order.indexOf(g.id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      return [...list].sort((a, b) => rank(a) - rank(b));
    }
    return list;
  }

  function renderRecent(): void {
    const items = recent()
      .map((id) => findGame(id))
      .filter((g): g is GameEntry => g !== undefined);
    recentSection.hidden = items.length === 0 || query !== '' || genre !== ALL;
    recentSection.replaceChildren(
      h(
        'div',
        { class: 'recent-head' },
        h('h2', { text: 'Продолжить' }),
        h('button', {
          class: 'btn-link',
          attrs: { type: 'button' },
          text: 'Очистить',
          on: {
            click: () => {
              clearRecent();
              update();
            },
          },
        }),
      ),
      h(
        'ul',
        { class: 'recent-list' },
        ...items.map((g) =>
          h(
            'li',
            null,
            h('a', { class: 'recent-item', attrs: { href: `#/g/${encodeURIComponent(g.id)}` } }, h('span', { class: 'recent-dot' }), g.title),
          ),
        ),
      ),
    );
  }

  function update(): void {
    const favs = favorites();
    const list = sorted(GAMES.filter((g) => matches(g, favs)));
    grid.replaceChildren(...list.map((g, i) => h('li', null, gameCard(g, i, genre === FAV ? update : undefined))));
    if (list.length > 0) count.textContent = `Игр: ${list.length}`;
    else if (genre === FAV) count.textContent = 'В избранном пока пусто — нажмите ☆ на карточке игры.';
    else count.textContent = 'Ничего не найдено. Попробуйте другой запрос или жанр.';
    renderRecent();
  }

  // «/» — к поиску (если не печатаем в другом поле)
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target as HTMLElement | null;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    ev.preventDefault();
    search.focus();
    search.select();
  };
  document.addEventListener('keydown', onKey);

  renderShell(root, route.name, [
    h(
      'section',
      { class: 'catalog-hero' },
      h('div', { class: 'hero-glow', attrs: { 'aria-hidden': 'true' } }),
      h('h1', { text: 'Игры прямо в браузере' }),
      h(
        'p',
        { class: 'hero-lead' },
        'Без установки и без загрузки игр с сайта: HTML5-игры запускаются сразу, а для классики вроде Counter-Strike 1.6 браузер использует файлы вашей собственной копии.',
      ),
      h('div', { class: 'catalog-tools' }, searchWrap, chips),
    ),
    recentSection,
    h('div', { class: 'catalog-bar' }, count, h('div', { class: 'catalog-bar-actions' }, randomBtn, sortSelect)),
    grid,
  ]);
  update();
  return () => document.removeEventListener('keydown', onKey);
}
