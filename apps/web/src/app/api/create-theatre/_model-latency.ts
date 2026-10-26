import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CreateTheatreRuntimeModelConfig } from './_admin-settings';
import { resolveHermesChatUrl, resolveHermesResponsesUrl, shouldUseHermesResponsesApi, hermesReasoningEffort } from './_hermes-model-health';

export type ModelLatency = { available: boolean; durationMs: number; testedAt: string; status?: number; error?: string };
const ttlMs = 5 * 60_000;
const inFlight = new Map<string, Promise<ModelLatency>>();
const cache = new Map<string, ModelLatency>();
// Runtime state is shared across releases; never trace it into the build artifact.
const file = () => process.env.AIYA_MODEL_LATENCY_FILE || join(/* turbopackIgnore: true */ process.cwd(), '.state', 'create-theatre', 'model-latency.json');
const fingerprint = (config: CreateTheatreRuntimeModelConfig) => createHash('sha256')
  .update([config.baseUrl, config.model, config.apiKey, hermesReasoningEffort(config.model), 'responses-no-store-v2'].join('\n')).digest('hex');

export async function cachedModelLatency(config: CreateTheatreRuntimeModelConfig) {
  const key = fingerprint(config);
  if (cache.has(key)) return cache.get(key);
  try {
    const runtimeCachePath = file();
    const stored = JSON.parse(await readFile(/* turbopackIgnore: true */ runtimeCachePath, 'utf8')) as Record<string, ModelLatency>;
    const item = stored[key];
    if (item && typeof item.available === 'boolean' && Number.isFinite(item.durationMs) && Number.isFinite(Date.parse(item.testedAt))) {
      cache.set(key, item); return item;
    }
  } catch { /* A missing cache must not trigger paid inference. */ }
  return undefined;
}

async function measure(config: CreateTheatreRuntimeModelConfig): Promise<ModelLatency> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const responses = shouldUseHermesResponsesApi(config.model);
    const response = await fetch(responses ? resolveHermesResponsesUrl(config.baseUrl) : resolveHermesChatUrl(config.baseUrl), {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(responses
        ? { model: config.model, input: [{ role: 'user', content: 'Reply exactly AIYA_OK.' }], reasoning: { effort: hermesReasoningEffort(config.model) }, max_output_tokens: 2048, stream: false, store: false }
        : { model: config.model, messages: [{ role: 'user', content: 'Reply exactly AIYA_OK.' }],
          max_tokens: config.model === 'fusion-max-2.0' ? 1024 : 32,
          ...(config.model === 'fusion-max-2.0' ? { reasoning_effort: 'low' } : { thinking: { type: 'disabled' } }), stream: false }),
    });
    const raw = await response.text();
    let data: Record<string, any> = {};
    try { data = JSON.parse(raw); } catch { /* HTML gateway failures are not model output. */ }
    const content = responses
      ? data.output_text || (Array.isArray(data.output) ? data.output.flatMap((item: any) => item.content || []).map((item: any) => item.text || '').join('') : '')
      : data.choices?.[0]?.message?.content;
    const available = response.ok && (!responses || (data.status === 'completed' && data.model === config.model))
      && (config.model !== 'fusion-max-2.0' || data.model === config.model)
      && typeof content === 'string' && content.trim().length > 0;
    return { available, durationMs: Date.now() - started, testedAt: new Date().toISOString(), status: response.status,
      ...(!available ? { error: response.status === 525 ? '网关 SSL 握手失败（HTTP 525）' : response.ok ? '模型未返回有效内容' : `请求失败（HTTP ${response.status}）` } : {}) };
  } catch {
    return { available: false, durationMs: Date.now() - started, testedAt: new Date().toISOString(), error: controller.signal.aborted ? '请求超时（45 秒）' : '无法连接模型服务' };
  } finally { clearTimeout(timeout); }
}

export async function testModelLatency(config: CreateTheatreRuntimeModelConfig): Promise<ModelLatency> {
  const key = fingerprint(config);
  const cached = await cachedModelLatency(config);
  if (cached && Date.now() - Date.parse(cached.testedAt) < ttlMs) return cached;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const task = (async () => {
    const result = await measure(config); cache.set(key, result);
    while (cache.size > 12) cache.delete(cache.keys().next().value!);
    try {
      const destination = file(); await mkdir(dirname(destination), { recursive: true });
      const temp = `${destination}.${process.pid}.${key.slice(0, 8)}.tmp`;
      await writeFile(temp, JSON.stringify(Object.fromEntries(cache)), 'utf8'); await rename(temp, destination);
    } catch { /* Measurement remains usable when the cache disk is unavailable. */ }
    return result;
  })();
  inFlight.set(key, task);
  try { return await task; } finally { inFlight.delete(key); }
}
