/*
 * ============================================================================================
 *  [НЕ СВЕРЕНО] — взято из описания upstream, не из кода; сверить скриптом scripts/verify-upstream.sh
 * ============================================================================================
 *
 *  Все предположения о сигналинге и транспорте yohimik/cs-web-server собраны ЗДЕСЬ и только здесь.
 *  Известно из описания: браузер шлёт SDP offer по WebSocket, сервер отвечает answer'ом
 *  (+ ICE-кандидаты), игровые пакеты идут по ненадёжному неупорядоченному data channel.
 *  НЕ известно из кода: строки типов сообщений, формат JSON, метка канала, фиктивный адрес.
 *  Если онлайн зависает на «Подключение к серверу», в первую очередь сверяйте этот файл.
 *  См. KNOWN_ISSUES.md, пункт 1.
 */

/** Типы JSON-сообщений сигналинга: `{ type, sdp }` и `{ type, candidate }`. [НЕ СВЕРЕНО] */
export const SIGNAL_MSG = {
  offer: 'offer',
  answer: 'answer',
  candidate: 'candidate',
} as const;

/** Метка data channel. [НЕ СВЕРЕНО] */
export const DATA_CHANNEL_LABEL = 'xash';

/** Параметры data channel: ненадёжный и неупорядоченный, как UDP. [НЕ СВЕРЕНО] */
export const DATA_CHANNEL_OPTIONS: RTCDataChannelInit = { ordered: false, maxRetransmits: 0 };

/** Фиктивный адрес сервера, который видит движок (`connect 127.0.0.1:8080`). [НЕ СВЕРЕНО] */
export const FAKE_SERVER_IP: [number, number, number, number] = [127, 0, 0, 1];
export const FAKE_SERVER_PORT = 8080;
export const FAKE_SERVER_ADDRESS = `${FAKE_SERVER_IP.join('.')}:${FAKE_SERVER_PORT}`;

/** Сколько ждать завершения сбора ICE-кандидатов перед отправкой offer (не-trickle). */
export const ICE_GATHERING_TIMEOUT_MS = 3000;

/** Общий таймаут: от открытия WebSocket до открытия data channel. */
export const CONNECT_TIMEOUT_MS = 15000;

/** Порог очереди отправки: при большем bufferedAmount пакеты отбрасываются (как UDP). */
export const MAX_BUFFERED_BYTES = 1024 * 1024;

export type SignalMessage =
  | { type: typeof SIGNAL_MSG.offer; sdp: string }
  | { type: typeof SIGNAL_MSG.answer; sdp: string }
  | { type: typeof SIGNAL_MSG.candidate; candidate: RTCIceCandidateInit | null };

/** Разбор входящего сообщения сигналинга; неизвестное → null. */
export function parseSignal(raw: unknown): SignalMessage | null {
  if (typeof raw !== 'string') return null;
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null || !('type' in msg)) return null;
  const m = msg as Record<string, unknown>;
  if (m.type === SIGNAL_MSG.answer && typeof m.sdp === 'string') return { type: SIGNAL_MSG.answer, sdp: m.sdp };
  if (m.type === SIGNAL_MSG.candidate) {
    const c = m.candidate;
    if (c === null || c === undefined) return { type: SIGNAL_MSG.candidate, candidate: null };
    if (typeof c === 'string') return { type: SIGNAL_MSG.candidate, candidate: { candidate: c } };
    if (typeof c === 'object') return { type: SIGNAL_MSG.candidate, candidate: c as RTCIceCandidateInit };
  }
  return null;
}
