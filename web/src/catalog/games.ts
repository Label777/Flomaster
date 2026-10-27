/**
 * Каталог игр сайта. Чтобы добавить игру — добавьте объект в GAMES
 * (подробно: docs/ADDING_GAMES.md). Порядок в массиве = порядок на главной.
 */

/** Как запускается игра. */
export type Launch =
  /** Своя страница внутри сайта (например CS 1.6 с загрузчиком и лаунчером). */
  | { kind: 'route'; href: string }
  /**
   * HTML5-игра во встроенном фрейме на странице #/g/<id>/play.
   * src — путь внутри public/ (например 'games/reflex/index.html') или полный https-URL.
   * Чужой сайт должен разрешать встраивание (без X-Frame-Options: DENY).
   */
  | { kind: 'iframe'; src: string }
  /** Ссылка на внешний сайт (откроется в новой вкладке). */
  | { kind: 'external'; href: string };

export interface GameLink {
  label: string;
  href: string;
}

export interface GameEntry {
  /** Латиница, цифры и дефис: часть адреса #/g/<id>. */
  id: string;
  title: string;
  /** Одна строка под названием на карточке. */
  tagline: string;
  /** Абзацы описания на странице игры. */
  description: string[];
  genres: string[];
  /** Например «1», «1–32». */
  players: string;
  /** desktop — нужны клавиатура и мышь; any — работает и на телефоне. */
  platform: 'desktop' | 'any';
  /** Короткие метки на карточке: «Онлайн», «Свои файлы игры»… */
  badges: string[];
  /** ready — играбельна; soon — карточка видна, кнопка «Играть» неактивна. */
  status: 'ready' | 'soon';
  launch: Launch;
  /** Обложка: картинка из public/ (16:9) или сгенерированная из цветов и знака. */
  cover: { image?: string; from: string; to: string; glyph: string };
  /** Доп. ссылки на странице игры (серверы, инструкции…). */
  links?: GameLink[];
  /** Юридическая строка для страницы игры (товарные знаки, откуда файлы). */
  legal?: string;
}

/** Знак-перекрестье (оригинальный, тот же, что у сайта). */
const GLYPH_CROSSHAIR = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="22" fill="none" stroke="currentColor" stroke-width="3"/>
  <path d="M32 4v16M32 44v16M4 32h16M44 32h16" stroke="currentColor" stroke-width="3" stroke-linecap="square"/>
  <rect x="29" y="29" width="6" height="6" fill="currentColor"/>
</svg>`;

/** Знак мишени для демо-игры «Реакция». */
const GLYPH_TARGET = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="3"/>
  <circle cx="32" cy="32" r="16" fill="none" stroke="currentColor" stroke-width="3"/>
  <circle cx="32" cy="32" r="6" fill="currentColor"/>
</svg>`;

export const GAMES: readonly GameEntry[] = [
  {
    id: 'cs16',
    title: 'Counter-Strike 1.6',
    tagline: 'Классический командный шутер — офлайн и на нашем сервере',
    description: [
      'Движок Xash3D FWGS, собранный в WebAssembly, запускает CS 1.6 прямо во вкладке браузера.',
      'Нужна своя копия игры из Steam: вы выбираете папку Half-Life (или .zip с папками valve и cstrike), браузер читает файлы сам и никуда их не отправляет.',
      'Офлайн — любая карта из вашей папки. Онлайн — подключение к серверу сайта через WebRTC, если сервер подключён.',
    ],
    genres: ['Шутер', 'Мультиплеер', 'Классика'],
    players: '1–32',
    platform: 'desktop',
    badges: ['Свои файлы игры', 'Онлайн'],
    status: 'ready',
    launch: { kind: 'route', href: '#/play' },
    cover: { from: '#3b4a2c', to: '#14180f', glyph: GLYPH_CROSSHAIR },
    links: [
      { label: 'Серверы', href: '#/servers' },
      { label: 'Как подготовить файлы игры', href: '#/guide' },
    ],
    legal: 'Не связан с Valve. Counter-Strike — товарный знак Valve Corporation. Файлы игры сайт не хранит и не раздаёт.',
  },
  {
    id: 'reflex',
    title: 'Реакция',
    tagline: 'Тренажёр прицеливания: 30 секунд, как можно больше мишеней',
    description: [
      'Небольшая демо-игра, сделанная для этого сайта: мишени появляются в случайных местах и уменьшаются — успейте попасть.',
      'Лучший результат сохраняется в браузере. Работает мышью и пальцем.',
      'Заодно это пример того, как в каталог добавляется HTML5-игра: она лежит в web/public/games/reflex/.',
    ],
    genres: ['Аркада', 'Тренажёр'],
    players: '1',
    platform: 'any',
    badges: ['Без установки', 'Телефон и ПК'],
    status: 'ready',
    launch: { kind: 'iframe', src: 'games/reflex/index.html' },
    cover: { from: '#6b3a1f', to: '#1c120c', glyph: GLYPH_TARGET },
  },
];

export function findGame(id: string): GameEntry | undefined {
  return GAMES.find((g) => g.id === id);
}

/** Все жанры каталога в порядке первого появления. */
export function allGenres(): string[] {
  const seen = new Set<string>();
  for (const g of GAMES) for (const genre of g.genres) seen.add(genre);
  return [...seen];
}

/** Куда ведёт кнопка «Играть». */
export function playHref(game: GameEntry): string {
  switch (game.launch.kind) {
    case 'route':
      return game.launch.href;
    case 'iframe':
      return `#/g/${encodeURIComponent(game.id)}/play`;
    case 'external':
      return game.launch.href;
  }
}
