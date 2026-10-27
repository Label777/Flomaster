/** WebRTC-транспорт для Net из xash3d-fwgs: пакеты движка ⇄ ненадёжный data channel. */
import type { Net, Packet, SendtoSender } from 'xash3d-fwgs';
import {
  CONNECT_TIMEOUT_MS,
  DATA_CHANNEL_LABEL,
  DATA_CHANNEL_OPTIONS,
  FAKE_SERVER_IP,
  FAKE_SERVER_PORT,
  ICE_GATHERING_TIMEOUT_MS,
  MAX_BUFFERED_BYTES,
  SIGNAL_MSG,
  parseSignal,
  type SignalMessage,
} from './protocol';
import { log } from '../ui/log';

export type TransportState = 'idle' | 'connecting' | 'open' | 'closed' | 'failed';

/** Адрес WebSocket сигналинга на том же origin: wss: на https, ws: на http. */
export function signalSocketUrl(signalUrl: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = signalUrl.startsWith('/') ? signalUrl : `/${signalUrl}`;
  return `${proto}//${location.host}${path}`;
}

export class WebRTCTransport implements SendtoSender {
  /** Вызывается один раз при потере соединения после успешного подключения. */
  onClose: ((reason: string) => void) | null = null;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private ws: WebSocket | null = null;
  private netRef: Net | null = null;
  private stateValue: TransportState = 'idle';
  private dropped = 0;

  get state(): TransportState {
    return this.stateValue;
  }

  /** Net создаётся с этим транспортом в конструкторе, поэтому ссылка передаётся отдельно. */
  set net(net: Net) {
    this.netRef = net;
  }

  connect(signalUrl: string, iceServers: RTCIceServer[]): Promise<void> {
    if (this.stateValue !== 'idle') return Promise.reject(new Error('Транспорт уже использован'));
    this.stateValue = 'connecting';

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (message: string): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.teardown('failed');
        reject(new Error(message));
      };
      const timer = setTimeout(
        () => fail('Сервер не ответил за 15 секунд. Проверьте интернет или попробуйте другой сервер.'),
        CONNECT_TIMEOUT_MS,
      );

      const pc = new RTCPeerConnection({ iceServers });
      this.pc = pc;
      const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, DATA_CHANNEL_OPTIONS);
      dc.binaryType = 'arraybuffer';
      this.dc = dc;

      dc.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.stateValue = 'open';
        // Сигналинг больше не нужен; сервер может закрыть его и сам.
        this.closeSocket();
        log.debug('data channel открыт');
        resolve();
      };
      dc.onmessage = (ev: MessageEvent<unknown>) => this.receive(ev.data);
      dc.onclose = () => this.lost('Канал данных закрыт сервером.');
      dc.onerror = () => this.lost('Ошибка канала данных.');

      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        if (s === 'failed') {
          if (!settled) fail('Не удалось установить соединение (ICE failed). Возможно, UDP блокируется сетью.');
          else this.lost('Соединение с сервером потеряно (ICE failed).');
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' && settled) this.lost('Соединение с сервером потеряно.');
      };

      const ws = new WebSocket(signalSocketUrl(signalUrl));
      this.ws = ws;
      ws.onerror = () => fail('Не удалось связаться с сервером сигналинга.');
      ws.onclose = () => {
        if (!settled) fail('Сервер сигналинга закрыл соединение до установки связи.');
      };
      ws.onmessage = (ev: MessageEvent<unknown>) => {
        const msg = parseSignal(ev.data);
        if (!msg) {
          log.warn('неизвестное сообщение сигналинга', ev.data);
          return;
        }
        void this.handleSignal(msg).catch((err: unknown) => {
          log.error('сигналинг', err);
          fail('Сервер прислал некорректный ответ при подключении.');
        });
      };
      ws.onopen = () => {
        void this.sendOffer().catch((err: unknown) => {
          log.error('offer', err);
          fail('Не удалось подготовить WebRTC-подключение в этом браузере.');
        });
      };
    });
  }

  sendto(packet: Packet): void {
    const dc = this.dc;
    if (!dc || dc.readyState !== 'open') return;
    if (dc.bufferedAmount > MAX_BUFFERED_BYTES) {
      if (++this.dropped % 100 === 1) log.warn('очередь отправки переполнена, пакеты отбрасываются');
      return;
    }
    // packet.data — представление памяти wasm (HEAPU8); копируем до передачи в асинхронный API.
    dc.send(packet.data.slice());
  }

  /** RTT активной пары ICE-кандидатов в мс, или null. */
  async getRttMs(): Promise<number | null> {
    const pc = this.pc;
    if (!pc) return null;
    const stats = await pc.getStats();
    let rtt: number | null = null;
    stats.forEach((report: RTCStats) => {
      if (report.type !== 'candidate-pair') return;
      const pair = report as RTCIceCandidatePairStats;
      if (pair.state === 'succeeded' && pair.nominated && typeof pair.currentRoundTripTime === 'number') {
        rtt = pair.currentRoundTripTime * 1000;
      }
    });
    return rtt;
  }

  close(): void {
    this.teardown('closed');
  }

  private async sendOffer(): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceGathering(pc, ICE_GATHERING_TIMEOUT_MS);
    const sdp = pc.localDescription?.sdp ?? offer.sdp ?? '';
    this.sendSignal({ type: SIGNAL_MSG.offer, sdp });
  }

  private async handleSignal(msg: SignalMessage): Promise<void> {
    const pc = this.pc;
    if (!pc) return;
    if (msg.type === SIGNAL_MSG.answer) {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
    } else if (msg.type === SIGNAL_MSG.candidate && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch (err) {
        log.debug('кандидат отклонён', err);
      }
    }
  }

  private sendSignal(msg: SignalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private receive(data: unknown): void {
    if (!(data instanceof ArrayBuffer) || !this.netRef) return;
    this.netRef.incoming.enqueue({ data: new Int8Array(data), ip: [...FAKE_SERVER_IP], port: FAKE_SERVER_PORT });
  }

  private lost(reason: string): void {
    if (this.stateValue !== 'open') return;
    this.teardown('closed');
    this.onClose?.(reason);
  }

  private closeSocket(): void {
    const ws = this.ws;
    this.ws = null;
    if (!ws) return;
    ws.onclose = ws.onerror = ws.onmessage = ws.onopen = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  }

  private teardown(state: TransportState): void {
    this.stateValue = state;
    this.closeSocket();
    const dc = this.dc;
    this.dc = null;
    if (dc) {
      dc.onopen = dc.onclose = dc.onerror = dc.onmessage = null;
      dc.close();
    }
    const pc = this.pc;
    this.pc = null;
    if (pc) {
      pc.oniceconnectionstatechange = pc.onconnectionstatechange = null;
      pc.close();
    }
  }
}

function waitIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = (): void => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}
