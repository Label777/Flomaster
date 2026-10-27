/** Карточка игры в каталоге: обложка, метки, звёздочка «в избранное», наклон за курсором. */
import { h } from './dom';
import { cover } from './cover';
import { isFavorite, toggleFavorite } from './prefs';
import { toast } from './toast';
import type { GameEntry } from '../catalog/games';

const canTilt = (): boolean =>
  matchMedia('(hover: hover) and (pointer: fine)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches;

export function gameCard(game: GameEntry, index: number, onFavoriteChange?: () => void): HTMLElement {
  const soon = game.status === 'soon';
  const href = `#/g/${encodeURIComponent(game.id)}`;

  const star = h('button', {
    class: 'fav-btn',
    attrs: { type: 'button' },
    on: {
      click: (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const on = toggleFavorite(game.id);
        paintStar(star, on, game.title);
        star.classList.remove('pop');
        void star.offsetWidth; // перезапуск анимации
        star.classList.add('pop');
        toast(on ? `«${game.title}» в избранном` : `«${game.title}» убрана из избранного`);
        onFavoriteChange?.();
      },
    },
  });
  paintStar(star, isFavorite(game.id), game.title);

  const card = h(
    'article',
    { class: `game-card${soon ? ' is-soon' : ''}` },
    cover(game),
    star,
    h(
      'div',
      { class: 'game-card-body' },
      // Ссылка растянута на всю карточку (::after), звёздочка лежит поверх неё.
      h('h2', { class: 'game-card-title' }, h('a', { class: 'stretched', attrs: { href }, text: game.title })),
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
  card.style.setProperty('--i', String(Math.min(index, 12)));

  if (canTilt()) {
    card.addEventListener('pointermove', (ev) => {
      const r = card.getBoundingClientRect();
      const x = (ev.clientX - r.left) / r.width - 0.5;
      const y = (ev.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--ry', `${(x * 8).toFixed(2)}deg`);
      card.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
      card.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(1)}%`);
      card.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(1)}%`);
    });
    card.addEventListener('pointerleave', () => {
      card.style.removeProperty('--rx');
      card.style.removeProperty('--ry');
    });
  }
  return card;
}

function paintStar(btn: HTMLButtonElement, on: boolean, title: string): void {
  btn.textContent = on ? '★' : '☆';
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.setAttribute('aria-label', on ? `Убрать «${title}» из избранного` : `Добавить «${title}» в избранное`);
  btn.title = on ? 'В избранном' : 'В избранное';
}
