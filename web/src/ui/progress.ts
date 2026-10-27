import { h } from './dom';

export interface ProgressBar {
  el: HTMLElement;
  /** fraction — 0..1 или null (неопределённый). */
  set(fraction: number | null, text: string): void;
  hide(): void;
}

export function progressBar(label: string): ProgressBar {
  const bar = h('div', { class: 'progress-fill' });
  const track = h(
    'div',
    { class: 'progress-track', attrs: { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 } },
    bar,
  );
  const caption = h('p', { class: 'progress-text', attrs: { 'aria-live': 'polite' } });
  const el = h('div', { class: 'progress', attrs: { hidden: true } }, track, caption);
  return {
    el,
    set(fraction, text) {
      el.hidden = false;
      if (fraction === null) {
        track.classList.add('indeterminate');
        track.removeAttribute('aria-valuenow');
        bar.style.width = '';
      } else {
        const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
        track.classList.remove('indeterminate');
        track.setAttribute('aria-valuenow', String(pct));
        bar.style.width = `${pct}%`;
      }
      caption.textContent = text;
    },
    hide() {
      el.hidden = true;
    },
  };
}
