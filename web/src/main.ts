import './styles.css';
import { parseHash, type Cleanup, type PageRender } from './router';
import { detectSupport } from './ui/support';
import { renderHome } from './pages/home';
import { renderPlay } from './pages/play';
import { renderGame } from './pages/game';
import { renderServers } from './pages/servers';
import { renderGuide } from './pages/guide';
import { renderLicenses } from './pages/licenses';
import { renderUnsupported } from './pages/unsupported';
import { renderNotFound } from './pages/notfound';
import { isEngineStarted } from './game/session';
import { ensureCrossOriginIsolation } from './coi';

ensureCrossOriginIsolation();

const PAGES: Record<string, PageRender> = {
  home: renderHome,
  play: renderPlay,
  game: renderGame,
  servers: renderServers,
  guide: renderGuide,
  licenses: renderLicenses,
};

const TITLES: Record<string, string> = {
  home: 'CS 1.6 в браузере',
  play: 'Играть — CS 1.6 в браузере',
  game: 'Игра — CS 1.6 в браузере',
  servers: 'Серверы — CS 1.6 в браузере',
  guide: 'Подготовка файлов — CS 1.6 в браузере',
  licenses: 'Лицензии — CS 1.6 в браузере',
};

/** Маршруты, которым нужна поддержка игры; без неё показывается заглушка. */
const NEEDS_GAME = new Set(['home', 'play', 'game']);

const root = document.getElementById('app');
let cleanup: Cleanup | null = null;
let current = '';

function render(): void {
  if (!root) return;
  const route = parseHash();
  // Движок нельзя остановить и запустить заново — уход с #/game перезагружает страницу.
  if (isEngineStarted() && route.name !== 'game') {
    location.reload();
    return;
  }
  cleanup?.();
  cleanup = null;

  const supported = detectSupport().game;
  const page = !supported && NEEDS_GAME.has(route.name) ? renderUnsupported : (PAGES[route.name] ?? renderNotFound);
  document.title = TITLES[route.name] ?? 'Страница не найдена — CS 1.6 в браузере';
  document.body.dataset.route = route.name;

  const result = page(root, route);
  if (typeof result === 'function') cleanup = result;

  if (current !== route.name) {
    window.scrollTo(0, 0);
    current = route.name;
  }
}

window.addEventListener('hashchange', render);
render();
