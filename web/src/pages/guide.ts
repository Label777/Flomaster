import { h, type Child } from '../ui/dom';
import { renderShell } from '../ui/shell';
import type { Route } from '../router';

const code = (text: string): HTMLElement => h('code', { text });

function step(title: string, ...body: Child[]): HTMLElement {
  return h('li', { class: 'step' }, h('h3', { text: title }), ...body);
}

export function renderGuide(root: HTMLElement, route: Route): void {
  renderShell(root, route.name, [
    h(
      'article',
      { class: 'prose guide' },
      h('h1', { text: 'Как подготовить файлы игры' }),
      h(
        'p',
        { class: 'lead' },
        'Для игры нужны две папки из вашей копии Counter-Strike 1.6 в Steam: ',
        code('valve'),
        ' и ',
        code('cstrike'),
        '. Обе лежат в папке Half-Life.',
      ),

      h('h2', { text: 'Где найти папку Half-Life' }),
      h('p', null, 'Быстрее всего через Steam: ', h('strong', { text: 'Библиотека → Counter-Strike → Управление → Просмотреть локальные файлы' }), '. Откроется нужная папка.'),
      h('p', { text: 'Обычные пути, если Steam установлен в папку по умолчанию:' }),
      h(
        'dl',
        { class: 'paths' },
        h('dt', { text: 'Windows' }),
        h('dd', null, code('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Half-Life')),
        h('dt', { text: 'macOS' }),
        h('dd', null, code('~/Library/Application Support/Steam/steamapps/common/Half-Life')),
        h('dt', { text: 'Linux' }),
        h('dd', null, code('~/.steam/steam/steamapps/common/Half-Life'), h('br'), 'или ', code('~/.local/share/Steam/steamapps/common/Half-Life')),
      ),
      h('p', { text: 'Если игра установлена в другую библиотеку Steam, путь начинается с той папки библиотеки, дальше — так же.' }),

      h('h2', { text: 'Что выбрать на странице «Играть»' }),
      h(
        'ol',
        { class: 'steps' },
        step('Папку Half-Life целиком', h('p', { text: 'Самый простой вариант. Сайт сам найдёт внутри valve и cstrike и пропустит всё лишнее.' })),
        step(
          'Или две папки по отдельности',
          h('p', null, 'Кнопками «Папка valve» и «Папка cstrike». Удобно, если папки лежат в разных местах или вы скопировали их отдельно.'),
        ),
        step('Или .zip-архив', h('p', null, 'Подходит для любого браузера. Как его сделать — ниже.')),
      ),
      h('p', null, 'В Firefox и Safari при выборе папки браузер может спросить, разрешить ли сайту «загрузить» файлы. Это стандартный текст браузера: файлы читаются внутри вкладки и никуда не отправляются.'),

      h('h2', { text: 'Как сделать .zip' }),
      h('p', null, 'В архиве ', code('valve'), ' и ', code('cstrike'), ' должны лежать в корне:'),
      h('pre', { class: 'tree', text: 'cs16.zip\n├── valve/\n│   ├── liblist.gam\n│   ├── halflife.wad\n│   └── …\n└── cstrike/\n    ├── liblist.gam\n    ├── maps/\n    └── …' }),
      h(
        'ul',
        null,
        h('li', null, h('strong', { text: 'Windows: ' }), 'выделите папки valve и cstrike, правый клик → «Отправить» → «Сжатая ZIP-папка».'),
        h('li', null, h('strong', { text: 'macOS: ' }), 'выделите обе папки, правый клик → «Сжать объекты».'),
        h('li', null, h('strong', { text: 'Linux: ' }), 'в папке Half-Life выполните ', code('zip -r ~/cs16.zip valve cstrike'), '.'),
      ),
      h('p', { text: 'Если обе папки оказались внутри ещё одной папки архива — ничего страшного, одна лишняя папка допускается.' }),
      h('p', { text: 'Чтобы архив был меньше, можно не класть в него valve/maps, valve/media и valve/SAVE — для CS они не нужны, сайт их всё равно пропускает.' }),

      h('h2', { text: 'Приватность' }),
      h(
        'p',
        null,
        'Файлы игры никогда не покидают ваш браузер. Сайт ничего не загружает на сервер, не хранит файлы ни в кэше, ни в базе браузера. ',
        'Они читаются в память вкладки и исчезают, когда вы её закрываете. В Chrome и Edge сайт может запомнить ',
        h('em', { text: 'разрешение' }),
        ' на чтение выбранной папки, чтобы в следующий раз не искать её заново, — сами файлы при этом не копируются.',
      ),
      h('p', { text: 'На сайте нет файлов игры Valve: каждый игрок использует свою купленную копию.' }),

      h('h2', { text: 'Браузеры' }),
      h(
        'ul',
        null,
        h('li', { text: 'Chrome и Edge (последние версии) — лучше всего: выбор папки целиком и запоминание папки.' }),
        h('li', { text: 'Firefox (последние версии) — выбор папки через стандартный диалог или .zip.' }),
        h('li', { text: 'Safari 15 и новее — выбор папки или .zip.' }),
      ),
      h('p', { text: 'Нужен компьютер с клавиатурой и мышью, 64-битный браузер и 2–4 ГБ свободной памяти. Телефоны и планшеты не поддерживаются.' }),
      h('p', null, h('a', { class: 'btn btn-primary', attrs: { href: '#/play' }, text: 'Перейти к выбору файлов' })),
    ),
  ]);
}
