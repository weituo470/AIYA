import { createHash, randomUUID } from 'node:crypto';

export const runtime = 'nodejs';

type JsonObject = Record<string, unknown>;

type StreamConfig = {
  text: string;
  speaker: string;
  apiKey?: string;
  resourceId: string;
  endpoint: string;
};

const MAX_TEXT_LENGTH = 420;
const DEFAULT_STREAM_RESOURCE_ID = 'seed-tts-2.0';
const DEFAULT_STREAM_SPEAKER = 'zh_female_shuangkuaisisi_uranus_bigtts';
const DEFAULT_STREAM_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse';
const TEACHER_TTS_SPEECH_RATE = -20;
const TTS_CACHE_VERSION = 'aiya-teacher-tts-v1';
const TTS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TTS_CACHE_MAX_ENTRIES = 256;
const TTS_CACHE_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const TTS_CACHE_MAX_AUDIO_BYTES = 4 * 1024 * 1024;
type TtsCacheEntry = { audio: Buffer; expiresAt: number };
const ttsAudioCache = new Map<string, TtsCacheEntry>();
let ttsAudioCacheBytes = 0;

const env = (key: string) => {
  const value = process.env[key]?.trim();
  return value || undefined;
};

const cacheKey = (config: StreamConfig) =>
  createHash('sha256')
    .update(JSON.stringify({
      version: TTS_CACHE_VERSION,
      text: config.text,
      speaker: config.speaker,
      resourceId: config.resourceId,
      audioParams,
    }))
    .digest('hex');

function readCachedAudio(config: StreamConfig) {
  const key = cacheKey(config);
  const entry = ttsAudioCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    ttsAudioCache.delete(key);
    ttsAudioCacheBytes -= entry.audio.byteLength;
    return null;
  }
  ttsAudioCache.delete(key);
  ttsAudioCache.set(key, entry);
  return entry.audio;
}

function writeCachedAudio(config: StreamConfig, audio: Uint8Array) {
  if (audio.byteLength < 512 || audio.byteLength > TTS_CACHE_MAX_AUDIO_BYTES) return;
  const key = cacheKey(config);
  const existing = ttsAudioCache.get(key);
  if (existing) {
    ttsAudioCache.delete(key);
    ttsAudioCacheBytes -= existing.audio.byteLength;
  }
  const copy = Buffer.from(audio);
  ttsAudioCache.set(key, { audio: copy, expiresAt: Date.now() + TTS_CACHE_TTL_MS });
  ttsAudioCacheBytes += copy.byteLength;
  while (ttsAudioCache.size > TTS_CACHE_MAX_ENTRIES || ttsAudioCacheBytes > TTS_CACHE_MAX_TOTAL_BYTES) {
    const oldestKey = ttsAudioCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = ttsAudioCache.get(oldestKey);
    ttsAudioCache.delete(oldestKey);
    if (oldest) ttsAudioCacheBytes -= oldest.audio.byteLength;
  }
}

const audioBody = (audio: Uint8Array) =>
  audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;

const jsonError = (message: string, status = 500, extra: JsonObject = {}) =>
  Response.json({ error: message, ...extra }, { status });

const readConfig = (text: string, speaker?: string): StreamConfig => ({
  text,
  speaker: speaker || env('DOUBAO_TTS_STREAM_SPEAKER') || env('DOUBAO_TTS_SPEAKER') || DEFAULT_STREAM_SPEAKER,
  apiKey: env('DOUBAO_TTS_API_KEY') || env('VOLCENGINE_TTS_API_KEY') || env('DOUBAO_ASR_API_KEY'),
  resourceId:
    env('DOUBAO_TTS_STREAM_RESOURCE_ID') ||
    env('VOLCENGINE_TTS_STREAM_RESOURCE_ID') ||
    env('DOUBAO_TTS_RESOURCE_ID') ||
    DEFAULT_STREAM_RESOURCE_ID,
  endpoint: env('DOUBAO_TTS_STREAM_ENDPOINT') || env('VOLCENGINE_TTS_STREAM_ENDPOINT') || DEFAULT_STREAM_ENDPOINT,
});

const isObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const audioParams = {
  format: 'mp3',
  sample_rate: 24000,
  speech_rate: TEACHER_TTS_SPEECH_RATE,
  loudness_rate: 0,
  pitch_rate: 0,
};

function parseSsePayload(block: string) {
  const data = block
    .split('\n')
    .filter((line) => line.trimStart().startsWith('data:'))
    .map((line) => line.replace(/^\s*data:\s?/, '').trim())
    .join('\n');
  if (!data) return null;
  const payload = JSON.parse(data) as JsonObject;
  const code = typeof payload.code === 'number' ? payload.code : 0;
  if (code === 20000000) return null;
  if (code !== 0) {
    throw new Error(String(payload.message || `TTS stream code=${code}`));
  }
  return typeof payload.data === 'string' && payload.data ? Buffer.from(payload.data, 'base64') : null;
}

function findEventBoundary(buffer: string) {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function splitFirstEvent(buffer: string) {
  const index = findEventBoundary(buffer);
  if (index < 0) return null;
  const separatorLength = buffer.startsWith('\r\n\r\n', index) ? 4 : 2;
  return {
    block: buffer.slice(0, index),
    rest: buffer.slice(index + separatorLength),
  };
}

async function openUpstream(config: StreamConfig) {
  if (!config.apiKey) {
    throw new Error('未配置 DOUBAO_TTS_API_KEY。');
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': config.apiKey,
      'X-Api-Resource-Id': config.resourceId,
      'X-Api-Request-Id': randomUUID(),
    },
    body: JSON.stringify({
      user: { uid: 'aiya-create-theatre' },
      req_params: {
        text: config.text,
        speaker: config.speaker,
        audio_params: audioParams,
      },
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`TTS stream HTTP ${response.status}`);
  }
  return response.body.getReader();
}

async function readFirstAudioChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('TTS stream ended before audio data.');
    buffer += decoder.decode(chunk.value, { stream: true });
    const event = splitFirstEvent(buffer);
    if (!event) continue;
    const audio = parseSsePayload(event.block);
    return { audio, rest: event.rest, decoder };
  }
}

function audioStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  firstAudio: Buffer | null,
  initialBuffer: string,
  decoder: TextDecoder,
  onComplete?: (audio: Uint8Array) => void,
) {
  let buffer = initialBuffer;
  let sentFirst = false;
  let completed = false;
  let cachedBytes = 0;
  const cachedChunks: Buffer[] = [];
  const remember = (audio: Uint8Array | null) => {
    if (!audio?.byteLength || cachedBytes > TTS_CACHE_MAX_AUDIO_BYTES) return;
    cachedBytes += audio.byteLength;
    if (cachedBytes <= TTS_CACHE_MAX_AUDIO_BYTES) cachedChunks.push(Buffer.from(audio));
  };
  const complete = () => {
    if (completed) return;
    completed = true;
    if (onComplete && cachedBytes >= 512 && cachedBytes <= TTS_CACHE_MAX_AUDIO_BYTES) {
      onComplete(Buffer.concat(cachedChunks, cachedBytes));
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!sentFirst) {
          sentFirst = true;
          if (firstAudio?.byteLength) {
            remember(firstAudio);
            controller.enqueue(firstAudio);
            return;
          }
        }

        while (true) {
          const event = splitFirstEvent(buffer);
          if (event) {
            buffer = event.rest;
            const audio = parseSsePayload(event.block);
            if (audio?.byteLength) {
              remember(audio);
              controller.enqueue(audio);
              return;
            }
            continue;
          }

          const chunk = await reader.read();
          if (chunk.done) {
            if (buffer.trim()) {
              const audio = parseSsePayload(buffer);
              if (audio?.byteLength) {
                remember(audio);
                controller.enqueue(audio);
              }
            }
            complete();
            controller.close();
            return;
          }
          buffer += decoder.decode(chunk.value, { stream: true });
        }
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      completed = true;
      void reader.cancel().catch(() => {});
    },
  });
}

async function handle(request: Request) {
  const url = new URL(request.url);
  let text = url.searchParams.get('text')?.trim() || '';
  const speaker = url.searchParams.get('speaker')?.trim() || '';

  if (request.method === 'POST') {
    const body = (await request.json().catch(() => null)) as { text?: unknown; speaker?: unknown } | null;
    text = typeof body?.text === 'string' ? body.text.trim() : text;
  }

  if (!text) return jsonError('缺少要朗读的文本。', 400);
  if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH);

  try {
    const config = readConfig(text, speaker);
    const cached = await readCachedAudio(config);
    if (cached) {
      return new Response(audioBody(cached), {
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'private, max-age=604800',
          'X-AIYA-TTS-Mode': 'server-cache',
          'X-AIYA-TTS-Cache': 'hit',
        },
      });
    }

    const reader = await openUpstream(config);
    const first = await readFirstAudioChunk(reader);
    return new Response(audioStream(reader, first.audio, first.rest, first.decoder, (audio) => {
      void writeCachedAudio(config, audio);
    }), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-AIYA-TTS-Mode': 'volcengine-sse-stream',
        'X-AIYA-TTS-Cache': 'miss',
      },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'TTS stream failed.', 502);
  }
}

export const GET = handle;
export const POST = handle;
