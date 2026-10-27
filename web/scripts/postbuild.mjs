// После vite build: тексты лицензий в dist и предсжатые .br/.gz для Caddy (file_server precompressed).
// Только встроенные модули Node.
import { readdir, stat, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { constants as fsc } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as z } from 'node:zlib';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = join(webDir, '..');
const distDir = process.env.POSTBUILD_DIST ?? join(webDir, 'dist');

const COMPRESS_EXT = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.txt', '.wasm', '.pk3']);
const MIN_SIZE = 1024;
const BIG_FILE = 20 * 1024 * 1024;

const log = (...args) => console.log('[postbuild]', ...args);

async function exists(path) {
  try {
    await access(path, fsc.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function copyLegal() {
  const pairs = [
    [join(repoDir, 'THIRD_PARTY_NOTICES.md'), join(distDir, 'THIRD_PARTY_NOTICES.txt')],
    [join(repoDir, 'LICENSE'), join(distDir, 'LICENSE.txt')],
  ];
  for (const [from, to] of pairs) {
    if (await exists(from)) {
      await copyFile(from, to);
      log('скопирован', relative(repoDir, from), '→', relative(distDir, to));
    } else {
      console.warn('[postbuild] ВНИМАНИЕ: нет файла', from, '— страница «Лицензии» покажет, что его нет в сборке');
    }
  }
}

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

async function compressAll() {
  let count = 0;
  let before = 0;
  let afterBr = 0;
  for await (const path of walk(distDir)) {
    if (!COMPRESS_EXT.has(extname(path).toLowerCase())) continue;
    const { size } = await stat(path);
    if (size < MIN_SIZE) continue;
    const data = await readFile(path);
    const br = brotliCompressSync(data, {
      params: {
        [z.BROTLI_PARAM_MODE]: z.BROTLI_MODE_GENERIC,
        [z.BROTLI_PARAM_QUALITY]: size > BIG_FILE ? 9 : 11,
        [z.BROTLI_PARAM_SIZE_HINT]: size,
      },
    });
    const gz = gzipSync(data, { level: 9 });
    // Несжимаемое (уже сжатое) не дублируем: Caddy отдаст оригинал.
    if (br.length < size) await writeFile(`${path}.br`, br);
    if (gz.length < size) await writeFile(`${path}.gz`, gz);
    count++;
    before += size;
    afterBr += Math.min(br.length, size);
  }
  const mb = (n) => (n / 1048576).toFixed(1);
  log(`сжато файлов: ${count}, ${mb(before)} МБ → ${mb(afterBr)} МБ (br)`);
}

if (!(await exists(distDir))) {
  console.error('[postbuild] нет каталога', distDir, '— сначала vite build');
  process.exit(1);
}
await copyLegal();
await compressAll();
