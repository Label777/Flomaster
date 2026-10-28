#!/usr/bin/env node
/**
 * Собирает Warsmash (Warcraft III в браузере) в web/public/games/wc3/ —
 * обёртка над scripts/build-wc3.sh с путём, который подходит этой сборке сайта.
 *
 * Путь берётся из VITE_BASE (как у vite.config.ts): '/' на своём домене →
 * /games/wc3/, '/<repo>/' на GitHub Pages → /<repo>/games/wc3/. Сборка
 * Warsmash привязана к этому пути, поэтому её пересобирают при смене VITE_BASE.
 *
 * Запуск: node scripts/fetch-wc3.mjs   (до npm run build)
 * Нужно: bash, git, JDK 17, Node 18+, сеть до GitHub, Maven Central, jitpack, npm.
 * Сигналинг: VITE_WC3_SIGNALING=wss://… (пусто — сервер Poki).
 *
 * Это код движка Warsmash (AGPL-3.0), а не файлы игры. В git не коммитится
 * (web/public/games/wc3/ в .gitignore).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(webDir, '..');
const out = join(webDir, 'public', 'games', 'wc3');

let base = (process.env.VITE_BASE ?? '/').trim() || '/';
if (!base.startsWith('/')) base = `/${base}`;
if (!base.endsWith('/')) base = `${base}/`;
const wc3Base = `${base}games/wc3/`;

console.log(`wc3: сборка Warsmash → ${out} (путь на сайте ${wc3Base})`);
const res = spawnSync('bash', [join(repoDir, 'scripts', 'build-wc3.sh'), out], {
  stdio: 'inherit',
  env: { ...process.env, WC3_BASE: wc3Base },
});
if (res.error) {
  console.error(`wc3: не удалось запустить bash: ${res.error.message}`);
  process.exit(2);
}
process.exit(res.status ?? 1);
