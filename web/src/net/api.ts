/** Типизированные запросы к нашему API (контракт — ARCHITECTURE.md §6). */
import { log } from '../ui/log';

export type ServerStatus = 'online' | 'offline' | 'unknown';

export interface ServerInfo {
  id: string;
  name: string;
  status: ServerStatus;
  map: string | null;
  players: number | null;
  maxPlayers: number | null;
  bots: number | null;
  signalUrl: string;
  updatedAt: string | null;
}

export interface PlayerInfo {
  name: string;
  score: number;
  duration: number;
}

export interface ServerDetails extends ServerInfo {
  playerList: PlayerInfo[];
}

export interface IceConfig {
  iceServers: RTCIceServer[];
  ttl: number | null;
}

export const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export class ApiError extends Error {}

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store', signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('Нет связи с сайтом. Проверьте подключение к интернету.');
  }
  if (!res.ok) throw new ApiError(`Сервер сайта ответил ошибкой ${res.status}.`);
  try {
    return await res.json();
  } catch {
    throw new ApiError('Сервер сайта прислал некорректный ответ.');
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function parseServer(v: unknown): ServerInfo | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  if (!id) return null;
  const status = v.status === 'online' || v.status === 'offline' ? v.status : 'unknown';
  return {
    id,
    name: str(v.name) ?? id,
    status,
    map: str(v.map),
    players: num(v.players),
    maxPlayers: num(v.maxPlayers),
    bots: num(v.bots),
    signalUrl: str(v.signalUrl) ?? `/rtc/${encodeURIComponent(id)}/websocket`,
    updatedAt: str(v.updatedAt),
  };
}

export async function fetchServers(signal?: AbortSignal): Promise<ServerInfo[]> {
  const body = await getJson('/api/servers', signal);
  if (!isObj(body) || !Array.isArray(body.servers)) throw new ApiError('Сервер сайта прислал некорректный список серверов.');
  return body.servers.map(parseServer).filter((s): s is ServerInfo => s !== null);
}

export async function fetchServer(id: string, signal?: AbortSignal): Promise<ServerDetails> {
  const body = await getJson(`/api/servers/${encodeURIComponent(id)}`, signal);
  const server = parseServer(body);
  if (!server || !isObj(body)) throw new ApiError('Сервер не найден.');
  const list = Array.isArray(body.playerList) ? body.playerList : [];
  const playerList = list.filter(isObj).map((p) => ({
    name: str(p.name) ?? '',
    score: num(p.score) ?? 0,
    duration: num(p.duration) ?? 0,
  }));
  return { ...server, playerList };
}

/** TURN/STUN для WebRTC. При ошибке — публичный STUN (без TURN за строгим NAT не подключиться). */
export async function fetchIce(): Promise<IceConfig> {
  try {
    const body = await getJson('/api/ice');
    if (isObj(body) && Array.isArray(body.iceServers) && body.iceServers.length > 0) {
      return { iceServers: body.iceServers as RTCIceServer[], ttl: num(body.ttl) };
    }
    throw new ApiError('пустой iceServers');
  } catch (err) {
    log.warn('/api/ice недоступен, используется публичный STUN', err);
    return { iceServers: FALLBACK_ICE, ttl: null };
  }
}

/** Медиана RTT нескольких запросов /api/health, мс; null — сайт недоступен. */
export async function measurePing(samples = 3): Promise<number | null> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) continue;
      await res.arrayBuffer();
      times.push(performance.now() - t0);
    } catch {
      // сеть недоступна — образец пропускается
    }
  }
  if (times.length === 0) return null;
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] ?? null;
}
