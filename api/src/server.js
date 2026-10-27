// @ts-check
/**
 * HTTP API сайта (Node 22, без зависимостей). Контракты — ARCHITECTURE.md §6.
 *
 *   GET /api/servers       → { servers: ServerStatus[] }        (из кэша фонового опроса)
 *   GET /api/servers/:id   → ServerStatus + { playerList }
 *   GET /api/ice           → { iceServers, ttl }                 (30 запросов/мин на IP)
 *   GET /api/health        → 204                                 (замер RTT)
 *
 * Все ответы: Cache-Control: no-store; разрешены только GET и HEAD.
 * API стоит за Caddy и наружу не публикуется; IP клиента берётся из X-Forwarded-For.
 */

import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { ConfigError, loadConfig, redactConfig } from './config.js';
import { createLogger, parseLevel } from './log.js';
import { StatusPoller } from './status.js';
import { RateLimiter, buildIceResponse } from './turn.js';

/** @typedef {import('./config.js').Config} Config */
/** @typedef {import('./log.js').Logger} Logger */

const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * IP клиента. За Caddy берём последний элемент X-Forwarded-For — его дописал
 * ближайший доверенный прокси (Caddy по умолчанию не доверяет XFF от клиента и
 * перезаписывает заголовок, так что элемент там обычно один).
 * @param {http.IncomingMessage} req
 * @param {boolean} trustProxy
 */
export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const xff = req.headers['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff.join(',') : xff;
    if (raw) {
      const parts = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && last.length <= 64) return last;
    }
  }
  return (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
}

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body  undefined = без тела
 * @param {boolean} head
 * @param {Record<string, string>} [extra]
 */
function send(res, status, body, head, extra = {}) {
  /** @type {Record<string, string | number>} */
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  };
  if (body === undefined) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  headers['Content-Type'] = JSON_TYPE;
  headers['Content-Length'] = payload.length;
  res.writeHead(status, headers);
  res.end(head ? undefined : payload);
}

/**
 * @param {{ config: Config, poller: Pick<StatusPoller, 'list' | 'get'>, limiter: RateLimiter, log: Logger }} deps
 * @returns {http.RequestListener}
 */
export function createHandler({ config, poller, limiter, log }) {
  return (req, res) => {
    const started = process.hrtime.bigint();
    const method = req.method ?? 'GET';
    const head = method === 'HEAD';
    /** @type {string} */
    let path;
    try {
      path = new URL(req.url ?? '/', 'http://api.local').pathname;
    } catch {
      path = '/';
    }
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      log(res.statusCode >= 500 ? 'error' : 'debug', 'request', {
        method,
        path,
        status: res.statusCode,
        ms: Math.round(ms * 100) / 100,
      });
    });

    // CORS для сайта на другом origin (GitHub Pages): только origin'ы из ALLOWED_ORIGINS.
    const origin = req.headers.origin;
    if (typeof origin === 'string' && config.allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, HEAD',
          'Access-Control-Allow-Headers': 'Accept',
          'Access-Control-Max-Age': '600',
        });
        res.end();
        return;
      }
    }

    try {
      if (method !== 'GET' && method !== 'HEAD') {
        send(res, 405, { error: 'method_not_allowed' }, false, { Allow: 'GET, HEAD' });
        return;
      }

      if (path === '/api/health') {
        send(res, 204, undefined, head);
        return;
      }

      if (path === '/api/servers') {
        send(res, 200, { servers: poller.list() }, head);
        return;
      }

      if (path.startsWith('/api/servers/')) {
        /** @type {string} */
        let id;
        try {
          id = decodeURIComponent(path.slice('/api/servers/'.length));
        } catch {
          id = '';
        }
        const s = id && !id.includes('/') ? poller.get(id) : null;
        if (!s) {
          send(res, 404, { error: 'not_found', message: 'unknown server id' }, head);
          return;
        }
        send(res, 200, s, head);
        return;
      }

      if (path === '/api/ice') {
        const ip = clientIp(req, config.trustProxy);
        const r = limiter.take(ip);
        if (!r.ok) {
          log('info', 'ice rate limited', { ip, retryAfter: r.retryAfterSec });
          send(res, 429, { error: 'rate_limited', retryAfter: r.retryAfterSec }, head, {
            'Retry-After': String(r.retryAfterSec),
          });
          return;
        }
        send(res, 200, buildIceResponse(config.turn), head, {
          'X-RateLimit-Limit': String(limiter.capacity),
          'X-RateLimit-Remaining': String(r.remaining),
        });
        return;
      }

      send(res, 404, { error: 'not_found' }, head);
    } catch (e) {
      log('error', 'handler error', { path, err: e });
      if (!res.headersSent) send(res, 500, { error: 'internal' }, head);
      else res.destroy();
    }
  };
}

/**
 * Собрать и запустить API. Возвращает объект с методом close() для тестов.
 * @param {{ env?: Record<string, string | undefined>, log?: Logger, listen?: boolean }} [opts]
 */
export async function startServer(opts = {}) {
  const env = opts.env ?? process.env;
  const config = loadConfig(env);
  const log = opts.log ?? createLogger({ level: config.logLevel });
  const poller = new StatusPoller(config.servers, { intervalMs: config.pollIntervalMs, log });
  const limiter = new RateLimiter({ capacity: config.iceRatePerMin, windowMs: 60_000 });
  const sweep = setInterval(() => limiter.sweep(), 60_000);
  sweep.unref();

  const server = http.createServer(createHandler({ config, poller, limiter, log }));
  // Caddy держит соединения к upstream до 2 мин — keep-alive у нас должен быть дольше,
  // иначе возможны редкие 502 при переиспользовании закрытого соединения.
  server.keepAliveTimeout = 130_000;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.maxHeadersCount = 64;

  poller.start();
  if (opts.listen !== false) {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, () => {
        server.off('error', reject);
        resolve(undefined);
      });
    });
    const addr = server.address();
    log('info', 'api listening', {
      port: typeof addr === 'object' && addr ? addr.port : config.port,
      config: redactConfig(config),
    });
  }

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    clearInterval(sweep);
    const closed = new Promise((resolve) => server.close(() => resolve(undefined)));
    server.closeIdleConnections();
    await poller.stop();
    /** @type {NodeJS.Timeout | undefined} */
    let t;
    await Promise.race([
      closed,
      new Promise((r) => {
        t = setTimeout(r, 5000);
      }),
    ]);
    clearTimeout(t);
    server.closeAllConnections();
  };

  return { server, poller, limiter, config, log, close };
}

async function main() {
  const log = createLogger({ level: parseLevel(process.env.LOG_LEVEL) });
  /** @type {Awaited<ReturnType<typeof startServer>>} */
  let app;
  try {
    app = await startServer({ log });
  } catch (e) {
    log('error', e instanceof ConfigError ? 'invalid configuration' : 'startup failed', { err: e });
    process.exit(1);
  }
  const shutdown = (/** @type {string} */ signal) => {
    app.log('info', 'shutting down', { signal });
    const force = setTimeout(() => {
      app.log('warn', 'forced exit');
      process.exit(1);
    }, 10_000);
    force.unref();
    app.close().then(
      () => {
        app.log('info', 'bye');
        process.exit(0);
      },
      (err) => {
        app.log('error', 'shutdown error', { err });
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    app.log('error', 'uncaught exception', { err });
  });
  process.on('unhandledRejection', (err) => {
    app.log('error', 'unhandled rejection', { err: err instanceof Error ? err : String(err) });
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main();
}
