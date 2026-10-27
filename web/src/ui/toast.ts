/** Короткие всплывающие уведомления внизу экрана. */
import { h } from './dom';

let region: HTMLElement | null = null;

export function toast(text: string, ms = 2600): void {
  if (!region || !region.isConnected) {
    region = h('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.append(region);
  }
  const item = h('div', { class: 'toast', text });
  region.append(item);
  setTimeout(() => {
    item.classList.add('is-leaving');
    setTimeout(() => item.remove(), 250);
  }, ms);
}

/** Поделиться ссылкой: системное меню, а без него — копирование в буфер. */
export async function shareLink(title: string, url = location.href): Promise<void> {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title, url });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Ссылка скопирована');
  } catch {
    toast('Не удалось скопировать ссылку');
  }
}
