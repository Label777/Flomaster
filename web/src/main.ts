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
import { renderCatalogGame, catalogGameTitle } from './pages/game-page';
import { pageTitle } from './site';
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
  g: renderCatalogGame,
};

const TITLES: Record<string, string> = {
  play: 'Counter-Strike 1.6 — запуск',
  game: 'Counter-Strike 1.6',
  servers: 'Серверы',
  guide: 'Counter-Strike 1.6 — подготовка файлов',
  licenses: 'Лицензии',
};

/** Маршруты CS 1.6, которым нужна поддержка движка; без неё показывается заглушка. Каталог открыт всем. */
const NEEDS_GAME = new Set(['play', 'game']);

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
  document.title =
    route.name === 'home'
      ? pageTitle()
      : pageTitle(route.name === 'g' ? (catalogGameTitle(route) ?? 'Страница не найдена') : (TITLES[route.name] ?? 'Страница не найдена'));
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
