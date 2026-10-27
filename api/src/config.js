// @ts-check
/**
 * Конфигурация API из переменных окружения. Чистая функция loadConfig(env) —
 * её удобно тестировать; ошибки конфигурации бросаются как ConfigError.
 */

/**
 * @typedef {object} ServerDef
 * @property {string} id            Идентификатор ([a-z0-9_-], до 32 символов), часть URL /rtc/<id>/...
 * @property {string} name          Отображаемое имя
 * @property {string} queryHost     Хост для UDP-запросов (A2S / Xash3D info / RCON)
 * @property {number} queryPort     UDP-порт для запросов
 * @property {string | null} httpHealthUrl  URL HTTP-проверки, если UDP молчит (null = не проверять)
 * @property {string} signalPath    Путь сигналинга внутри cs-server (например "/websocket")
 * @property {string} signalUrl     Публичный путь сигналинга: /rtc/<id><signalPath>
 * @property {number | null} maxPlayers   Значение maxPlayers, если сервер его не сообщил
 * @property {string} rconPassword  Пароль RCON ("" = RCON не используется)
 */

/**
 * @typedef {object} TurnConfig
 * @property {string} domain   Хост STUN/TURN (DOMAIN)
 * @property {number} port     TURN_PORT
 * @property {string} secret   TURN_SECRET ("" = выдаём только STUN)
 * @property {number} ttl      TURN_TTL, секунд
 */

/**
 * @typedef {object} Config
 * @property {number} port           Порт HTTP-сервера API
 * @property {number} pollIntervalMs Период опроса статуса серверов
 * @property {ServerDef[]} servers
 * @property {TurnConfig} turn
 * @property {number} iceRatePerMin  Лимит запросов /api/ice на IP в минуту
 * @property {boolean} trustProxy    Брать IP клиента из X-Forwarded-For (за Caddy)
 * @property {string[]} allowedOrigins  Origin'ы для CORS (сайт на GitHub Pages); пусто = CORS выключен
 * @property {import('./log.js').LogLevel} logLevel
 */

import { parseLevel } from './log.js';

export class ConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 * @param {string} name
 * @param {{ min?: number, max?: number }} [range]
 */
function intEnv(raw, fallback, name, range = {}) {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  const { min = -Infinity, max = Infinity } = range;
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name}: ожидалось целое число в диапазоне [${min}, ${max}], получено "${raw}"`);
  }
  return n;
}

/** @param {unknown} v @param {string} what */
function port(v, what) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 65535) {
    throw new ConfigError(`${what}: некорректный порт ${JSON.stringify(v)}`);
  }
  return n;
}

/** @param {string} p */
function normalizePath(p) {
  const s = p.trim();
  if (s === '') return '/';
  return s.startsWith('/') ? s : `/${s}`;
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Config}
 */
export function loadConfig(env) {
  const signalPath = normalizePath(env.CS_SIGNAL_PATH ?? '/websocket');
  const rcon = env.RCON_PASSWORD ?? '';
  const defaultMax = env.MAX_PLAYERS ? intEnv(env.MAX_PLAYERS, 0, 'MAX_PLAYERS', { min: 1, max: 64 }) : null;

  /** @type {ServerDef[]} */
  let servers;
  if (env.SERVERS_JSON && env.SERVERS_JSON.trim() !== '') {
    /** @type {unknown} */
    let parsed;
    try {
      parsed = JSON.parse(env.SERVERS_JSON);
    } catch (e) {
      throw new ConfigError(`SERVERS_JSON: невалидный JSON (${/** @type {Error} */ (e).message})`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new ConfigError('SERVERS_JSON: ожидался непустой массив');
    }
    const seen = new Set();
    servers = parsed.map((item, i) => {
      if (!item || typeof item !== 'object') throw new ConfigError(`SERVERS_JSON[${i}]: ожидался объект`);
      const o = /** @type {Record<string, unknown>} */ (item);
      const id = String(o.id ?? '');
      if (!ID_RE.test(id)) throw new ConfigError(`SERVERS_JSON[${i}].id: допустимы [a-z0-9_-], до 32 символов`);
      if (seen.has(id)) throw new ConfigError(`SERVERS_JSON: повторяющийся id "${id}"`);
      seen.add(id);
      if (typeof o.queryHost !== 'string' || o.queryHost === '') {
        throw new ConfigError(`SERVERS_JSON[${i}].queryHost: обязательная строка`);
      }
      const sp = normalizePath(typeof o.signalPath === 'string' ? o.signalPath : signalPath);
      const health = o.httpHealthUrl === undefined ? null : o.httpHealthUrl === null ? null : String(o.httpHealthUrl);
      if (health !== null) {
        try {
          const u = new URL(health);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol');
        } catch {
          throw new ConfigError(`SERVERS_JSON[${i}].httpHealthUrl: ожидался http(s) URL`);
        }
      }
      /** @type {ServerDef} */
      const def = {
        id,
        name: typeof o.name === 'string' && o.name !== '' ? o.name : id,
        queryHost: o.queryHost,
        queryPort: port(o.queryPort, `SERVERS_JSON[${i}].queryPort`),
        httpHealthUrl: health,
        signalPath: sp,
        signalUrl: `/rtc/${id}${sp}`,
        maxPlayers: typeof o.maxPlayers === 'number' && Number.isInteger(o.maxPlayers) ? o.maxPlayers : defaultMax,
        rconPassword: typeof o.rconPassword === 'string' ? o.rconPassword : rcon,
      };
      return def;
    });
  } else {
    const qp = env.GAME_QUERY_PORT && env.GAME_QUERY_PORT.trim() !== '' ? env.GAME_QUERY_PORT : env.GAME_PORT ?? '27018';
    servers = [
      {
        id: 'main',
        name: env.SERVER_NAME && env.SERVER_NAME.trim() !== '' ? env.SERVER_NAME : 'CS 1.6 Web',
        queryHost: env.CS_QUERY_HOST && env.CS_QUERY_HOST.trim() !== '' ? env.CS_QUERY_HOST : 'cs-server',
        queryPort: port(qp, 'GAME_QUERY_PORT/GAME_PORT'),
        httpHealthUrl: env.CS_HEALTH_URL !== undefined ? env.CS_HEALTH_URL || null : 'http://cs-server:27016/',
        signalPath,
        signalUrl: `/rtc/main${signalPath}`,
        maxPlayers: defaultMax,
        rconPassword: rcon,
      },
    ];
  }

  const ttl = intEnv(env.TURN_TTL, 86400, 'TURN_TTL', { min: 60, max: 7 * 24 * 3600 });
  return {
    port: intEnv(env.PORT, 8080, 'PORT', { min: 0, max: 65535 }), // 0 = случайный порт (тесты)
    pollIntervalMs: intEnv(env.POLL_INTERVAL_MS, 5000, 'POLL_INTERVAL_MS', { min: 500, max: 600000 }),
    servers,
    turn: {
      domain: (env.DOMAIN ?? '').trim(),
      port: intEnv(env.TURN_PORT, 3478, 'TURN_PORT', { min: 1, max: 65535 }),
      secret: env.TURN_SECRET ?? '',
      ttl,
    },
    iceRatePerMin: intEnv(env.ICE_RATE_PER_MIN, 30, 'ICE_RATE_PER_MIN', { min: 1, max: 100000 }),
    trustProxy: (env.TRUST_PROXY ?? '1') !== '0',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter((o) => o !== ''),
    logLevel: parseLevel(env.LOG_LEVEL),
  };
}

/**
 * Безопасное для логов представление конфигурации (без секретов).
 * @param {Config} c
 */
export function redactConfig(c) {
  return {
    port: c.port,
    pollIntervalMs: c.pollIntervalMs,
    servers: c.servers.map((s) => ({
      id: s.id,
      name: s.name,
      query: `${s.queryHost}:${s.queryPort}`,
      httpHealthUrl: s.httpHealthUrl,
      signalUrl: s.signalUrl,
      rcon: s.rconPassword !== '',
    })),
    turn: { domain: c.turn.domain, port: c.turn.port, ttl: c.turn.ttl, secret: c.turn.secret !== '' },
    iceRatePerMin: c.iceRatePerMin,
    trustProxy: c.trustProxy,
    logLevel: c.logLevel,
  };
}
