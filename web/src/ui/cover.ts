/** Обложка игры: картинка из public/ или градиент с оригинальным знаком из каталога. */
import { h, svg } from './dom';
import type { GameEntry } from '../catalog/games';
import { assetUrl } from '../net/endpoints';

export function cover(game: GameEntry, cls = 'cover'): HTMLElement {
  const box = h('div', { class: cls, attrs: { 'aria-hidden': 'true' } });
  box.style.setProperty('--cover-from', game.cover.from);
  box.style.setProperty('--cover-to', game.cover.to);
  if (game.cover.image) {
    box.append(h('img', { attrs: { src: assetUrl(game.cover.image), alt: '', loading: 'lazy', decoding: 'async' } }));
  } else {
    // glyph — статичная разметка из исходников каталога, не пользовательские данные
    box.append(h('div', { class: 'cover-glyph' }, svg(game.cover.glyph)));
  }
  return box;
}
