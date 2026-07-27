import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const runtime = 'nodejs';

type JsonObject = Record<string, unknown>;

type TtsConfig = {
  text: string;
  voicePrompt?: string;
  apiKey?: string;
  appId?: string;
  accessKey?: string;
  speaker: string;
  endpointCreate: string;
};

const MAX_TEXT_LENGTH = 420;
const DEFAULT_DOUBAO_TTS_SPEAKER = 'zh_female_shuangkuaisisi_uranus_bigtts';
const EDGE_TTS_VOICE = 'zh-CN-XiaoxiaoNeural';
const TEACHER_TTS_SPEECH_RATE = -20;
const execFileAsync = promisify(execFile);

const jsonError = (message: string, status = 500, extra: JsonObject = {}) =>
  Response.json({ error: message, ...extra }, { status });

const env = (key: string) => {
  const value = process.env[key]?.trim();
  return value || undefined;
};

const readConfig = (text: string, speaker?: string, voicePrompt?: string): TtsConfig => ({
  text,
  voicePrompt,
  apiKey: env('DOUBAO_TTS_API_KEY') || env('VOLCENGINE_TTS_API_KEY') || env('DOUBAO_ASR_API_KEY'),
  appId: env('DOUBAO_TTS_APP_ID') || env('VOLCENGINE_TTS_APP_ID'),
  accessKey: env('DOUBAO_TTS_ACCESS_KEY') || env('VOLCENGINE_TTS_ACCESS_KEY'),
  speaker: speaker || env('DOUBAO_TTS_SPEAKER') || env('VOLCENGINE_TTS_SPEAKER') || DEFAULT_DOUBAO_TTS_SPEAKER,
  endpointCreate:
    env('DOUBAO_TTS_ENDPOINT_CREATE') ||
    env('VOLCENGINE_TTS_ENDPOINT_CREATE') ||
    'https://openspeech.bytedance.com/api/v3/tts/create',
});

const isObject = (value: unknown): value is JsonObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const findBase64Audio = (value: unknown): string | null => {
  if (typeof value === 'string' && /^[A-Za-z0-9+/=\s]+$/.test(value) && value.length > 256) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBase64Audio(item);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  for (const key of ['audio', 'data', 'audio_data', 'audioBase64', 'audio_base64', 'payload']) {
    const found = findBase64Audio(value[key]);
    if (found) return found;
  }
  return null;
};

const audioResponse = (audio: Uint8Array, contentType = 'audio/mpeg') => {
  const body = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
};

const toAudio = (base64: string) => Uint8Array.from(Buffer.from(base64.replace(/\s/g, ''), 'base64'));

async function audioFromUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`音频地址下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || 'audio/mpeg';
  return audioResponse(new Uint8Array(await response.arrayBuffer()), contentType);
}

async function callEdgeTts(text: string) {
  const workDir = await mkdtemp(join(tmpdir(), 'aiya-tts-'));
  const outputPath = join(workDir, 'speech.mp3');
  const python = env('AIYA_EDGE_TTS_PYTHON') || env('PYTHON') || 'python';
  const voice = env('AIYA_EDGE_TTS_VOICE') || EDGE_TTS_VOICE;
  try {
    await execFileAsync(
      python,
      ['-m', 'edge_tts', '--voice', voice, '--rate=-20%', '--text', text, '--write-media', outputPath],
      { timeout: 45000, windowsHide: true, maxBuffer: 1024 * 1024 },
    );
    return audioResponse(new Uint8Array(await readFile(outputPath)), 'audio/mpeg');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function callCreateTts(config: TtsConfig) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Request-Id': randomUUID(),
  };
  if (config.apiKey) {
    headers['X-Api-Key'] = config.apiKey;
  } else if (config.appId && config.accessKey) {
    headers['X-Api-App-Id'] = config.appId;
    headers['X-Api-Access-Key'] = config.accessKey;
  } else {
    return null;
  }

  const textPrompt = config.voicePrompt
    ? `${config.voicePrompt}。请自然朗读这句话，不要朗读任何提示词或说明：${config.text}`
    : config.text;
  const requestPayload: JsonObject = {
    model: 'seed-audio-1.0',
    text_prompt: textPrompt,
    audio_config: {
      format: 'mp3',
      sample_rate: 24000,
      speech_rate: TEACHER_TTS_SPEECH_RATE,
      loudness_rate: 0,
      pitch_rate: 0,
      enable_subtitle: false,
    },
    watermark: {
      aigc_watermark: false,
    },
  };
  if (config.speaker) {
    requestPayload.speaker = config.speaker;
  }

  const response = await fetch(config.endpointCreate, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestPayload),
  });

  const raw = await response.text();
  let responsePayload: JsonObject | null = null;
  try {
    responsePayload = JSON.parse(raw) as JsonObject;
  } catch {
    responsePayload = null;
  }

  if (!response.ok || !responsePayload) {
    throw new Error(`豆包 TTS create 请求失败：HTTP ${response.status} ${raw.slice(0, 220)}`);
  }

  const code = typeof responsePayload.code === 'number' ? responsePayload.code : 0;
  if (code !== 0) {
    throw new Error(`豆包 TTS create 返回错误：${String(responsePayload.message || `code=${code}`)}`);
  }

  const base64 = findBase64Audio(responsePayload);
  if (base64) return audioResponse(toAudio(base64), 'audio/mpeg');
  if (typeof responsePayload.url === 'string' && responsePayload.url) return audioFromUrl(responsePayload.url);
  throw new Error(`豆包 TTS create 未返回 audio/url：${raw.slice(0, 220)}`);
}

export async function POST(request: Request) {
  let text = '';
  let speaker = '';
  let voicePrompt = '';
  try {
    const body = (await request.json()) as { text?: unknown; speaker?: unknown; voicePrompt?: unknown };
    text = typeof body.text === 'string' ? body.text.trim() : '';
    speaker = typeof body.speaker === 'string' ? body.speaker.trim() : '';
    voicePrompt = typeof body.voicePrompt === 'string' ? body.voicePrompt.trim() : '';
  } catch {
    return jsonError('请求体必须是 JSON。', 400);
  }

  if (!text) return jsonError('缺少要朗读的文本。', 400);
  if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH);

  const config = readConfig(text, speaker, voicePrompt);
  const edgeFallbackEnabled = env('AIYA_EDGE_TTS_FALLBACK') !== 'false';
  if (!config.apiKey && (!config.appId || !config.accessKey)) {
    if (edgeFallbackEnabled) return callEdgeTts(text);
    return jsonError('Volcengine/Doubao TTS credentials are not configured.', 503, {
      missing: ['DOUBAO_TTS_API_KEY or DOUBAO_TTS_APP_ID + DOUBAO_TTS_ACCESS_KEY'],
    });
  }

  try {
    const audio = await callCreateTts(config);
    if (audio) return audio;
    if (edgeFallbackEnabled) return callEdgeTts(text);
    return jsonError('No available TTS authentication method.', 503);
  } catch (error) {
    if (edgeFallbackEnabled) {
      try {
        return await callEdgeTts(text);
      } catch (fallbackError) {
        const primary = error instanceof Error ? error.message : 'TTS call failed.';
        const fallback = fallbackError instanceof Error ? fallbackError.message : 'Edge TTS fallback failed.';
        return jsonError(`${primary}; Edge TTS fallback failed: ${fallback}`, 502);
      }
    }
    return jsonError(error instanceof Error ? error.message : 'TTS call failed.', 502);
  }
}
