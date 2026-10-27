// @ts-check
/**
 * Фоновый опрос игровых серверов. Каждые pollIntervalMs (по умолчанию 5 с) для каждого
 * сервера выполняется одна проба; HTTP-обработчики отдают только кэш и никогда не ждут сеть.
 *
 * Порядок пробы:
 *  1. A2S_INFO (с challenge) — ждём до infoTimeoutMs (1,5 с);
 *  2. легаси Xash3D "info 49" → "info 48";
 *  3. игроки (только если info ответил): A2S_PLAYER → RCON status (если задан RCON_PASSWORD);
 *  4. UDP молчит → HTTP GET httpHealthUrl (2 с): ответил ⇒ online без карты/игроков, иначе offline.
 * Худший случай одной пробы (сервер молчит): 1,5 (A2S) + 1,5 (info 49) + 0,75 (info 48) + 2 (HTTP) ≈ 5,75 с.
 * Пробы разных серверов независимы; HTTP-ответы API от их длительности не зависят.
 */

import {
  UdpSession,
  queryA2sInfo,
  queryA2sPlayers,
  queryRconStatus,
  queryXashInfo,
  isRconPasswordUsable,
} from './a2s.js';

/** @typedef {import('./config.js').ServerDef} ServerDef */
/** @typedef {import('./a2s.js').PlayerEntry} PlayerEntry */
/** @typedef {import('./log.js').Logger} Logger */

/**
 * @typedef {object} PublicPlayer
 * @property {string} name
 * @property {number} score
 * @property {number | null} duration
 */

/**
 * @typedef {object} ServerStatus
 * @property {string} id
 * @property {string} name
 * @property {'online' | 'offline' | 'unknown'} status
 * @property {string | null} map
 * @property {number | null} players
 * @property {number | null} maxPlayers
 * @property {number | null} bots
 * @property {string} signalUrl
 * @property {string} updatedAt
 */

/**
 * @typedef {object} ProbeResult
 * @property {'online' | 'offline'} status
 * @property {'a2s' | 'a2s-goldsrc' | 'xash-info' | 'rcon' | 'http' | 'none'} via
 * @property {string | null} map
 * @property {number | null} players
 * @property {number | null} maxPlayers
 * @property {number | null} bots
 * @property {PublicPlayer[] | null} playerList
 * @property {'a2s' | 'rcon' | null} playersVia
 */

/**
 * @typedef {object} ProbeOptions
 * @property {number} [infoTimeoutMs]     Ожидание ответа A2S_INFO / Xash info (1500)
 * @property {number} [playerTimeoutMs]   Ожидание ответа A2S_PLAYER / RCON (1000)
 * @property {number} [httpTimeoutMs]     Таймаут HTTP-проверки (2000)
 * @property {'a2s' | 'rcon' | null} [preferPlayers]  Какой способ сработал в прошлый раз
 * @property {import('./a2s.js').RconMode | null} [rconMode]
 * @property {(url: string, init: RequestInit) => Promise<Response>} [fetchImpl]
 */

/** @param {PlayerEntry[]} list @returns {PublicPlayer[]} */
function publicPlayers(list) {
  return list.map((p) => ({ name: p.name, score: p.score, duration: p.duration }));
}

/**
 * HTTP-проверка: любой HTTP-ответ означает, что процесс сервера жив.
 * @param {string} url
 * @param {number} timeoutMs
 * @param {(url: string, init: RequestInit) => Promise<Response>} fetchImpl
 */
export async function httpReachable(url, timeoutMs, fetchImpl) {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'cs16-web-api/healthcheck' },
    });
    // Тело не нужно; освобождаем соединение.
    try {
      await res.body?.cancel();
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Одна проба сервера. Никогда не бросает исключений.
 * @param {ServerDef} def
 * @param {ProbeOptions} [opts]
 * @returns {Promise<ProbeResult & { rconMode: import('./a2s.js').RconMode | null }>}
 */
export async function probeServer(def, opts = {}) {
  const infoTimeout = opts.infoTimeoutMs ?? 1500;
  const playerTimeout = opts.playerTimeoutMs ?? 1000;
  const httpTimeout = opts.httpTimeoutMs ?? 2000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const rconOk = isRconPasswordUsable(def.rconPassword);
  /** @type {import('./a2s.js').RconMode | null} */
  let rconMode = opts.rconMode ?? null;

  /** @type {UdpSession | null} */
  let s = null;
  try {
    try {
      s = await UdpSession.open(def.queryHost, def.queryPort);
    } catch {
      s = null; // хост не резолвится — сразу к HTTP
    }

    if (s) {
      const info = (await queryA2sInfo(s, infoTimeout)) ?? (await queryXashInfo(s, infoTimeout));
      if (info) {
        /** @type {PlayerEntry[] | null} */
        let list = null;
        /** @type {'a2s' | 'rcon' | null} */
        let playersVia = null;
        const order = opts.preferPlayers === 'rcon' ? ['rcon', 'a2s'] : ['a2s', 'rcon'];
        for (const method of order) {
          if (list) break;
          if (method === 'a2s') {
            list = await queryA2sPlayers(s, playerTimeout);
            if (list) playersVia = 'a2s';
          } else if (rconOk) {
            const r = await queryRconStatus(s, def.rconPassword, playerTimeout, rconMode);
            if (r && 'mode' in r) {
              list = r.players;
              rconMode = r.mode;
              playersVia = 'rcon';
            }
          }
        }
        const bots = info.bots ?? (list ? list.filter((p) => p.bot).length : null);
        return {
          status: 'online',
          via: info.source,
          map: info.map || null,
          players: info.players,
          maxPlayers: info.maxPlayers || def.maxPlayers,
          bots,
          playerList: list ? publicPlayers(list) : null,
          playersVia,
          rconMode,
        };
      }
      // На A2S_INFO и "info" никто не ответил. RCON идёт через тот же обработчик
      // внеполосных пакетов движка, поэтому здесь его не пробуем — сразу HTTP.
    }

    if (def.httpHealthUrl && (await httpReachable(def.httpHealthUrl, httpTimeout, fetchImpl))) {
      return {
        status: 'online',
        via: 'http',
        map: null,
        players: null,
        maxPlayers: def.maxPlayers,
        bots: null,
        playerList: null,
        playersVia: null,
        rconMode,
      };
    }
    return {
      status: 'offline',
      via: 'none',
      map: null,
      players: null,
      maxPlayers: def.maxPlayers,
      bots: null,
      playerList: null,
      playersVia: null,
      rconMode,
    };
  } catch {
    return {
      status: 'offline',
      via: 'none',
      map: null,
      players: null,
      maxPlayers: def.maxPlayers,
      bots: null,
      playerList: null,
      playersVia: null,
      rconMode,
    };
  } finally {
    s?.close();
  }
}

/**
 * @typedef {object} CacheEntry
 * @property {ServerStatus} status
 * @property {PublicPlayer[]} playerList
 * @property {string} via
 * @property {'a2s' | 'rcon' | null} playersVia
 * @property {import('./a2s.js').RconMode | null} rconMode
 */

/**
 * Хранит последний результат пробы каждого сервера и опрашивает их в фоне.
 */
export class StatusPoller {
  /**
   * @param {ServerDef[]} servers
   * @param {{ intervalMs: number, log: Logger, probe?: typeof probeServer, probeOptions?: ProbeOptions }} opts
   */
  constructor(servers, opts) {
    this.servers = servers;
    this.intervalMs = opts.intervalMs;
    this.log = opts.log;
    this.probe = opts.probe ?? probeServer;
    this.probeOptions = opts.probeOptions ?? {};
    const startedAt = new Date().toISOString();
    /** @type {Map<string, CacheEntry>} */
    this.state = new Map();
    for (const d of servers) {
      this.state.set(d.id, {
        status: {
          id: d.id,
          name: d.name,
          status: 'unknown',
          map: null,
          players: null,
          maxPlayers: d.maxPlayers,
          bots: null,
          signalUrl: d.signalUrl,
          updatedAt: startedAt,
        },
        playerList: [],
        via: 'none',
        playersVia: null,
        rconMode: null,
      });
    }
    /** @type {Map<string, NodeJS.Timeout>} */
    this.timers = new Map();
    /** @type {Set<Promise<void>>} */
    this.inflight = new Set();
    this.stopped = true;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    for (const d of this.servers) this.schedule(d, 0);
  }

  /** @param {ServerDef} def @param {number} delay */
  schedule(def, delay) {
    if (this.stopped) return;
    const t = setTimeout(() => {
      const started = Date.now();
      const p = this.pollOnce(def).finally(() => {
        this.inflight.delete(p);
        // Интервал отсчитывается от начала пробы: медленная проба не сдвигает расписание.
        this.schedule(def, Math.max(0, this.intervalMs - (Date.now() - started)));
      });
      this.inflight.add(p);
    }, delay);
    t.unref();
    this.timers.set(def.id, t);
  }

  /**
   * Опросить сервер один раз и обновить кэш. Не бросает исключений.
   * @param {ServerDef} def
   */
  async pollOnce(def) {
    const prev = this.state.get(def.id);
    if (!prev) return;
    try {
      const r = await this.probe(def, {
        ...this.probeOptions,
        preferPlayers: prev.playersVia,
        rconMode: prev.rconMode,
      });
      if (this.stopped) return;
      /** @type {ServerStatus} */
      const status = {
        id: def.id,
        name: def.name,
        status: r.status,
        map: r.map,
        players: r.players,
        maxPlayers: r.maxPlayers,
        bots: r.bots,
        signalUrl: def.signalUrl,
        updatedAt: new Date().toISOString(),
      };
      if (prev.status.status !== status.status || prev.via !== r.via) {
        this.log('info', 'server status changed', {
          server: def.id,
          from: prev.status.status,
          to: status.status,
          via: r.via,
          map: r.map,
        });
      }
      this.state.set(def.id, {
        status,
        playerList: r.playerList ?? [],
        via: r.via,
        playersVia: r.playersVia ?? prev.playersVia,
        rconMode: r.rconMode ?? prev.rconMode,
      });
    } catch (e) {
      this.log('error', 'poll failed', { server: def.id, err: e });
    }
  }

  /** @returns {ServerStatus[]} */
  list() {
    /** @type {ServerStatus[]} */
    const out = [];
    for (const d of this.servers) {
      const e = this.state.get(d.id);
      if (e) out.push({ ...e.status });
    }
    return out;
  }

  /**
   * @param {string} id
   * @returns {(ServerStatus & { playerList: PublicPlayer[] }) | null}
   */
  get(id) {
    const s = this.state.get(id);
    if (!s) return null;
    return { ...s.status, playerList: s.playerList.map((p) => ({ ...p })) };
  }

  /** Остановить опрос и дождаться текущих проб (не дольше timeoutMs). */
  async stop(timeoutMs = 3000) {
    this.stopped = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.inflight.size === 0) return;
    /** @type {NodeJS.Timeout | undefined} */
    let t;
    await Promise.race([
      Promise.allSettled([...this.inflight]),
      new Promise((r) => {
        t = setTimeout(r, timeoutMs);
      }),
    ]);
    clearTimeout(t);
  }
}
