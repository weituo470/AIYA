import { webModelModes, webModelLabels, normalizeWebModelMode, webModelConfig } from '../_web-models';
import { cachedModelLatency, testModelLatency } from '../_model-latency';
import { NextResponse } from 'next/server';
import { readCreateTheatreAdminSettings } from '../_admin-settings';
import { encodeModelSelection, modelSelectionCookie, modelSelectionMaxAge, readModelSelection, validModelPassword } from '../_model-selection';

export const runtime = 'nodejs';
const attempts = new Map<string, { count: number; until: number }>();
const publicOrigin = (request: Request) => {
  const url = new URL(request.url);
  const forwardedProtocol = request.headers.get('x-forwarded-proto');
  const protocol = forwardedProtocol === 'https' || forwardedProtocol === 'http' ? forwardedProtocol : url.protocol.slice(0, -1);
  return `${protocol}://${request.headers.get('host') || url.host}`;
};
const reply = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});
async function selection(request: Request) {
  const settings = await readCreateTheatreAdminSettings();
  return {
    manualSelection: Boolean(readModelSelection(request)),
    mode: normalizeWebModelMode(readModelSelection(request) || settings.modelMode),
    options: await Promise.all(webModelModes.map(async (mode) => {
      const config = webModelConfig(settings, mode);
      return { mode, label: webModelLabels[mode], model: config.model, reasoning: mode === 'quality' ? 'high' : undefined, latency: await cachedModelLatency(config),
        configured: Boolean(config.model && ((config.baseUrl && config.apiKey) || (config.provider === 'hermes-cli' && config.cliCommand))) };
    })),
  };
}
export async function GET(request: Request) {
  return reply({ ok: true, ...await selection(request) });
}
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (!origin || origin !== publicOrigin(request)) return reply({ ok: false, error: '请求来源无效，请在本站操作。' }, 403);
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() || 'unknown';
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const attempt = attempts.get(ip) || { count: 0, until: now + 60_000 };
  if (attempt.count >= 8 || attempts.size >= 10000) return reply({ ok: false, error: '尝试过于频繁，请一分钟后再试。' }, 429);
  attempt.count += 1; attempts.set(ip, attempt);
  const body = await request.json().catch(() => null);
  if (!validModelPassword(body?.password)) return reply({ ok: false, error: '口令不正确。' }, 403);
  if (body?.action === 'clear') {
    const response = reply({ ok: true, manualSelection: false });
    response.cookies.set(modelSelectionCookie, '', { httpOnly: true, sameSite: 'lax', secure: publicOrigin(request).startsWith('https://'), path: '/', maxAge: 0 });
    return response;
  }
  if (body?.action === 'test') {
    const settings = await readCreateTheatreAdminSettings();
    await Promise.all(webModelModes.map((mode) => {
      const config = webModelConfig(settings, mode);
      return config.baseUrl && config.apiKey ? testModelLatency(config) : Promise.resolve();
    }));
    return reply({ ok: true, ...await selection(request) });
  }
  const data = await selection(request);
  const option = data.options.find((item) => item.mode === body?.mode);
  if (!option?.configured) return reply({ ok: false, error: '该配置尚未完成，请先在管理后台配置。' }, 400);
  const response = reply({ ok: true, mode: option.mode });
  response.cookies.set(modelSelectionCookie, encodeModelSelection(option.mode), {
    httpOnly: true, sameSite: 'lax', secure: publicOrigin(request).startsWith('https://'),
    path: '/', maxAge: modelSelectionMaxAge,
  });
  return response;
}
