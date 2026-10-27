// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildInfoRequest,
  buildPlayerRequest,
  buildRconChallengeRequest,
  buildRconCommand,
  buildXashInfoRequest,
  isRconPasswordUsable,
  parseChallenge,
  parseInfoResponse,
  parseInfostring,
  parsePlayerResponse,
  parseRconChallenge,
  parseRconText,
  parseStatus,
  parseXashInfoResponse,
} from '../src/a2s.js';
import {
  HLDS_STATUS,
  XASH_STATUS,
  challengeReply,
  goldsrcInfoReply,
  hldsRconReply,
  playerReply,
  sourceInfoReply,
  xashInfoReply,
  xashPrintReply,
} from './helpers.js';

const hex = (/** @type {Buffer} */ b) => b.toString('hex');

describe('построение запросов', () => {
  it('A2S_INFO без challenge', () => {
    assert.equal(hex(buildInfoRequest()), 'ffffffff54' + Buffer.from('Source Engine Query\0').toString('hex'));
  });
  it('A2S_INFO с challenge дописывает 4 байта', () => {
    const b = buildInfoRequest(Buffer.from([1, 2, 3, 4]));
    assert.equal(b.length, 4 + 1 + 20 + 4);
    assert.equal(hex(b.subarray(-4)), '01020304');
  });
  it('A2S_PLAYER: без challenge — FFFFFFFF', () => {
    assert.equal(hex(buildPlayerRequest()), 'ffffffff55ffffffff');
    assert.equal(hex(buildPlayerRequest(Buffer.from([9, 8, 7, 6]))), 'ffffffff5509080706');
  });
  it('Xash3D info', () => {
    assert.equal(buildXashInfoRequest(49).toString('latin1'), '\xff\xff\xff\xffinfo 49\n');
    assert.equal(buildXashInfoRequest(48).subarray(4).toString(), 'info 48\n');
  });
  it('RCON', () => {
    assert.equal(buildRconChallengeRequest().subarray(4).toString(), 'challenge rcon\n');
    assert.equal(buildRconCommand('123', 'pw', 'status').subarray(4).toString(), 'rcon 123 "pw" status\n');
    assert.equal(buildRconCommand(null, 'pw', 'status').subarray(4).toString(), 'rcon "pw" status\n');
    assert.throws(() => buildRconCommand('1', 'a"b', 'status'));
    assert.equal(isRconPasswordUsable(''), false);
    assert.equal(isRconPasswordUsable('ok-pass_123'), true);
    assert.equal(isRconPasswordUsable('bad\npass'), false);
  });
});

describe('разбор ответов A2S', () => {
  it('S2C_CHALLENGE', () => {
    assert.equal(hex(/** @type {Buffer} */ (parseChallenge(challengeReply(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]))))), 'aabbccdd');
    assert.equal(parseChallenge(Buffer.from('ffffffff41aabb', 'hex')), null); // усечён
    assert.equal(parseChallenge(sourceInfoReply()), null);
  });

  it('Source-формат I (0x49)', () => {
    const info = parseInfoResponse(sourceInfoReply({ name: 'Сервер №1', players: 7, max: 32, bots: 2 }));
    assert.deepEqual(info, {
      source: 'a2s',
      name: 'Сервер №1',
      map: 'de_dust2',
      folder: 'cstrike',
      game: 'Counter-Strike',
      players: 7,
      maxPlayers: 32,
      bots: 2,
      protocol: 48,
      version: '1.1.2.7/Stdio',
    });
  });

  it('Source-формат с усечённым хвостом всё равно разбирается', () => {
    const full = sourceInfoReply();
    const cut = full.subarray(0, full.indexOf(Buffer.from('1.1.2.7')) - 2);
    const info = parseInfoResponse(cut);
    assert.equal(info?.map, 'de_dust2');
    assert.equal(info?.version, null);
  });

  it('GoldSrc-формат m (0x6D), с mod-блоком', () => {
    const info = parseInfoResponse(goldsrcInfoReply({ mod: true, bots: 3 }));
    assert.equal(info?.source, 'a2s-goldsrc');
    assert.equal(info?.name, 'Old Server');
    assert.equal(info?.map, 'cs_office');
    assert.equal(info?.players, 5);
    assert.equal(info?.maxPlayers, 20);
    assert.equal(info?.protocol, 47);
    assert.equal(info?.bots, 3);
  });

  it('GoldSrc-формат без mod и усечённый', () => {
    assert.equal(parseInfoResponse(goldsrcInfoReply({ bots: 4 }))?.bots, 4);
    const t = parseInfoResponse(goldsrcInfoReply({ truncate: true }));
    assert.equal(t?.map, 'cs_office');
    assert.equal(t?.bots, null);
  });

  it('мусор и обрезки не роняют разбор', () => {
    assert.equal(parseInfoResponse(Buffer.alloc(0)), null);
    assert.equal(parseInfoResponse(Buffer.from('ffffffff49', 'hex')), null);
    assert.equal(parseInfoResponse(Buffer.from('ffffffff4930416161', 'hex')), null); // без \0
    assert.equal(parseInfoResponse(Buffer.from('hello world')), null);
    const full = sourceInfoReply();
    for (let n = 0; n < full.length; n++) parseInfoResponse(full.subarray(0, n)); // не бросает
  });

  it('A2S_PLAYER', () => {
    const list = parsePlayerResponse(
      playerReply([
        { name: 'Alice', score: 10, duration: 125.6 },
        { name: 'Боб', score: -2, duration: 33 },
      ]),
    );
    assert.deepEqual(list, [
      { name: 'Alice', score: 10, duration: 126 },
      { name: 'Боб', score: -2, duration: 33 },
    ]);
    assert.deepEqual(parsePlayerResponse(playerReply([])), []);
    assert.equal(parsePlayerResponse(Buffer.from('ffffffff4402004100', 'hex')), null); // усечён
  });
});

describe('Xash3D info', () => {
  it('infostring', () => {
    assert.deepEqual(parseInfostring('\\a\\1\\b\\\\c\\x y\n'), { a: '1', b: '', c: 'x y' });
  });
  it('ответ на info 49', () => {
    const r = parseXashInfoResponse(
      xashInfoReply('\\p\\49\\map\\de_nuke\\dm\\1\\team\\0\\coop\\0\\numcl\\4\\maxcl\\12\\gamedir\\cstrike\\password\\0\\host\\Xash Test'),
    );
    assert.deepEqual(r, {
      source: 'xash-info',
      name: 'Xash Test',
      map: 'de_nuke',
      folder: 'cstrike',
      game: 'cstrike',
      players: 4,
      maxPlayers: 12,
      bots: null,
      protocol: 49,
      version: null,
    });
  });
  it('wrong version', () => {
    assert.deepEqual(parseXashInfoResponse(xashInfoReply('host: wrong version\n')), { wrongVersion: true });
  });
  it('не info-пакет', () => {
    assert.equal(parseXashInfoResponse(sourceInfoReply()), null);
    assert.equal(parseXashInfoResponse(xashInfoReply('\\p\\49')), null); // без map
  });
});

describe('RCON', () => {
  it('challenge', () => {
    assert.equal(parseRconChallenge(Buffer.from('\xff\xff\xff\xffchallenge rcon 1234567\n', 'latin1')), '1234567');
    assert.equal(parseRconChallenge(Buffer.from('\xff\xff\xff\xffchallenge 1\n', 'latin1')), null);
  });
  it('текст ответа HLDS и Xash3D', () => {
    assert.equal(parseRconText(hldsRconReply('hello\n')), 'hello\n');
    assert.equal(parseRconText(xashPrintReply('hi\n')), 'hi\n');
    assert.equal(parseRconText(sourceInfoReply()), null);
  });
  it('таблица status HLDS', () => {
    const st = parseStatus(HLDS_STATUS);
    assert.equal(st.map, 'cs_office');
    assert.equal(st.badPassword, false);
    assert.deepEqual(st.players, [
      { name: 'Игрок "1"', score: 7, duration: 754, bot: false },
      { name: 'Bot Bob', score: -1, duration: 3723, bot: true },
    ]);
  });
  it('таблица status Xash3D FWGS', () => {
    const st = parseStatus(XASH_STATUS);
    assert.equal(st.map, 'de_inferno');
    assert.deepEqual(st.players, [
      { name: 'Player One', score: 12, duration: null, bot: false },
      { name: '[BOT] Ivan', score: 3, duration: null, bot: true },
    ]);
  });
  it('неверный пароль', () => {
    assert.equal(parseStatus('Bad rcon_password.\n').badPassword, true);
  });
});
