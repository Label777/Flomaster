import { h } from '../ui/dom';
import { renderShell } from '../ui/shell';
import type { Route } from '../router';
import { assetUrl } from '../net/endpoints';

const DOCS: readonly { url: string; title: string }[] = [
  { url: assetUrl('LICENSE.txt'), title: 'Лицензия сайта' },
  { url: assetUrl('THIRD_PARTY_NOTICES.txt'), title: 'Сторонние компоненты' },
];

export function renderLicenses(root: HTMLElement, route: Route): () => void {
  const controller = new AbortController();
  const sections = DOCS.map((doc) => {
    const pre = h('pre', { class: 'license-text', text: 'Загрузка…', attrs: { tabindex: 0 } });
    void fetch(doc.url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        pre.textContent = await res.text();
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        pre.textContent = `Файл ${doc.title} не найден в этой сборке.`;
      });
    return h('section', { class: 'license' }, h('h2', { text: doc.title }), pre);
  });

  renderShell(root, route.name, [
    h(
      'article',
      { class: 'prose wide' },
      h('h1', { text: 'Лицензии' }),
      h('p', { text: 'Сайт и его код распространяются под лицензией MIT. Движок Xash3D FWGS и клиент cs16-client — сторонние проекты со своими лицензиями, их тексты ниже.' }),
      h('p', { text: 'Файлы игры (valve, cstrike) принадлежат Valve Corporation, на сайте их нет — каждый игрок использует свою копию.' }),
      h(
        'p',
        null,
        'Warcraft III запускает движок Warsmash (GNU AGPL-3.0). Его исходники точной версии — ',
        h('a', { attrs: { href: 'https://github.com/ErikSom/WarsmashModEngine/tree/d69e772b4dede6fd3569f9949a3180cdfea4635b', target: '_blank', rel: 'noopener noreferrer' }, text: 'на GitHub' }),
        ', наши изменения — каталог vendor-patches/wc3 в репозитории сайта, текст лицензии — ',
        h('a', { attrs: { href: assetUrl('games/wc3/LICENSE-Warsmash.txt'), target: '_blank', rel: 'noopener' }, text: 'LICENSE-Warsmash.txt' }),
        ', состав сборки — ',
        h('a', { attrs: { href: assetUrl('games/wc3/BUILD-INFO.txt'), target: '_blank', rel: 'noopener' }, text: 'BUILD-INFO.txt' }),
        '. Файлы Warcraft III принадлежат Blizzard Entertainment, на сайте их нет.',
      ),
      ...sections,
    ),
  ]);
  return () => controller.abort();
}
