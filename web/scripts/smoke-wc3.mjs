#!/usr/bin/env node
/**
 * Дымовой тест сборки Warsmash (Warcraft III) без файлов игры.
 *
 * Раздаёт каталог сайта с теми же заголовками изоляции, что Caddy
 * (COOP same-origin, COEP require-corp, CORP same-origin), открывает в headless
 * Chromium страницы движка по пути BASE и запускает движок без файлов игры
 * (window.__startEngine — тот же вызов, что делает страница Multiplayer).
 * Проверяет то, что можно проверить без Warcraft III:
 *   - все запросы к нашему origin успешны (нет 404 из-за путей от корня домена);
 *   - нет необработанных ошибок JS на страницах;
 *   - страница cross-origin isolated, есть OffscreenCanvas и OPFS;
 *   - движок реально стартует: загружены engine-worker-boot.js, engine-worker.js
 *     и assets/preload.txt именно из BASE.
 *
 *   node scripts/smoke-wc3.mjs <каталог сайта> [BASE=/games/wc3/]
 *   PLAYWRIGHT_MODULE=<путь к пакету playwright> — если он не ставится в node_modules сайта
 * Код выхода: 0 — всё прошло, 1 — найдены ошибки, 2 — не удалось запустить.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const siteDir = resolve(process.argv[2] ?? '.');
const base = process.argv[3] ?? '/games/wc3/';
const BOOT_WAIT_MS = Number(process.env.SMOKE_BOOT_WAIT_MS ?? 25000);

let chromium;
try {
  const mod = process.env.PLAYWRIGHT_MODULE
    ? await import(pathToFileURL(join(process.env.PLAYWRIGHT_MODULE, 'index.mjs')).href)
    : await import('playwright');
  chromium = mod.chromium ?? mod.default?.chromium;
} catch (err) {
  console.error('smoke-wc3: не найден пакет playwright (npm i playwright или PLAYWRIGHT_MODULE=…):', err.message);
  process.exit(2);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
};
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let path = normalize(join(siteDir, decodeURIComponent(url.pathname)));
    if (!path.startsWith(siteDir)) throw new Error('outside');
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { ...ISOLATION, 'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, ISOLATION);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
console.log(`smoke-wc3: ${siteDir} → ${origin}${base}`);

const problems = [];
const okFrom = new Set();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext();

function watch(page, label) {
  page.on('response', (r) => {
    const u = r.url();
    if (!u.startsWith(origin)) return;
    const p = new URL(u).pathname;
    if (r.status() >= 400) problems.push(`${label}: ${r.status()} ${p}`);
    else okFrom.add(p);
  });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(origin)) problems.push(`${label}: запрос не прошёл ${new URL(r.url()).pathname} (${r.failure()?.errorText})`);
  });
  page.on('pageerror', (e) => problems.push(`${label}: ошибка JS: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || /engine-worker-boot|ERROR|WARN/.test(t)) console.log(`  [${label} console.${m.type()}] ${t.slice(0, 300)}`);
  });
}

async function visit(path, label) {
  const page = await context.newPage();
  watch(page, label);
  const res = await page.goto(origin + path, { waitUntil: 'load' });
  if (!res || res.status() !== 200) problems.push(`${label}: страница ${path} — ${res?.status()}`);
  await page.waitForTimeout(1500);
  return page;
}

try {
  for (const [p, label] of [[base, 'главная'], [`${base}assets/`, 'assets'], [`${base}multiplayer/`, 'multiplayer']]) {
    const page = await visit(p, label);
    await page.close();
  }

  const play = await visit(`${base}play/`, 'play');
  const env = await play.evaluate(async () => ({
    isolated: window.crossOriginIsolated,
    offscreen: typeof OffscreenCanvas !== 'undefined',
    opfs: typeof navigator.storage?.getDirectory === 'function',
    startEngine: typeof window.__startEngine === 'function',
  }));
  console.log('smoke-wc3: окружение play/', JSON.stringify(env));
  if (!env.isolated) problems.push('play: страница не cross-origin isolated');
  if (!env.offscreen) problems.push('play: нет OffscreenCanvas');
  if (!env.opfs) problems.push('play: нет OPFS');
  if (env.startEngine) {
    await play.evaluate(() => {
      try {
        window.__startEngine();
      } catch (e) {
        console.error('smoke: __startEngine бросил', String(e));
      }
    });
    await play.waitForTimeout(BOOT_WAIT_MS);
    for (const f of ['engine-worker-boot.js', 'scripts/gdx.wasm.js', 'engine-worker.js', 'assets/preload.txt']) {
      if (![...okFrom].some((p) => p === `${base}${f}`)) problems.push(`play: движок не загрузил ${base}${f}`);
    }
  } else {
    problems.push('play: нет window.__startEngine — изменился upstream, тест нужно поправить');
  }
} finally {
  await browser.close();
  server.close();
}

const rootHits = [...okFrom].filter((p) => !p.startsWith(base));
if (rootHits.length) console.log('smoke-wc3: запросы вне BASE (успешные):', rootHits.join(', '));
console.log(`smoke-wc3: успешных запросов к сайту: ${okFrom.size}`);
if (problems.length) {
  console.error(`smoke-wc3: ОШИБКИ (${problems.length}):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('smoke-wc3: OK — страницы открываются, движок стартует из', base);
