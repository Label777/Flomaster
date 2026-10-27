/** Минимальный помощник для построения DOM без фреймворка. Текст всегда через textContent. */

export type Child = Node | string | number | null | undefined | false;

type Listeners = { [E in keyof HTMLElementEventMap]?: (ev: HTMLElementEventMap[E]) => void };

export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | null | undefined>;
  on?: Listeners;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.attrs) {
      for (const [name, value] of Object.entries(props.attrs)) {
        if (value === false || value === null || value === undefined) continue;
        el.setAttribute(name, value === true ? '' : String(value));
      }
    }
    if (props.on) {
      for (const [name, fn] of Object.entries(props.on)) {
        if (fn) el.addEventListener(name, fn as unknown as EventListener);
      }
    }
    if (props.text !== undefined) el.textContent = props.text;
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
}

/** Статичная SVG-разметка из исходников (никогда — из пользовательских данных). */
export function svg(markup: string): Element {
  const tpl = document.createElement('template');
  tpl.innerHTML = markup.trim();
  const node = tpl.content.firstElementChild;
  if (!node) throw new Error('svg(): пустая разметка');
  return node;
}

/** Ссылка внутри SPA. */
export function link(href: string, text: string, cls?: string): HTMLAnchorElement {
  return h('a', { class: cls, attrs: { href }, text });
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
