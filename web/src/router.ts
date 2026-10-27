/** Hash-роутинг: «#/play?server=main» → { name: 'play', params: { server: 'main' } }. */

export interface Route {
  name: string;
  /** Части пути после имени: «#/g/cs16/play» → name 'g', segments ['cs16', 'play']. */
  segments: string[];
  params: URLSearchParams;
}

export function parseHash(hash = location.hash): Route {
  const raw = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = raw.split('?', 2);
  const parts = path
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
  const [name = '', ...segments] = parts;
  return { name: name || 'home', segments, params: new URLSearchParams(query) };
}

export function navigate(hash: string): void {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

/** Функция, которую страница возвращает для снятия таймеров и обработчиков. */
export type Cleanup = () => void;

export type PageRender = (root: HTMLElement, route: Route) => Cleanup | void;
