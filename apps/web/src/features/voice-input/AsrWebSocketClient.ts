import type { AsrServerMessage, VoiceInputError } from './types';

export type AsrWebSocketClientOptions = {
  wsUrl: string;
  token?: string;
  requestId: string;
  hotwords?: string[];
  onMessage: (message: AsrServerMessage) => void;
  onError: (error: VoiceInputError) => void;
  onClose?: () => void;
};

export class AsrWebSocketClient {
  private ws?: WebSocket;
  private asrReady = false;

  async connect(input: AsrWebSocketClientOptions) {
    const wsUrl = input.token ? appendQuery(input.wsUrl, 'token', input.token) : input.wsUrl;
    this.asrReady = false;
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let opened = false;
      let startSent = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        callback();
      };
      const connectionDetail = () => ({
        wsUrl: sanitizeWsUrl(wsUrl),
        opened,
        startSent,
        ready: this.asrReady,
        requestId: input.requestId,
        userAgent: window.navigator.userAgent,
      });
      const timer = window.setTimeout(() => {
        const detail = connectionDetail();
        const message = 'ASR 连接超时，请检查网络后重试';
        input.onError({ message, code: 'ASR_WS_TIMEOUT', retryable: true, detail });
        finish(() => reject(new Error(message)));
      }, 8000);

      this.ws!.onopen = () => {
        opened = true;
        this.ws!.send(JSON.stringify({
          type: 'start',
          language: 'zh',
          sampleRate: 16000,
          format: 'pcm_s16le',
          scene: 'chat_input',
          requestId: input.requestId,
          hotwords: input.hotwords ?? [],
        }));
        startSent = true;
      };

      this.ws!.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as AsrServerMessage;
          if (message.type === 'ready') {
            this.asrReady = true;
            finish(resolve);
          }
          input.onMessage(message);
        } catch {
          input.onError({ message: 'ASR 返回了无法解析的数据', code: 'BAD_ASR_MESSAGE', retryable: true });
        }
      };

      this.ws!.onerror = () => {
        const detail = connectionDetail();
        const message = 'ASR WebSocket 连接失败，请检查网络或刷新页面后重试';
        input.onError({ message, code: 'ASR_WS_ERROR', retryable: true, detail });
        finish(() => reject(new Error(message)));
      };

      this.ws!.onclose = (event) => {
        this.asrReady = false;
        input.onClose?.();
        if (settled) return;
        const detail = {
          ...connectionDetail(),
          closeCode: event.code,
          closeReason: event.reason,
          wasClean: event.wasClean,
        };
        const message = event.code === 1000
          ? 'ASR WebSocket 已关闭'
          : `ASR WebSocket 异常关闭（${event.code || '无关闭码'}）`;
        input.onError({ message, code: 'ASR_WS_CLOSED', retryable: true, detail });
        finish(() => reject(new Error(message)));
      };
    });
  }

  get readyState() {
    if (!this.ws) return undefined;
    if (!this.asrReady && this.ws.readyState === WebSocket.OPEN) return WebSocket.CONNECTING;
    return this.ws.readyState;
  }

  sendAudio(chunk: ArrayBuffer) {
    if (this.asrReady && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  stop() {
    if (this.asrReady && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'stop' }));
    }
  }

  cancel() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'cancel' }));
    }
    this.close();
  }

  close() {
    this.asrReady = false;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
      this.ws.close();
    }
    this.ws = undefined;
  }
}

const appendQuery = (url: string, key: string, value: string) => {
  const parsed = new URL(url, window.location.href);
  parsed.searchParams.set(key, value);
  return parsed.toString();
};

const sanitizeWsUrl = (url: string) => {
  try {
    const parsed = new URL(url, window.location.href);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url.replace(/[?].*$/, '');
  }
};
