/**
 * #/wc3 — как подготовить файлы для Warcraft III (движок Warsmash).
 * Сам движок лежит в public/games/wc3/ (собирается scripts/build-wc3.sh) и открывается в плеере #/g/wc3/play.
 */
import { h, type Child } from '../ui/dom';
import { renderShell } from '../ui/shell';
import type { Route } from '../router';
import { assetUrl } from '../net/endpoints';

const code = (text: string): HTMLElement => h('code', { text });

function step(title: string, ...body: Child[]): HTMLElement {
  return h('li', { class: 'step' }, h('h3', { text: title }), ...body);
}

/** Точный коммит Warsmash — тот же, что в scripts/build-wc3.sh (AGPL-3.0: ссылка на исходники). */
const WARSMASH_SOURCE = 'https://github.com/ErikSom/WarsmashModEngine/tree/d69e772b4dede6fd3569f9949a3180cdfea4635b';

export function renderWc3Guide(root: HTMLElement, route: Route): void {
  renderShell(root, route.name, [
    h(
      'article',
      { class: 'prose guide' },
      h('h1', { text: 'Warcraft III: как подготовить файлы игры' }),
      h(
        'p',
        { class: 'lead' },
        'Игру запускает открытый движок Warsmash. Ему нужны архивы вашей копии Warcraft III: The Frozen Throne — файлы ',
        code('.mpq'),
        ' из папки игры. Сайт их не хранит и не раздаёт: браузер читает их с вашего диска и кладёт в своё хранилище на этом компьютере.',
      ),

      h('h2', { text: 'Какая версия подойдёт' }),
      h(
        'ul',
        null,
        h('li', null, h('strong', { text: 'Классическая The Frozen Throne, патч 1.22–1.28' }), ' — основной вариант (лучше всего 1.26a или 1.27).'),
        h('li', { text: 'Патчи 1.29–1.32 — с оговорками: движок их понимает, но меньше проверен на них.' }),
        h(
          'li',
          null,
          h('strong', { text: 'Не подойдут: Warcraft III: Reforged и версии 1.33 и новее' }),
          ' — в том числе нынешняя установка из Battle.net. В них другой формат моделей, движок его не читает.',
        ),
      ),

      h('h2', { text: 'Какие файлы нужны' }),
      h('p', null, 'В папке классической установки лежат архивы игры:'),
      h('pre', { class: 'tree', text: 'Warcraft III/\n├── War3.mpq        — Reign of Chaos\n├── War3x.mpq       — The Frozen Throne\n├── War3xLocal.mpq  — тексты и озвучка дополнения\n├── War3Patch.mpq   — патч\n├── War3Local.mpq   — есть в локализованных версиях\n└── Maps/           — карты (.w3x, .w3m)' }),
      h(
        'p',
        null,
        'Обычно папка находится в ',
        code('C:\\Program Files (x86)\\Warcraft III'),
        ' или ',
        code('C:\\Program Files\\Warcraft III'),
        ' (Windows), ',
        code('/Applications/Warcraft III'),
        ' (macOS). Если игра стоит в другом месте — выберите ту папку, где лежит ',
        code('War3.mpq'),
        '.',
      ),

      h('h2', { text: 'Как запустить' }),
      h(
        'ol',
        { class: 'steps' },
        step(
          'Откройте игру',
          h('p', null, 'Кнопка «Играть» на странице игры откроет движок. Его меню пока на английском.'),
        ),
        step(
          'Выберите папку игры',
          h('p', null, h('strong', { text: 'Manage assets → Select Warcraft III folder' }), ' → укажите папку Warcraft III. Браузер может спросить, разрешить ли сайту «загрузить» файлы, — это стандартный текст: файлы остаются на вашем компьютере.'),
          h('p', { text: 'Первый раз архивы копируются в хранилище браузера, это занимает от минуты до нескольких. В следующие разы ничего выбирать не нужно.' }),
        ),
        step(
          'Играйте',
          h('p', null, h('strong', { text: 'Play' }), ' — меню игры, «Custom Game» — карты из папки ', code('Maps'), '.'),
          h(
            'p',
            null,
            h('strong', { text: 'Multiplayer' }),
            ' — сетевая игра: укажите имя, создайте лобби (Host) и отправьте другу код, либо войдите по коду (Join by code). Игра идёт напрямую между браузерами.',
          ),
        ),
      ),

      h('h2', { text: 'Свои карты' }),
      h(
        'p',
        null,
        'Положите ',
        code('.w3x'),
        ' / ',
        code('.w3m'),
        ' в папку ',
        code('Maps'),
        ' своей копии игры до выбора папки — или добавьте их потом через ',
        h('strong', { text: 'Manage assets → Maps' }),
        '. В сетевой игре карта должна быть у каждого игрока: сайт карты не раздаёт.',
      ),

      h('h2', { text: 'Что пока не работает' }),
      h(
        'ul',
        null,
        h('li', null, h('strong', { text: 'DotA Allstars. ' }), 'Движку не хватает механик, на которых построена карта: покупки героя в таверне, команд режима в чате, большинства способностей героев, воскрешения. Карта загрузится, но играть в неё нельзя.'),
        h('li', null, h('strong', { text: 'Компьютерные противники. ' }), 'В браузерной версии движка ИИ отключён — офлайн карта будет пустой, играйте с друзьями по сети.'),
        h('li', { text: 'Сложные пользовательские карты могут вести себя не так, как в оригинальной игре: Warsmash — реимплементация, а не сама игра.' }),
      ),

      h('h2', { text: 'Место на диске' }),
      h(
        'p',
        { text: 'Архивы игры хранятся в частном хранилище браузера (OPFS) для этого сайта — примерно столько же места, сколько занимают .mpq в вашей папке (обычно 1–2 ГБ). Удалить их можно, очистив данные сайта в браузере: в Chrome — значок слева от адреса → «Настройки сайтов» → «Удалить данные». Это заодно сбросит сохранённые настройки других игр сайта.' },
      ),

      h('h2', { text: 'Браузеры' }),
      h(
        'ul',
        null,
        h('li', { text: 'Chrome и Edge (последние версии) — основной вариант.' }),
        h('li', { text: 'Firefox и Safari 17+ — должны работать, но мы их ещё не проверили.' }),
        h('li', { text: 'Нужен компьютер с клавиатурой и мышью и видеокарта с WebGL. Телефоны и планшеты не поддерживаются.' }),
      ),

      h('h2', { text: 'Лицензия движка' }),
      h(
        'p',
        null,
        'Warsmash распространяется по GNU AGPL-3.0. Исходники точной версии — ',
        h('a', { attrs: { href: WARSMASH_SOURCE, target: '_blank', rel: 'noopener noreferrer' }, text: 'на GitHub' }),
        ', наши изменения — в каталоге ',
        code('vendor-patches/wc3'),
        ' репозитория сайта, подробности сборки — в ',
        h('a', { attrs: { href: assetUrl('games/wc3/BUILD-INFO.txt'), target: '_blank', rel: 'noopener' }, text: 'BUILD-INFO.txt' }),
        '.',
      ),
      h('p', { class: 'legal', text: 'Не связан с Blizzard Entertainment. Warcraft — товарный знак Blizzard Entertainment, Inc. DotA Allstars — пользовательская карта, права у её авторов. Файлы игры и карты сайт не хранит и не раздаёт.' }),
      h('p', null, h('a', { class: 'btn btn-primary', attrs: { href: '#/g/wc3/play' }, text: 'Играть' })),
    ),
  ]);
}
