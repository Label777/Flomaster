// @ts-check
/**
 * Запросы статуса игрового сервера по UDP.
 *
 * Поддерживаются:
 *  - A2S_INFO  (Source-ответ 'I' 0x49 и старый GoldSrc-ответ 'm' 0x6D, с S2C_CHALLENGE 0x41);
 *  - легаси-запрос Xash3D: "info <протокол>\n" → "info\n\key\value...";
 *  - A2S_PLAYER (0x55 → 0x44, с challenge);
 *  - RCON "status": GoldSrc ("challenge rcon" → rcon <challenge> "<пароль>" status)
 *    и вариант Xash3D без challenge (rcon "<пароль>" status).
 *
 * Построение запросов и разбор ответов — чистые функции (build* / parse*), сетевая часть —
 * UdpSession и query*-функции. Ни одна функция не бросает исключений наружу из-за
 * содержимого пакетов: неразбираемый ответ = null.
 */

import dgram from 'node:dgram';
import dns from 'node:dns';

/** Префикс внеполосного (connectionless) пакета. */
export const OOB = Buffer.from([0xff, 0xff, 0xff, 0xff]);
/** Префикс разбитого на части пакета (GoldSrc split). */
const SPLIT = 0xfffffffe | 0; // -2 как int32 LE: FE FF FF FF

export const A2S_INFO = 0x54; // 'T'
export const A2S_PLAYER = 0x55; // 'U'
export const S2C_CHALLENGE = 0x41; // 'A'
export const S2A_INFO_SRC = 0x49; // 'I'
export const S2A_INFO_GOLDSRC = 0x6d; // 'm'
export const S2A_PLAYER = 0x44; // 'D'
const S2A_LOG = 0x6c; // 'l' — ответ HLDS на rcon

const NO_CHALLENGE = Buffer.from([0xff, 0xff, 0xff, 0xff]);

/**
 * @typedef {object} ServerInfo
 * @property {'a2s' | 'a2s-goldsrc' | 'xash-info'} source
 * @property {string} name
 * @property {string} map
 * @property {string} folder
 * @property {string} game
 * @property {number} players
 * @property {number} maxPlayers
 * @property {number | null} bots
 * @property {number | null} protocol
 * @property {string | null} version
 */

/**
 * @typedef {object} PlayerEntry
 * @property {string} name
 * @property {number} score
 * @property {number | null} duration  Время на сервере, секунд (null — неизвестно)
 * @property {boolean} [bot]
 */

// ---------------------------------------------------------------------------
// Чтение бинарных структур
// ---------------------------------------------------------------------------

const utf8 = new TextDecoder('utf-8', { fatal: false });

class Reader {
  /** @param {Buffer} buf @param {number} [offset] */
  constructor(buf, offset = 0) {
    this.buf = buf;
    this.pos = offset;
  }
  get remaining() {
    return this.buf.length - this.pos;
  }
  /** @param {number} n */
  need(n) {
    if (this.pos + n > this.buf.length) throw new RangeError('truncated packet');
  }
  u8() {
    this.need(1);
    return this.buf[this.pos++];
  }
  i16() {
    this.need(2);
    const v = this.buf.readInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  u16() {
    this.need(2);
    const v = this.buf.readUInt16LE(this.pos);
    this.pos += 2;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }
  f32() {
    this.need(4);
    const v = this.buf.readFloatLE(this.pos);
    this.pos += 4;
    return v;
  }
  /** @param {number} n */
  skip(n) {
    this.need(n);
    this.pos += n;
  }
  /** Строка, завершённая нулём. */
  cstr() {
    const end = this.buf.indexOf(0, this.pos);
    if (end < 0) throw new RangeError('unterminated string');
    const s = utf8.decode(this.buf.subarray(this.pos, end));
    this.pos = end + 1;
    return s;
  }
}

/** @param {Buffer} buf */
function hasOobHeader(buf) {
  return buf.length >= 5 && buf.readInt32LE(0) === -1;
}

// ---------------------------------------------------------------------------
// Построение запросов
// ---------------------------------------------------------------------------

/**
 * A2S_INFO: FF FF FF FF 54 "Source Engine Query\0" [+ 4 байта challenge].
 * @param {Buffer | null} [challenge]
 */
export function buildInfoRequest(challenge = null) {
  /** @type {Buffer[]} */
  const parts = [OOB, Buffer.from([A2S_INFO]), Buffer.from('Source Engine Query\0', 'latin1')];
  if (challenge) parts.push(challenge);
  return Buffer.concat(parts);
}

/**
 * A2S_PLAYER: FF FF FF FF 55 <challenge>; без challenge — FF FF FF FF.
 * @param {Buffer | null} [challenge]
 */
export function buildPlayerRequest(challenge = null) {
  return Buffer.concat([OOB, Buffer.from([A2S_PLAYER]), challenge ?? NO_CHALLENGE]);
}

/**
 * Легаси-запрос Xash3D: FF FF FF FF "info <протокол>\n".
 * @param {number} protocol 49 (Xash3D FWGS) или 48 (старый Xash3D / GoldSrc)
 */
export function buildXashInfoRequest(protocol) {
  return Buffer.concat([OOB, Buffer.from(`info ${protocol}\n`, 'latin1')]);
}

/** GoldSrc: FF FF FF FF "challenge rcon\n". */
export function buildRconChallengeRequest() {
  return Buffer.concat([OOB, Buffer.from('challenge rcon\n', 'latin1')]);
}

/**
 * Экранирование пароля для команды rcon: кавычки и переводы строк недопустимы
 * в токенизаторе движка, поэтому такие пароли не поддерживаются.
 * @param {string} password
 */
export function isRconPasswordUsable(password) {
  return password !== '' && !/["\r\n\0]/.test(password) && Buffer.byteLength(password) <= 127;
}

/**
 * GoldSrc: FF FF FF FF rcon <challenge> "<пароль>" <команда>\n
 * Xash3D (challenge = null): FF FF FF FF rcon "<пароль>" <команда>\n
 * @param {string | null} challenge
 * @param {string} password
 * @param {string} command
 */
export function buildRconCommand(challenge, password, command) {
  if (!isRconPasswordUsable(password)) throw new Error('unusable rcon password');
  const body = challenge === null ? `rcon "${password}" ${command}\n` : `rcon ${challenge} "${password}" ${command}\n`;
  return Buffer.concat([OOB, Buffer.from(body, 'utf8')]);
}

// ---------------------------------------------------------------------------
// Разбор ответов
// ---------------------------------------------------------------------------

/**
 * S2C_CHALLENGE: FF FF FF FF 41 <4 байта>. Возвращает 4 байта challenge или null.
 * @param {Buffer} buf
 */
export function parseChallenge(buf) {
  if (!hasOobHeader(buf) || buf[4] !== S2C_CHALLENGE || buf.length < 9) return null;
  return Buffer.from(buf.subarray(5, 9));
}

/** @param {Buffer} buf */
export function isA2sInfoReply(buf) {
  return hasOobHeader(buf) && (buf[4] === S2A_INFO_SRC || buf[4] === S2A_INFO_GOLDSRC);
}

/** @param {Buffer} buf */
export function isChallengeReply(buf) {
  return parseChallenge(buf) !== null;
}

/**
 * Разбор ответа A2S_INFO (Source 'I' или GoldSrc 'm').
 * @param {Buffer} buf
 * @returns {ServerInfo | null}
 */
export function parseInfoResponse(buf) {
  if (!isA2sInfoReply(buf)) return null;
  try {
    const r = new Reader(buf, 5);
    if (buf[4] === S2A_INFO_SRC) {
      const protocol = r.u8();
      const name = r.cstr();
      const map = r.cstr();
      const folder = r.cstr();
      const game = r.cstr();
      const appId = r.u16();
      const players = r.u8();
      const maxPlayers = r.u8();
      const bots = r.u8();
      /** @type {string | null} */
      let version = null;
      // Дальше: server type, environment, visibility, VAC, [The Ship], version, EDF — необязательны для нас.
      try {
        r.skip(4);
        if (appId === 2400) r.skip(3);
        version = r.cstr();
      } catch {
        /* усечённый хвост — не страшно */
      }
      return { source: 'a2s', name, map, folder, game, players, maxPlayers, bots, protocol, version };
    }
    // GoldSrc 'm'
    r.cstr(); // address
    const name = r.cstr();
    const map = r.cstr();
    const folder = r.cstr();
    const game = r.cstr();
    const players = r.u8();
    const maxPlayers = r.u8();
    const protocol = r.u8();
    /** @type {number | null} */
    let bots = null;
    try {
      r.skip(3); // server type, environment, visibility
      const mod = r.u8();
      if (mod === 1) {
        r.cstr(); // link
        r.cstr(); // download link
        r.skip(1); // NULL
        r.skip(4 + 4 + 1 + 1); // version, size, type, dll
      }
      r.skip(1); // VAC
      bots = r.u8();
    } catch {
      /* усечённый хвост */
    }
    return { source: 'a2s-goldsrc', name, map, folder, game, players, maxPlayers, bots, protocol, version: null };
  } catch {
    return null;
  }
}

/**
 * Разбор infostring "\key\value\key\value".
 * @param {string} s
 * @returns {Record<string, string>}
 */
export function parseInfostring(s) {
  /** @type {Record<string, string>} */
  const out = {};
  const parts = s.replace(/[\r\n\0]+$/, '').split('\\');
  // Строка начинается с '\', поэтому parts[0] пустой.
  for (let i = parts[0] === '' ? 1 : 0; i + 1 < parts.length; i += 2) {
    out[parts[i]] = parts[i + 1];
  }
  return out;
}

/** @param {Buffer} buf */
export function isXashInfoReply(buf) {
  return hasOobHeader(buf) && buf.subarray(4, 9).toString('latin1') === 'info\n';
}

/**
 * Ответ Xash3D на "info <протокол>": FF FF FF FF "info\n\p\49\map\de_dust2\...".
 * При несовпадении протокола сервер отвечает "info\n<host>: wrong version\n".
 * @param {Buffer} buf
 * @returns {ServerInfo | { wrongVersion: true } | null}
 */
export function parseXashInfoResponse(buf) {
  if (!isXashInfoReply(buf)) return null;
  const text = utf8.decode(buf.subarray(9));
  if (!text.startsWith('\\')) {
    return /wrong version/i.test(text) ? { wrongVersion: true } : null;
  }
  const kv = parseInfostring(text);
  if (kv.map === undefined) return null;
  const num = (/** @type {string | undefined} */ v) => {
    const n = Number(v);
    return v !== undefined && v !== '' && Number.isFinite(n) ? n : null;
  };
  return {
    source: 'xash-info',
    name: kv.host ?? '',
    map: kv.map,
    folder: kv.gamedir ?? '',
    game: kv.gamedir ?? '',
    players: num(kv.numcl) ?? 0,
    maxPlayers: num(kv.maxcl) ?? 0,
    bots: null,
    protocol: num(kv.p),
    version: null,
  };
}

/** @param {Buffer} buf */
export function isPlayerReply(buf) {
  return hasOobHeader(buf) && buf[4] === S2A_PLAYER;
}

/**
 * Ответ A2S_PLAYER: FF FF FF FF 44 <count> { index u8, name cstr, score i32, duration f32 }*.
 * @param {Buffer} buf
 * @returns {PlayerEntry[] | null}
 */
export function parsePlayerResponse(buf) {
  if (!isPlayerReply(buf)) return null;
  try {
    const r = new Reader(buf, 5);
    const count = r.u8();
    /** @type {PlayerEntry[]} */
    const list = [];
    for (let i = 0; i < count && r.remaining > 0; i++) {
      r.u8(); // index
      const name = r.cstr();
      const score = r.i32();
      const dur = r.f32();
      list.push({ name, score, duration: Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : null });
    }
    return list;
  } catch {
    return null;
  }
}

/**
 * Ответ HLDS на "challenge rcon": FF FF FF FF "challenge rcon 123456\n".
 * @param {Buffer} buf
 * @returns {string | null}
 */
export function parseRconChallenge(buf) {
  if (!hasOobHeader(buf)) return null;
  const m = /^challenge rcon (\d+)/.exec(buf.subarray(4).toString('latin1'));
  return m ? m[1] : null;
}

/**
 * Текст ответа на rcon: HLDS — FF FF FF FF 'l' <текст>; Xash3D — FF FF FF FF "print\n" <текст>.
 * @param {Buffer} buf
 * @returns {string | null}
 */
export function parseRconText(buf) {
  if (!hasOobHeader(buf)) return null;
  const body = buf.subarray(4);
  let text;
  if (body.subarray(0, 6).toString('latin1') === 'print\n') text = utf8.decode(body.subarray(6));
  else if (body[0] === S2A_LOG) text = utf8.decode(body.subarray(1));
  else return null;
  return text.replace(/\0+$/, '');
}

/**
 * "12:34" / "1:02:03" → секунды.
 * @param {string} s
 */
function hmsToSeconds(s) {
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/**
 * Разбор вывода команды status. Понимает таблицу HLDS ("# 1 "name" userid uniqueid frag time ...")
 * и таблицу Xash3D FWGS ("num score ping name lastmsg address port").
 * @param {string} text
 * @returns {{ map: string | null, players: PlayerEntry[], badPassword: boolean }}
 */
export function parseStatus(text) {
  const lines = text.split(/\r?\n/);
  /** @type {PlayerEntry[]} */
  const players = [];
  /** @type {string | null} */
  let map = null;
  let xashTable = false;
  const badPassword = /bad rcon/i.test(text);
  for (const raw of lines) {
    const line = raw.replace(/\^\d/g, ''); // цветовые коды Xash3D (^1, ^7 ...)
    const mm = /^\s*map\s*:\s*(\S+)/.exec(line);
    if (mm && map === null) {
      map = mm[1];
      continue;
    }
    if (/^\s*num\s+score\s+ping\s+name/i.test(line)) {
      xashTable = true;
      continue;
    }
    const hl = /^#\s*\d+\s+"(.*)"\s+-?\d+\s+(\S+)\s+(-?\d+)\s+(\d+(?::\d+){1,2})\b/.exec(line);
    if (hl) {
      const bot = hl[2].toUpperCase() === 'BOT';
      players.push({ name: hl[1], score: Number(hl[3]), duration: hmsToSeconds(hl[4]), bot });
      continue;
    }
    if (xashTable) {
      if (/^\s*-{3}/.test(line) || line.trim() === '') continue;
      const xm = /^\s*(\d+)\s+(-?\d+)\s+(Connect|Zombie|Bot|\d+)\s*(.+?)\s+(\S+)\s+(\S+)\s+(\d+)\s*$/.exec(line);
      if (xm) {
        players.push({ name: xm[4].trim(), score: Number(xm[2]), duration: null, bot: xm[3] === 'Bot' });
      }
    }
  }
  return { map, players, badPassword };
}

// ---------------------------------------------------------------------------
// UDP-сессия
// ---------------------------------------------------------------------------

/**
 * Обмен датаграммами с одним адресом. Принимает только пакеты от этого адреса,
 * собирает разбитые GoldSrc-пакеты (FE FF FF FF).
 */
export class UdpSession {
  /**
   * @param {string} host
   * @param {number} port
   * @param {{ lookupTimeoutMs?: number }} [opts]
   */
  static async open(host, port, opts = {}) {
    const { address, family } = await withTimeout(dns.promises.lookup(host), opts.lookupTimeoutMs ?? 1500, 'dns timeout');
    const socket = dgram.createSocket(family === 6 ? 'udp6' : 'udp4');
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(0, () => {
        socket.off('error', reject);
        resolve(undefined);
      });
    });
    return new UdpSession(socket, address, port);
  }

  /**
   * @param {dgram.Socket} socket
   * @param {string} address
   * @param {number} port
   */
  constructor(socket, address, port) {
    this.socket = socket;
    this.address = address;
    this.port = port;
    /** @type {Buffer[]} */
    this.queue = [];
    /** @type {{ accept: (b: Buffer) => boolean, done: (b: Buffer | null) => void } | null} */
    this.waiter = null;
    /** @type {Map<number, { total: number, parts: (Buffer | undefined)[], at: number }>} */
    this.splits = new Map();
    this.closed = false;
    socket.on('message', (msg, rinfo) => {
      if (rinfo.port !== this.port || !sameAddress(rinfo.address, this.address)) return;
      try {
        const full = this.reassemble(msg);
        if (!full) return;
        if (this.waiter) {
          if (this.waiter.accept(full)) this.waiter.done(full);
          // неподходящий пакет при активном ожидании отбрасываем
        } else if (this.queue.length < 64) {
          this.queue.push(full);
        }
      } catch {
        /* битый пакет — игнорируем */
      }
    });
    socket.on('error', () => {
      /* ICMP unreachable и т.п. — просто ждём таймаута */
    });
  }

  /** @param {Buffer} msg */
  reassemble(msg) {
    if (msg.length < 9 || msg.readInt32LE(0) !== SPLIT) return msg;
    // GoldSrc: FE FF FF FF <id i32> <номер<<4 | всего> <данные>
    const id = msg.readInt32LE(4);
    const b = msg[8];
    const index = b >> 4;
    const total = b & 0x0f;
    if (total === 0 || index >= total) return null;
    const now = Date.now();
    for (const [k, v] of this.splits) if (now - v.at > 5000) this.splits.delete(k);
    let entry = this.splits.get(id);
    if (!entry || entry.total !== total) {
      // Array.from, а не new Array(n): у разреженного массива some() пропускает дыры.
      entry = { total, parts: Array.from({ length: total }, () => undefined), at: now };
      this.splits.set(id, entry);
    }
    entry.parts[index] = Buffer.from(msg.subarray(9));
    if (entry.parts.some((p) => p === undefined)) return null;
    this.splits.delete(id);
    return Buffer.concat(/** @type {Buffer[]} */ (entry.parts));
  }

  /** @param {Buffer} buf */
  send(buf) {
    if (this.closed) return;
    this.socket.send(buf, this.port, this.address, () => {
      /* ошибки отправки игнорируем: результат определит таймаут */
    });
  }

  /**
   * Ждёт следующий подходящий пакет. Неподходящие пакеты отбрасываются.
   * @param {number} timeoutMs
   * @param {(b: Buffer) => boolean} [accept]
   * @returns {Promise<Buffer | null>}
   */
  next(timeoutMs, accept = () => true) {
    while (this.queue.length > 0) {
      const b = /** @type {Buffer} */ (this.queue.shift());
      if (accept(b)) return Promise.resolve(b);
    }
    if (this.closed || timeoutMs <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      const done = (/** @type {Buffer | null} */ b) => {
        clearTimeout(timer);
        this.waiter = null;
        resolve(b);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      this.waiter = { accept, done };
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.waiter) this.waiter.done(null);
    try {
      this.socket.close();
    } catch {
      /* уже закрыт */
    }
  }
}

/** @param {string} a @param {string} b */
function sameAddress(a, b) {
  const strip = (/** @type {string} */ s) => s.replace(/^::ffff:/, '');
  return strip(a) === strip(b);
}

/**
 * @template T
 * @param {Promise<T>} p
 * @param {number} ms
 * @param {string} message
 * @returns {Promise<T>}
 */
function withTimeout(p, ms, message) {
  /** @type {NodeJS.Timeout | undefined} */
  let t;
  return Promise.race([
    p.finally(() => clearTimeout(t)),
    new Promise((_, reject) => {
      t = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Запросы поверх сессии
// ---------------------------------------------------------------------------

/**
 * A2S_INFO с поддержкой challenge.
 * @param {UdpSession} s
 * @param {number} timeoutMs
 * @returns {Promise<ServerInfo | null>}
 */
export async function queryA2sInfo(s, timeoutMs) {
  /** @type {Buffer | null} */
  let challenge = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    s.send(buildInfoRequest(challenge));
    const reply = await s.next(timeoutMs, (b) => isA2sInfoReply(b) || isChallengeReply(b));
    if (!reply) return null;
    const ch = parseChallenge(reply);
    if (ch) {
      challenge = ch;
      continue;
    }
    const info = parseInfoResponse(reply);
    if (info) return info;
  }
  return null;
}

/**
 * Легаси-запрос Xash3D: сначала "info 49", при ответе "wrong version" или молчании — "info 48".
 * После молчания на 49 второй попытке даётся половина таймаута: сервер, который вообще
 * не отвечает, не должен задерживать цикл опроса.
 * @param {UdpSession} s
 * @param {number} timeoutMs
 * @param {number[]} [protocols]
 * @returns {Promise<ServerInfo | null>}
 */
export async function queryXashInfo(s, timeoutMs, protocols = [49, 48]) {
  let budget = timeoutMs;
  for (const p of protocols) {
    s.send(buildXashInfoRequest(p));
    const deadline = Date.now() + budget;
    let answered = false;
    for (;;) {
      const reply = await s.next(deadline - Date.now(), (b) => isXashInfoReply(b) || isA2sInfoReply(b));
      if (!reply) break;
      const a2s = parseInfoResponse(reply); // запоздавший ответ на A2S_INFO тоже годится
      if (a2s) return a2s;
      const r = parseXashInfoResponse(reply);
      if (r && 'wrongVersion' in r) {
        answered = true;
        break;
      }
      if (r) return r;
    }
    budget = answered ? timeoutMs : Math.max(200, Math.floor(timeoutMs / 2));
  }
  return null;
}

/**
 * A2S_PLAYER с поддержкой challenge.
 * @param {UdpSession} s
 * @param {number} timeoutMs
 * @returns {Promise<PlayerEntry[] | null>}
 */
export async function queryA2sPlayers(s, timeoutMs) {
  /** @type {Buffer | null} */
  let challenge = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    s.send(buildPlayerRequest(challenge));
    const reply = await s.next(timeoutMs, (b) => isPlayerReply(b) || isChallengeReply(b));
    if (!reply) return null;
    const ch = parseChallenge(reply);
    if (ch) {
      challenge = ch;
      continue;
    }
    return parsePlayerResponse(reply);
  }
  return null;
}

/**
 * Собирает текст ответа на rcon: первый пакет ждём timeoutMs, следующие — до 300 мс.
 * @param {UdpSession} s
 * @param {number} timeoutMs
 */
async function collectRconText(s, timeoutMs) {
  const first = await s.next(timeoutMs, (b) => parseRconText(b) !== null);
  if (!first) return null;
  let text = /** @type {string} */ (parseRconText(first));
  for (;;) {
    const more = await s.next(300, (b) => parseRconText(b) !== null);
    if (!more) break;
    text += /** @type {string} */ (parseRconText(more));
  }
  return text;
}

/**
 * @typedef {'goldsrc' | 'xash'} RconMode
 */

/**
 * Выполняет "status" через rcon и разбирает таблицу игроков.
 * mode: 'goldsrc' — с challenge, 'xash' — без; null — пробуем оба (сначала goldsrc).
 * @param {UdpSession} s
 * @param {string} password
 * @param {number} timeoutMs
 * @param {RconMode | null} [mode]
 * @returns {Promise<{ mode: RconMode, players: PlayerEntry[], map: string | null } | { badPassword: true } | null>}
 */
export async function queryRconStatus(s, password, timeoutMs, mode = null) {
  if (!isRconPasswordUsable(password)) return null;
  /** @type {RconMode[]} */
  const modes = mode ? [mode] : ['goldsrc', 'xash'];
  for (const m of modes) {
    /** @type {string | null} */
    let challenge = null;
    if (m === 'goldsrc') {
      s.send(buildRconChallengeRequest());
      const reply = await s.next(timeoutMs, (b) => parseRconChallenge(b) !== null);
      if (!reply) continue;
      challenge = parseRconChallenge(reply);
    }
    s.send(buildRconCommand(challenge, password, 'status'));
    const text = await collectRconText(s, timeoutMs);
    if (text === null) continue;
    const st = parseStatus(text);
    if (st.badPassword) return { badPassword: true };
    return { mode: m, players: st.players, map: st.map };
  }
  return null;
}
