type RecorderOptions = {
  onChunk: (chunk: ArrayBuffer) => void;
  targetSampleRate?: number;
  frameMs?: number;
};

type BrowserAudioContext = typeof AudioContext;

type WebkitAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: BrowserAudioContext;
};

export class WebAudioPcmRecorder {
  private audioContext?: AudioContext;
  private mediaStream?: MediaStream;
  private processor?: ScriptProcessorNode;
  private source?: MediaStreamAudioSourceNode;
  private pcmQueue: number[] = [];
  private onChunk?: (chunk: ArrayBuffer) => void;
  private targetSampleRate = 16000;
  private frameSamples = 3200;
  private startedAt = 0;

  async start(options: RecorderOptions) {
    this.onChunk = options.onChunk;
    this.targetSampleRate = options.targetSampleRate ?? 16000;
    this.frameSamples = Math.floor(this.targetSampleRate * (options.frameMs ?? 200) / 1000);
    this.pcmQueue = [];
    this.startedAt = performance.now();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风录音');
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (error) {
      const browserError = error as DOMException;
      if (browserError?.name === 'NotAllowedError' || browserError?.name === 'PermissionDeniedError' || /permission denied/i.test(browserError?.message || '')) {
        const host = window.location.hostname || '当前网站';
        throw new Error(`麦克风权限被拒绝。请在浏览器地址栏或系统设置里允许 ${host} 使用麦克风，然后刷新页面再试。`);
      }
      if (browserError?.name === 'NotFoundError' || browserError?.name === 'DevicesNotFoundError') {
        throw new Error('没有检测到可用麦克风。请接入麦克风或检查系统输入设备后重试。');
      }
      if (browserError?.name === 'NotReadableError') {
        throw new Error('麦克风当前被其他应用占用。请关闭正在使用麦克风的软件后重试。');
      }
      throw error;
    }

    const AudioContextCtor = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
    if (!AudioContextCtor) throw new Error('当前浏览器不支持 AudioContext');

    this.audioContext = new AudioContextCtor();
    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);

    this.processor.onaudioprocess = (event) => {
      if (!this.audioContext || !this.onChunk) return;
      const input = event.inputBuffer.getChannelData(0);
      const downsampled = downsampleFloat32(input, this.audioContext.sampleRate, this.targetSampleRate);
      this.pcmQueue.push(...downsampled);

      while (this.pcmQueue.length >= this.frameSamples) {
        const frame = this.pcmQueue.splice(0, this.frameSamples);
        this.onChunk(floatTo16BitPCM(frame));
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);
  }

  async stop() {
    if (this.pcmQueue.length > 0 && this.onChunk) {
      this.onChunk(floatTo16BitPCM(this.pcmQueue.splice(0)));
    }

    this.processor?.disconnect();
    this.source?.disconnect();
    await this.audioContext?.close().catch(() => {});
    this.mediaStream?.getTracks().forEach((track) => track.stop());

    const audioMs = this.startedAt ? performance.now() - this.startedAt : 0;
    this.processor = undefined;
    this.source = undefined;
    this.audioContext = undefined;
    this.mediaStream = undefined;
    this.onChunk = undefined;
    this.pcmQueue = [];
    this.startedAt = 0;
    return audioMs;
  }
}

const downsampleFloat32 = (buffer: Float32Array, inputRate: number, outputRate: number) => {
  if (outputRate === inputRate) return Array.from(buffer);
  const ratio = inputRate / outputRate;
  const length = Math.floor(buffer.length / ratio);
  const result = new Array<number>(length);

  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.floor((index + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let cursor = start; cursor < end && cursor < buffer.length; cursor += 1) {
      sum += buffer[cursor] || 0;
      count += 1;
    }
    result[index] = sum / Math.max(1, count);
  }

  return result;
};

const floatTo16BitPCM = (samples: number[]) => {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);

  samples.forEach((value, index) => {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  });

  return buffer;
};
