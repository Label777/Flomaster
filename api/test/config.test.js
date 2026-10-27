// @ts-check
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigError, loadConfig, redactConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('сервер по умолчанию из переменных окружения', () => {
    const c = loadConfig({
      SERVER_NAME: 'CS 1.6 Web',
      GAME_PORT: '27018',
      CS_SIGNAL_PATH: '/websocket',
      DOMAIN: 'cs.example.org',
      TURN_PORT: '3478',
      TURN_SECRET: 'sec',
      TURN_TTL: '3600',
      RCON_PASSWORD: 'pw',
    });
    assert.equal(c.port, 8080);
    assert.equal(c.pollIntervalMs, 5000);
    assert.equal(c.iceRatePerMin, 30);
    assert.deepEqual(c.servers, [
      {
        id: 'main',
        name: 'CS 1.6 Web',
        queryHost: 'cs-server',
        queryPort: 27018,
        httpHealthUrl: 'http://cs-server:27016/',
        signalPath: '/websocket',
        signalUrl: '/rtc/main/websocket',
        maxPlayers: null,
        rconPassword: 'pw',
      },
    ]);
    assert.deepEqual(c.turn, { domain: 'cs.example.org', port: 3478, secret: 'sec', ttl: 3600 });
  });

  it('GAME_QUERY_PORT важнее GAME_PORT; путь без слэша нормализуется', () => {
    const c = loadConfig({ GAME_PORT: '27018', GAME_QUERY_PORT: '27015', CS_SIGNAL_PATH: 'ws' });
    assert.equal(c.servers[0].queryPort, 27015);
    assert.equal(c.servers[0].signalUrl, '/rtc/main/ws');
  });

  it('SERVERS_JSON', () => {
    const c = loadConfig({
      CS_SIGNAL_PATH: '/websocket',
      RCON_PASSWORD: 'global',
      SERVERS_JSON: JSON.stringify([
        { id: 'main', name: 'A', queryHost: 'cs-server', queryPort: 27018, httpHealthUrl: 'http://cs-server:27016/' },
        { id: 'dm-2', name: 'B', queryHost: '10.0.0.5', queryPort: '27020', signalPath: '/signal', rconPassword: '' },
      ]),
    });
    assert.equal(c.servers.length, 2);
    assert.equal(c.servers[0].signalUrl, '/rtc/main/websocket');
    assert.equal(c.servers[0].rconPassword, 'global');
    assert.equal(c.servers[1].signalUrl, '/rtc/dm-2/signal');
    assert.equal(c.servers[1].queryPort, 27020);
    assert.equal(c.servers[1].httpHealthUrl, null);
    assert.equal(c.servers[1].rconPassword, '');
  });

  it('ошибки конфигурации', () => {
    assert.throws(() => loadConfig({ SERVERS_JSON: '{' }), ConfigError);
    assert.throws(() => loadConfig({ SERVERS_JSON: '[]' }), ConfigError);
    assert.throws(() => loadConfig({ SERVERS_JSON: '[{"id":"Bad Id","queryHost":"x","queryPort":1}]' }), ConfigError);
    assert.throws(
      () => loadConfig({ SERVERS_JSON: '[{"id":"a","queryHost":"x","queryPort":1},{"id":"a","queryHost":"y","queryPort":2}]' }),
      ConfigError,
    );
    assert.throws(() => loadConfig({ SERVERS_JSON: '[{"id":"a","queryHost":"x","queryPort":70000}]' }), ConfigError);
    assert.throws(() => loadConfig({ SERVERS_JSON: '[{"id":"a","queryHost":"x","queryPort":1,"httpHealthUrl":"ftp://x"}]' }), ConfigError);
    assert.throws(() => loadConfig({ GAME_PORT: 'abc' }), ConfigError);
    assert.throws(() => loadConfig({ TURN_TTL: '5' }), ConfigError);
  });

  it('redactConfig не содержит секретов', () => {
    const c = loadConfig({ TURN_SECRET: 'topsecret', RCON_PASSWORD: 'rconsecret' });
    const s = JSON.stringify(redactConfig(c));
    assert.ok(!s.includes('topsecret'));
    assert.ok(!s.includes('rconsecret'));
  });
});

it('ALLOWED_ORIGINS разбирается в список без хвостовых слэшей', () => {
  const c = loadConfig({ ALLOWED_ORIGINS: 'https://label777.github.io/, https://example.org' });
  assert.deepEqual(c.allowedOrigins, ['https://label777.github.io', 'https://example.org']);
  assert.deepEqual(loadConfig({}).allowedOrigins, []);
});
