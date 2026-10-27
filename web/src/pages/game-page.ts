/**
 * #/g/<id>       — страница игры из каталога;
 * #/g/<id>/play  — встроенный плеер для HTML5-игр (launch.kind === 'iframe').
 */
import { h } from '../ui/dom';
import { renderShell } from '../ui/shell';
import { cover } from '../ui/cover';
import { detectSupport } from '../ui/support';
import { findGame, playHref, type GameEntry } from '../catalog/games';
import { assetUrl } from '../net/endpoints';
import { renderNotFound } from './notfound';
import { navigate, type Route } from '../router';
import { isFavorite, markPlayed, toggleFavorite } from '../ui/prefs';
import { shareLink, toast } from '../ui/toast';
import { exitFullscreen, toggleFullscreen } from '../ui/fullscreen';

export function renderCatalogGame(root: HTMLElement, route: Route): (() => void) | void {
  const [id = '', sub] = route.segments;
  const game = findGame(id);
  if (!game) return renderNotFound(root, route);
  if (sub === 'play') return renderPlayer(root, game);
  renderDetails(root, route, game);
}

/** Заголовок вкладки для #/g/... */
export function catalogGameTitle(route: Route): string | undefined {
  return findGame(route.segments[0] ?? '')?.title;
}

function renderDetails(root: HTMLElement, route: Route, game: GameEntry): void {
  const ready = game.status === 'ready';
  const external = game.launch.kind === 'external';
  const mobileBlocked = game.platform === 'desktop' && detectSupport().mobile;

  const play = ready
    ? h('a', {
        class: 'btn btn-primary btn-xl',
        attrs: {
          href: playHref(game),
          target: external ? '_blank' : null,
          rel: external ? 'noopener noreferrer' : null,
        },
        text: external ? 'Играть ↗' : 'Играть',
        on: { click: () => markPlayed(game.id) },
      })
    : h('span', { class: 'btn btn-xl', attrs: { 'aria-disabled': 'true' }, text: 'Скоро' });

  const favBtn = h('button', {
    class: 'btn btn-small',
    attrs: { type: 'button' },
    on: {
      click: () => {
        const on = toggleFavorite(game.id);
        paintFav(on);
        toast(on ? 'Добавлено в избранное' : 'Убрано из избранного');
      },
    },
  });
  const paintFav = (on: boolean): void => {
    favBtn.textContent = on ? '★ В избранном' : '☆ В избранное';
    favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  paintFav(isFavorite(game.id));
  const shareBtn = h('button', {
    class: 'btn btn-small',
    attrs: { type: 'button' },
    text: '🔗 Поделиться',
    on: { click: () => void shareLink(game.title) },
  });

  const meta = h(
    'dl',
    { class: 'game-meta' },
    h('dt', { text: 'Жанр' }),
    h('dd', { text: game.genres.join(', ') }),
    h('dt', { text: 'Игроков' }),
    h('dd', { text: game.players }),
    h('dt', { text: 'Устройство' }),
    h('dd', { text: game.platform === 'desktop' ? 'Компьютер с клавиатурой и мышью' : 'Компьютер, телефон, планшет' }),
  );

  renderShell(root, route.name, [
    h(
      'nav',
      { class: 'crumbs', attrs: { 'aria-label': 'Навигация' } },
      h('a', { attrs: { href: '#/' }, text: 'Каталог' }),
      h('span', { attrs: { 'aria-hidden': 'true' }, text: ' / ' }),
      h('span', { text: game.title }),
    ),
    h(
      'article',
      { class: 'game-page' },
      cover(game, 'cover cover-large'),
      h(
        'div',
        { class: 'game-page-body' },
        h('h1', { text: game.title }),
        h('p', { class: 'hero-lead', text: game.tagline }),
        h('div', { class: 'game-quick' }, favBtn, shareBtn),
        h(
          'div',
          { class: 'hero-actions' },
          play,
          ...(game.links ?? []).map((l) => h('a', { class: 'btn btn-xl', attrs: { href: l.href }, text: l.label })),
        ),
        mobileBlocked
          ? h('p', { class: 'alert alert-warn', text: 'Эта игра работает только на компьютере с клавиатурой и мышью.' })
          : null,
        meta,
        ...game.description.map((p) => h('p', { text: p })),
        game.legal ? h('p', { class: 'legal game-page-legal', text: game.legal }) : null,
      ),
    ),
  ]);
}

function renderPlayer(root: HTMLElement, game: GameEntry): (() => void) | void {
  if (game.launch.kind !== 'iframe' || game.status !== 'ready') {
    navigate(`#/g/${encodeURIComponent(game.id)}`);
    return;
  }
  const src = /^https?:\/\//i.test(game.launch.src) ? game.launch.src : assetUrl(game.launch.src);
  markPlayed(game.id);

  // Новый <iframe> вместо смены src: смена src добавляет записи в историю, и «Назад» застревает в плеере.
  const makeFrame = (): HTMLIFrameElement =>
    h('iframe', {
      class: 'player-frame',
      attrs: {
        src,
        title: game.title,
        allow: 'fullscreen; pointer-lock; gamepad; autoplay',
        allowfullscreen: true,
        // Сайт cross-origin isolated (COEP): чужой фрейм без своих заголовков грузится в режиме credentialless.
        credentialless: true,
        referrerpolicy: 'no-referrer',
      },
    });
  let frame = makeFrame();

  const bar = h(
    'div',
    { class: 'player-bar' },
    h('a', { class: 'btn btn-small', attrs: { href: `#/g/${encodeURIComponent(game.id)}` }, text: '← К игре' }),
    h('span', { class: 'player-title', text: game.title }),
    h('button', {
      class: 'btn btn-small',
      attrs: { type: 'button', title: 'Начать заново' },
      text: '↻ Заново',
      on: {
        click: () => {
          const next = makeFrame();
          frame.replaceWith(next);
          frame = next;
          frame.focus();
        },
      },
    }),
    h('button', { class: 'btn btn-small', attrs: { type: 'button' }, text: 'Во весь экран', on: { click: () => void toggleFullscreen(player) } }),
  );

  const player = h('div', { class: 'player' }, bar, frame);
  document.body.classList.add('is-player');
  root.replaceChildren(player);
  frame.focus();
  return () => {
    document.body.classList.remove('is-player');
    void exitFullscreen();
  };
}
