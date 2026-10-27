// @ts-check
/**
 * Вспомогательные функции тестов: сборка ответов сервера и поддельный UDP-сервер.
 */

import dgram from 'node:dgram';

const OOB = Buffer.from([0xff, 0xff, 0xff, 0xff]);

/** @param {string} s */
export const cstr = (s) => Buffer.from(`${s}\0`, 'utf8');
/** @param {number} n */
export const u8 = (n) => Buffer.from([n]);
/** @param {number} n */
export const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
/** @param {number} n */
export const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
};
/** @param {number} n */
export const f32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(n);
  return b;
};

/**
 * Ответ A2S_INFO в формате Source ('I').
 * @param {{ name?: string, map?: string, folder?: string, game?: string, appId?: number, players?: number, max?: number, bots?: number, version?: string }} [o]
 */
export function sourceInfoReply(o = {}) {
  return Buffer.concat([
    OOB,
    u8(0x49),
    u8(48),
    cstr(o.name ?? 'Test Server'),
    cstr(o.map ?? 'de_dust2'),
    cstr(o.folder ?? 'cstrike'),
    cstr(o.game ?? 'Counter-Strike'),
    u16(o.appId ?? 10),
    u8(o.players ?? 3),
    u8(o.max ?? 16),
    u8(o.bots ?? 1),
    u8(0x64), // 'd'
    u8(0x6c), // 'l'
    u8(0),
    u8(1),
    cstr(o.version ?? '1.1.2.7/Stdio'),
    u8(0x80), // EDF: port
    u16(27015),
  ]);
}

/**
 * Ответ A2S_INFO в старом формате GoldSrc ('m').
 * @param {{ mod?: boolean, bots?: number, truncate?: boolean }} [o]
 */
export function goldsrcInfoReply(o = {}) {
  /** @type {Buffer[]} */
  const parts = [
    OOB,
    u8(0x6d),
    cstr('127.0.0.1:27015'),
    cstr('Old Server'),
    cstr('cs_office'),
    cstr('cstrike'),
    cstr('Counter-Strike'),
    u8(5),
    u8(20),
    u8(47),
  ];
  if (!o.truncate) {
    parts.push(u8(0x64), u8(0x6c), u8(0));
    if (o.mod) {
      parts.push(u8(1), cstr('http://example.org'), cstr(''), u8(0), i32(1), i32(184000000), u8(0), u8(1));
    } else {
      parts.push(u8(0));
    }
    parts.push(u8(1), u8(o.bots ?? 2));
  }
  return Buffer.concat(parts);
}

/** @param {Buffer} challenge */
export function challengeReply(challenge) {
  return Buffer.concat([OOB, u8(0x41), challenge]);
}

/** @param {{ name: string, score: number, duration: number }[]} players */
export function playerReply(players) {
  return Buffer.concat([
    OOB,
    u8(0x44),
    u8(players.length),
    ...players.flatMap((p, i) => [u8(i), cstr(p.name), i32(p.score), f32(p.duration)]),
  ]);
}

/** @param {string} infostring */
export function xashInfoReply(infostring) {
  return Buffer.concat([OOB, Buffer.from(`info\n${infostring}`, 'utf8')]);
}

/** @param {string} text */
export function hldsRconReply(text) {
  return Buffer.concat([OOB, u8(0x6c), Buffer.from(text, 'utf8'), u8(0)]);
}

/** @param {string} text */
export function xashPrintReply(text) {
  return Buffer.concat([OOB, Buffer.from(`print\n${text}`, 'utf8')]);
}

export const HLDS_STATUS = [
  'hostname:  Old Server',
  'version :  48/1.1.2.7/Stdio 8684 secure  (10)',
  'tcp/ip  :  127.0.0.1:27015',
  'map     :  cs_office at: 0 x, 0 y, 0 z',
  'players :  2 active (20 max)',
  '',
  '#      name userid uniqueid frag time ping loss adr',
  '# 1 "Игрок "1"" 1 STEAM_0:1:1234 7 12:34 50 0 10.0.0.2:27005',
  '# 2 "Bot Bob" 2 BOT -1 1:02:03 0 0',
  '2 users',
  '',
].join('\n');

export const XASH_STATUS = [
  'map: de_inferno',
  'num score ping    name            lastmsg address               port ',
  '--- ----- ------- --------------- ------- --------------------- ------',
  '  0    12      45 Player One              0.05 127.0.0.1             27005',
  '  1     3 Bot    [BOT] Ivan               0 loopback                  0',
  '',
].join('\n');

/**
 * @typedef {object} FakeOptions
 * @property {'a2s' | 'goldsrc' | 'xash49' | 'xash48' | 'silent'} mode
 * @property {boolean} [infoChallenge]     Требовать challenge для A2S_INFO
 * @property {boolean} [players]           Отвечать на A2S_PLAYER
 * @property {string} [rconPassword]       Отвечать на rcon (HLDS-стиль для goldsrc, Xash-стиль для xash*)
 * @property {boolean} [split]             Отдавать ответ на A2S_INFO двумя split-пакетами
 */

/**
 * Поддельный игровой сервер на 127.0.0.1.
 * @param {FakeOptions} opts
 */
export async function startFakeServer(opts) {
  const sock = dgram.createSocket('udp4');
  const challenge = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const rconChallenge = '987654321';
  /** @type {string[]} */
  const received = [];
  sock.on('message', (msg, rinfo) => {
    const reply = (/** @type {Buffer} */ b) => sock.send(b, rinfo.port, rinfo.address);
    if (msg.length < 5 || msg.readInt32LE(0) !== -1) return;
    const body = msg.subarray(4);
    const text = body.toString('latin1');
    received.push(text.startsWith('rcon') ? 'rcon' : body[0] === 0x54 ? 'A2S_INFO' : body[0] === 0x55 ? 'A2S_PLAYER' : text.trim());
    if (opts.mode === 'silent') return;

    // A2S_INFO
    if (body[0] === 0x54 && (opts.mode === 'a2s' || opts.mode === 'goldsrc')) {
      const tail = body.subarray(1 + 'Source Engine Query\0'.length);
      if (opts.infoChallenge && !tail.equals(challenge)) {
        reply(challengeReply(challenge));
        return;
      }
      const full = opts.mode === 'a2s' ? sourceInfoReply() : goldsrcInfoReply({ mod: true });
      if (opts.split) {
        const mid = Math.floor(full.length / 2);
        const hdr = (/** @type {number} */ idx) => Buffer.concat([i32(-2), i32(77), u8((idx << 4) | 2)]);
        // второй кусок первым — проверяем сборку вне порядка
        reply(Buffer.concat([hdr(1), full.subarray(mid)]));
        reply(Buffer.concat([hdr(0), full.subarray(0, mid)]));
      } else {
        reply(full);
      }
      return;
    }
    // A2S_PLAYER
    if (body[0] === 0x55 && opts.players && opts.mode !== 'xash49' && opts.mode !== 'xash48') {
      const ch = body.subarray(1, 5);
      if (!ch.equals(challenge)) {
        reply(challengeReply(challenge));
        return;
      }
      reply(
        playerReply([
          { name: 'Alice', score: 10, duration: 125.6 },
          { name: 'Боб', score: -2, duration: 33 },
        ]),
      );
      return;
    }
    // Xash3D info
    const im = /^info (\d+)\n$/.exec(text);
    if (im && (opts.mode === 'xash49' || opts.mode === 'xash48')) {
      const want = opts.mode === 'xash49' ? '49' : '48';
      if (im[1] !== want) {
        reply(Buffer.concat([OOB, Buffer.from('info\nTest Xash: wrong version\n')]));
        return;
      }
      reply(
        xashInfoReply(
          `\\p\\${want}\\map\\de_nuke\\dm\\1\\team\\0\\coop\\0\\numcl\\4\\maxcl\\12\\gamedir\\cstrike\\password\\0\\host\\Xash Test`,
        ),
      );
      return;
    }
    // RCON
    if (opts.rconPassword !== undefined) {
      if (text === 'challenge rcon\n' && opts.mode === 'goldsrc') {
        reply(Buffer.concat([OOB, Buffer.from(`challenge rcon ${rconChallenge}\n`)]));
        return;
      }
      const hl = /^rcon (\d+) "(.*)" status\n$/.exec(text);
      if (hl && opts.mode === 'goldsrc') {
        if (hl[1] !== rconChallenge || hl[2] !== opts.rconPassword) reply(hldsRconReply('Bad rcon_password.\n'));
        else {
          // ответ в двух пакетах
          const mid = HLDS_STATUS.indexOf('#      name');
          reply(hldsRconReply(HLDS_STATUS.slice(0, mid)));
          setTimeout(() => reply(hldsRconReply(HLDS_STATUS.slice(mid))), 20);
        }
        return;
      }
      const xr = /^rcon "(.*)" status\n$/.exec(Buffer.from(body).toString('utf8'));
      if (xr && (opts.mode === 'xash49' || opts.mode === 'xash48')) {
        reply(xashPrintReply(xr[1] === opts.rconPassword ? XASH_STATUS : 'Bad rcon_password.\n'));
      }
    }
  });
  await new Promise((r) => sock.bind(0, '127.0.0.1', () => r(undefined)));
  const addr = sock.address();
  return {
    port: addr.port,
    received,
    close: () => new Promise((r) => sock.close(() => r(undefined))),
  };
}
