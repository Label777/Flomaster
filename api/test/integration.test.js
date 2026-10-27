// @ts-check
/**
 * Интеграционные тесты: поддельный игровой сервер (dgram на 127.0.0.1), проба статуса,
 * фоновый опрос и HTTP-эндпоинты.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { startServer } from '../src/server.js';
import { silentLogger } from '../src/log.js';
import { StatusPoller, probeServer } from '../src/status.js';
import { startFakeServer } from './helpers.js';

/** @typedef {import('../src/config.js').ServerDef} ServerDef */

/**
 * @param {number} port
 * @param {Partial<ServerDef>} [o]
 * @returns {ServerDef}
 */
function def(port, o = {}) {
  return {
    id: 'main',
    name: 'Test',
    queryHost: '127.0.0.1',
    queryPort: port,
    httpHealthUrl: null,
    signalPath: '/websocket',
    signalUrl: '/rtc/main/websocket',
    maxPlayers: null,
    rconPassword: '',
    ...o,
  };
}

const fast = { infoTimeoutMs: 300, playerTimeoutMs: 300, httpTimeoutMs: 500 };

describe('probeServer с поддельным UDP-сервером', () => {
  it('A2S (Source) с challenge + A2S_PLAYER', async () => {
    const fake = await startFakeServer({ mode: 'a2s', infoChallenge: true, players: true });
    try {
      const r = await probeServer(def(fake.port), fast);
      assert.equal(r.status, 'online');
      assert.equal(r.via, 'a2s');
      assert.equal(r.map, 'de_dust2');
      assert.equal(r.players, 3);
      assert.equal(r.maxPlayers, 16);
      assert.equal(r.bots, 1);
      assert.equal(r.playersVia, 'a2s');
      assert.deepEqual(r.playerList, [
        { name: 'Alice', score: 10, duration: 126 },
        { name: 'Боб', score: -2, duration: 33 },
      ]);
      assert.deepEqual(fake.received.slice(0, 4), ['A2S_INFO', 'A2S_INFO', 'A2S_PLAYER', 'A2S_PLAYER']);
    } finally {
      await fake.close();
    }
  });

  it('GoldSrc m, разбитый на split-пакеты; игроки через RCON (HLDS challenge)', async () => {
    const fake = await startFakeServer({ mode: 'goldsrc', split: true, players: false, rconPassword: 'pw' });
    try {
      const r = await probeServer(def(fake.port, { rconPassword: 'pw' }), fast);
      assert.equal(r.status, 'online');
      assert.equal(r.via, 'a2s-goldsrc');
      assert.equal(r.map, 'cs_office');
      assert.equal(r.players, 5);
      assert.equal(r.playersVia, 'rcon');
      assert.equal(r.rconMode, 'goldsrc');
      assert.deepEqual(r.playerList, [
        { name: 'Игрок "1"', score: 7, duration: 754 },
        { name: 'Bot Bob', score: -1, duration: 3723 },
      ]);
    } finally {
      await fake.close();
    }
  });

  it('Xash3D info 49 (на A2S молчит), RCON в стиле Xash', async () => {
    const fake = await startFakeServer({ mode: 'xash49', rconPassword: 'pw' });
    try {
      const r = await probeServer(def(fake.port, { rconPassword: 'pw' }), fast);
      assert.equal(r.status, 'online');
      assert.equal(r.via, 'xash-info');
      assert.equal(r.map, 'de_nuke');
      assert.equal(r.players, 4);
      assert.equal(r.maxPlayers, 12);
      assert.equal(r.rconMode, 'xash');
      assert.equal(r.bots, 1);
      assert.deepEqual(r.playerList?.map((p) => p.name), ['Player One', '[BOT] Ivan']);
      assert.ok(fake.received.includes('info 49'));
    } finally {
      await fake.close();
    }
  });

  it('Xash3D: 49 → wrong version → 48', async () => {
    const fake = await startFakeServer({ mode: 'xash48' });
    try {
      const r = await probeServer(def(fake.port), fast);
      assert.equal(r.status, 'online');
      assert.equal(r.via, 'xash-info');
      assert.equal(r.map, 'de_nuke');
      assert.equal(r.playerList, null);
      assert.deepEqual(
        fake.received.filter((x) => x.startsWith('info')),
        ['info 49', 'info 48'],
      );
    } finally {
      await fake.close();
    }
  });

  it('UDP молчит, HTTP отвечает → online без карты', async () => {
    const fake = await startFakeServer({ mode: 'silent' });
    const httpSrv = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    await new Promise((r) => httpSrv.listen(0, '127.0.0.1', () => r(undefined)));
    const addr = /** @type {import('node:net').AddressInfo} */ (httpSrv.address());
    try {
      const r = await probeServer(def(fake.port, { httpHealthUrl: `http://127.0.0.1:${addr.port}/` }), fast);
      assert.equal(r.status, 'online');
      assert.equal(r.via, 'http');
      assert.equal(r.map, null);
      assert.equal(r.players, null);
    } finally {
      await fake.close();
      await new Promise((r) => httpSrv.close(() => r(undefined)));
    }
  });

  it('ничего не отвечает → offline; неразрешимый хост → offline', async () => {
    const fake = await startFakeServer({ mode: 'silent' });
    try {
      const r = await probeServer(def(fake.port, { httpHealthUrl: 'http://127.0.0.1:1/' }), fast);
      assert.equal(r.status, 'offline');
      const r2 = await probeServer(
        def(27018, { queryHost: 'no-such-host.invalid', httpHealthUrl: 'http://no-such-host.invalid:27016/' }),
        fast,
      );
      assert.equal(r2.status, 'offline');
    } finally {
      await fake.close();
    }
  });
});

describe('StatusPoller', () => {
  it('кэш обновляется в фоне, ошибки пробы не роняют цикл', async () => {
    let calls = 0;
    /** @type {typeof probeServer} */
    const probe = async () => {
      calls++;
      if (calls === 1) throw new Error('boom');
      return {
        status: 'online',
        via: 'a2s',
        map: 'de_train',
        players: 1,
        maxPlayers: 10,
        bots: 0,
        playerList: [{ name: 'x', score: 1, duration: 2 }],
        playersVia: 'a2s',
        rconMode: null,
      };
    };
    const p = new StatusPoller([def(1)], { intervalMs: 50, log: silentLogger, probe });
    assert.equal(p.list()[0].status, 'unknown');
    p.start();
    const deadline = Date.now() + 2000;
    while (p.list()[0].status !== 'online' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 10));
    await p.stop();
    assert.ok(calls >= 2);
    assert.equal(p.list()[0].map, 'de_train');
    assert.deepEqual(p.get('main')?.playerList, [{ name: 'x', score: 1, duration: 2 }]);
    assert.equal(p.get('nope'), null);
  });
});

describe('HTTP API', () => {
  /** @type {Awaited<ReturnType<typeof startServer>>} */
  let app;
  /** @type {Awaited<ReturnType<typeof startFakeServer>>} */
  let fake;
  let base = '';

  before(async () => {
    fake = await startFakeServer({ mode: 'a2s', players: true });
    app = await startServer({
      log: silentLogger,
      env: {
        PORT: '0',
        POLL_INTERVAL_MS: '500',
        DOMAIN: 'cs.example.org',
        TURN_PORT: '3478',
        TURN_SECRET: 'secret',
        TURN_TTL: '600',
        ICE_RATE_PER_MIN: '5',
        SERVERS_JSON: JSON.stringify([
          { id: 'main', name: 'Main', queryHost: '127.0.0.1', queryPort: fake.port, signalPath: '/websocket' },
          { id: 'dead', name: 'Dead', queryHost: 'no-such-host.invalid', queryPort: 27018, httpHealthUrl: null },
        ]),
      },
    });
    const addr = /** @type {import('node:net').AddressInfo} */ (app.server.address());
    base = `http://127.0.0.1:${addr.port}`;
    const deadline = Date.now() + 5000;
    while (app.poller.list().some((s) => s.status === 'unknown') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  after(async () => {
    await app.close();
    await fake.close();
  });

  it('GET /api/health → 204, no-store', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(await res.text(), '');
  });

  it('GET /api/servers', async () => {
    const res = await fetch(`${base}/api/servers`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(String(res.headers.get('content-type')), /^application\/json/);
    const body = await res.json();
    assert.equal(body.servers.length, 2);
    const [main] = body.servers;
    assert.deepEqual(Object.keys(main).sort(), [
      'bots',
      'id',
      'map',
      'maxPlayers',
      'name',
      'players',
      'signalUrl',
      'status',
      'updatedAt',
    ]);
    assert.equal(main.status, 'online');
    assert.equal(main.map, 'de_dust2');
    assert.equal(main.signalUrl, '/rtc/main/websocket');
    assert.ok(!Number.isNaN(Date.parse(main.updatedAt)));
    assert.ok(!('playerList' in main));
  });

  it('GET /api/servers/:id добавляет playerList; неизвестный id → 404 JSON', async () => {
    const res = await fetch(`${base}/api/servers/main`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, 'main');
    assert.deepEqual(body.playerList, [
      { name: 'Alice', score: 10, duration: 126 },
      { name: 'Боб', score: -2, duration: 33 },
    ]);
    const nf = await fetch(`${base}/api/servers/zzz`);
    assert.equal(nf.status, 404);
    assert.equal((await nf.json()).error, 'not_found');
  });

  it('неизвестный маршрут → 404 JSON; POST → 405; HEAD без тела', async () => {
    const nf = await fetch(`${base}/nope`);
    assert.equal(nf.status, 404);
    assert.equal(nf.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await nf.json(), { error: 'not_found' });
    const post = await fetch(`${base}/api/servers`, { method: 'POST', body: 'x' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    const head = await fetch(`${base}/api/servers`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });

  it('GET /api/ice и ограничение частоты по X-Forwarded-For', async () => {
    const res = await fetch(`${base}/api/ice`, { headers: { 'x-forwarded-for': '198.51.100.7' } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ttl, 600);
    assert.equal(body.iceServers[0].urls, 'stun:cs.example.org:3478');
    assert.match(body.iceServers[1].username, /^\d+:web$/);
    const expiry = Number(body.iceServers[1].username.split(':')[0]);
    assert.ok(Math.abs(expiry - (Math.floor(Date.now() / 1000) + 600)) <= 2);
    for (let i = 0; i < 4; i++) {
      assert.equal((await fetch(`${base}/api/ice`, { headers: { 'x-forwarded-for': '198.51.100.7' } })).status, 200);
    }
    const limited = await fetch(`${base}/api/ice`, { headers: { 'x-forwarded-for': '198.51.100.7' } });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) >= 1);
    const other = await fetch(`${base}/api/ice`, { headers: { 'x-forwarded-for': '198.51.100.8' } });
    assert.equal(other.status, 200);
  });

  it('ответы мгновенные — сеть не ждём', async () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) await (await fetch(`${base}/api/servers`)).arrayBuffer();
    const avg = (performance.now() - t0) / 20;
    assert.ok(avg < 50, `среднее ${avg.toFixed(1)} мс`);
    const dead = await (await fetch(`${base}/api/servers/dead`)).json();
    assert.equal(dead.status, 'offline');
  });
});
