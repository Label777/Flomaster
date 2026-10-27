// @ts-check
/**
 * Временные учётные данные TURN по схеме TURN REST API (draft-uberti-behave-turn-rest),
 * которую coturn поддерживает в режиме use-auth-secret / static-auth-secret:
 *   username   = "<unix-время истечения>:<метка>"
 *   credential = base64(HMAC-SHA1(secret, username))
 * Плюс простой ограничитель частоты (token bucket) для /api/ice.
 */

import { createHmac } from 'node:crypto';

/**
 * @param {string} secret
 * @param {string} username
 */
export function turnCredential(secret, username) {
  return createHmac('sha1', secret).update(username).digest('base64');
}

/**
 * @param {{ secret: string, ttl: number, label?: string, now?: number }} p
 *   now — текущее время в миллисекундах (для тестов)
 */
export function makeTurnCredentials({ secret, ttl, label = 'web', now = Date.now() }) {
  const username = `${Math.floor(now / 1000) + ttl}:${label}`;
  return { username, credential: turnCredential(secret, username) };
}

/**
 * @typedef {object} IceServer
 * @property {string | string[]} urls
 * @property {string} [username]
 * @property {string} [credential]
 */

/**
 * Тело ответа /api/ice. Без TURN_SECRET отдаётся только STUN.
 * Без DOMAIN — пустой список (браузер обойдётся host-кандидатами).
 * @param {import('./config.js').TurnConfig} turn
 * @param {number} [now]
 * @returns {{ iceServers: IceServer[], ttl: number }}
 */
export function buildIceResponse(turn, now = Date.now()) {
  if (!turn.domain) return { iceServers: [], ttl: turn.ttl };
  const host = turn.domain.includes(':') && !turn.domain.startsWith('[') ? `[${turn.domain}]` : turn.domain;
  /** @type {IceServer[]} */
  const iceServers = [{ urls: `stun:${host}:${turn.port}` }];
  if (turn.secret) {
    const { username, credential } = makeTurnCredentials({ secret: turn.secret, ttl: turn.ttl, now });
    iceServers.push({
      urls: [`turn:${host}:${turn.port}?transport=udp`, `turn:${host}:${turn.port}?transport=tcp`],
      username,
      credential,
    });
  }
  return { iceServers, ttl: turn.ttl };
}

/**
 * Token bucket на ключ (IP). capacity токенов, пополнение capacity за windowMs.
 */
export class RateLimiter {
  /**
   * @param {{ capacity: number, windowMs?: number, maxKeys?: number, now?: () => number }} opts
   */
  constructor({ capacity, windowMs = 60_000, maxKeys = 50_000, now = Date.now }) {
    this.capacity = capacity;
    this.ratePerMs = capacity / windowMs;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
    /** @type {Map<string, { tokens: number, at: number }>} */
    this.buckets = new Map();
  }

  /**
   * Пытается списать токен.
   * @param {string} key
   * @returns {{ ok: boolean, retryAfterSec: number, remaining: number }}
   */
  take(key) {
    const t = this.now();
    let b = this.buckets.get(key);
    if (b) {
      b.tokens = Math.min(this.capacity, b.tokens + (t - b.at) * this.ratePerMs);
      b.at = t;
      // обновляем порядок вставки (LRU) для вытеснения
      this.buckets.delete(key);
    } else {
      if (this.buckets.size >= this.maxKeys) this.sweep(t);
      b = { tokens: this.capacity, at: t };
    }
    this.buckets.set(key, b);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, retryAfterSec: 0, remaining: Math.floor(b.tokens) };
    }
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / this.ratePerMs / 1000)), remaining: 0 };
  }

  /** Удаляет полностью восстановившиеся корзины; при переполнении — самые старые. @param {number} [t] */
  sweep(t = this.now()) {
    for (const [k, b] of this.buckets) {
      if (b.tokens + (t - b.at) * this.ratePerMs >= this.capacity) this.buckets.delete(k);
    }
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next();
      if (oldest.done) break;
      this.buckets.delete(oldest.value);
    }
  }
}
