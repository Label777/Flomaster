// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RateLimiter, buildIceResponse, makeTurnCredentials, turnCredential } from '../src/turn.js';

describe('TURN REST credentials', () => {
  // Эталон посчитан независимо в shell:
  //   printf '%s' "1700003600:web" | openssl dgst -sha1 -hmac "s3cr3t-turn-key" -binary | base64
  //   → Ki3BAfIjfsYZVXCXHD5UKTfoAYs=
  it('HMAC-SHA1 совпадает с openssl', () => {
    assert.equal(turnCredential('s3cr3t-turn-key', '1700003600:web'), 'Ki3BAfIjfsYZVXCXHD5UKTfoAYs=');
  });

  it('username = expiry:web, expiry = now + ttl', () => {
    const c = makeTurnCredentials({ secret: 's3cr3t-turn-key', ttl: 3600, now: 1_700_000_000_999 });
    assert.equal(c.username, '1700003600:web');
    assert.equal(c.credential, 'Ki3BAfIjfsYZVXCXHD5UKTfoAYs=');
  });

  it('iceServers: STUN + TURN udp/tcp', () => {
    const r = buildIceResponse({ domain: 'cs.example.org', port: 3478, secret: 's3cr3t-turn-key', ttl: 3600 }, 1_700_000_000_000);
    assert.deepEqual(r, {
      ttl: 3600,
      iceServers: [
        { urls: 'stun:cs.example.org:3478' },
        {
          urls: ['turn:cs.example.org:3478?transport=udp', 'turn:cs.example.org:3478?transport=tcp'],
          username: '1700003600:web',
          credential: 'Ki3BAfIjfsYZVXCXHD5UKTfoAYs=',
        },
      ],
    });
  });

  it('без секрета — только STUN, без домена — пусто', () => {
    assert.deepEqual(buildIceResponse({ domain: 'd.example', port: 3478, secret: '', ttl: 60 }).iceServers, [
      { urls: 'stun:d.example:3478' },
    ]);
    assert.deepEqual(buildIceResponse({ domain: '', port: 3478, secret: 'x', ttl: 60 }).iceServers, []);
  });
});

describe('RateLimiter', () => {
  it('30 в минуту, потом 429, потом пополнение', () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 30, windowMs: 60_000, now: () => t });
    for (let i = 0; i < 30; i++) assert.equal(rl.take('1.2.3.4').ok, true, `req ${i}`);
    const denied = rl.take('1.2.3.4');
    assert.equal(denied.ok, false);
    assert.equal(denied.retryAfterSec, 2); // 1 токен = 2 с
    assert.equal(rl.take('5.6.7.8').ok, true, 'другой IP не затронут');
    t += 2000;
    assert.equal(rl.take('1.2.3.4').ok, true);
    assert.equal(rl.take('1.2.3.4').ok, false);
    t += 60_000;
    for (let i = 0; i < 30; i++) assert.equal(rl.take('1.2.3.4').ok, true);
  });

  it('ограничение числа ключей', () => {
    let t = 0;
    const rl = new RateLimiter({ capacity: 2, windowMs: 1000, maxKeys: 3, now: () => t });
    rl.take('a');
    rl.take('b');
    rl.take('c');
    rl.take('d');
    assert.ok(rl.buckets.size <= 3);
    t += 5000;
    rl.sweep();
    assert.equal(rl.buckets.size, 0);
  });
});
