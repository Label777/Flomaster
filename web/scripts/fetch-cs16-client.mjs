#!/usr/bin/env node
/**
 * Собирает локальный пакет cs16-client в web/vendor/cs16-client.
 *
 * Пакет cs16-client (MIT, автор yohimik) снят с npm в сентябре 2026, поэтому
 * `npm install cs16-client@0.1.2` больше не работает. Его файлы по-прежнему
 * раздаёт jsDelivr. Скрипт скачивает нужные wasm/pk3, сверяет SHA-256 с
 * опубликованными jsDelivr хешами и кладёт рядом package.json с теми же
 * exports, что были у оригинала. В package.json сайта зависимость указана
 * как "file:vendor/cs16-client".
 *
 * Запуск: node scripts/fetch-cs16-client.mjs   (до npm install)
 * Другой источник: CS16_CLIENT_BASE=https://зеркало/cs16-client@0.1.2 node scripts/fetch-cs16-client.mjs
 *
 * Это код клиента и сервера мода (не файлы игры Valve). В git не коммитится (web/vendor/ в .gitignore).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '0.1.2';
const BASE = (process.env.CS16_CLIENT_BASE || `https://cdn.jsdelivr.net/npm/cs16-client@${VERSION}`).replace(/\/$/, '');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'cs16-client');

// Хеши — из https://data.jsdelivr.com/v1/packages/npm/cs16-client@0.1.2 (SHA-256, base64).
const FILES = [
  { src: 'dist/cstrike/cl_dlls/client_emscripten_wasm32.wasm', dst: 'cl_dlls/client_emscripten_wasm32.wasm', size: 489444, sha256: 'OosmoUzlYqs7z78qj1fCgirgTCoTTK7bsDNVAD6l7Pc=' },
  { src: 'dist/cstrike/cl_dlls/menu_emscripten_wasm32.wasm', dst: 'cl_dlls/menu_emscripten_wasm32.wasm', size: 494161, sha256: '1YAnQtMrkpXvp0eRFHmMgyJIx1juRHSvDa+qJ3PX0IY=' },
  { src: 'dist/cstrike/dlls/cs_emscripten_wasm32.wasm', dst: 'dlls/cs_emscripten_wasm32.wasm', size: 1323625, sha256: 'nIOII93sT2WYag+OcV17IvAeLp3J3ln+A3UrzevcC5c=' },
  { src: 'dist/cstrike/extras.pk3', dst: 'extras.pk3', size: 25111596, sha256: 'SdXgDOUO0Bqs46HCA1opWcP35EV8orbDHQHkzSp6XWk=' },
];

const sha = (buf) => createHash('sha256').update(buf).digest('base64');

async function have(file) {
  try {
    const buf = await readFile(join(OUT, file.dst));
    return buf.length === file.size && sha(buf) === file.sha256;
  } catch {
    return false;
  }
}

async function download(file) {
  const url = `${BASE}/${file.src}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const got = sha(buf);
      if (got !== file.sha256) throw new Error(`SHA-256 не совпал: ждали ${file.sha256}, получили ${got} (${buf.length} байт)`);
      const target = join(OUT, file.dst);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(`${target}.part`, buf);
      await rename(`${target}.part`, target);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error(`${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

const pkg = {
  name: 'cs16-client',
  version: VERSION,
  description: 'cs16-client emscripten port (локальная копия файлов опубликованного пакета, см. scripts/fetch-cs16-client.mjs)',
  homepage: 'https://github.com/yohimik/webxash3d-fwgs',
  author: 'yohimik',
  license: 'MIT',
  exports: {
    './cl_dlls/client_emscripten_wasm32.wasm': './cl_dlls/client_emscripten_wasm32.wasm',
    './cl_dlls/menu_emscripten_wasm32.wasm': './cl_dlls/menu_emscripten_wasm32.wasm',
    './dlls/cs_emscripten_wasm32.wasm': './dlls/cs_emscripten_wasm32.wasm',
    './extras.pk3': './extras.pk3',
  },
};

await mkdir(OUT, { recursive: true });
let fetched = 0;
for (const file of FILES) {
  if (await have(file)) continue;
  process.stdout.write(`cs16-client: ${file.dst} … `);
  await download(file);
  fetched++;
  console.log('ok');
}
await writeFile(join(OUT, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`cs16-client@${VERSION}: ${fetched ? `скачано файлов: ${fetched}` : 'уже на месте'}, хеши сверены → ${OUT}`);
