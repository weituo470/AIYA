/** Fusion transport only. Reasoning text is counted, never retained or published. */
export type FusionTransport = {
  protocol: 'sse' | 'json';
  httpStatus: number;
  completionId?: string;
  requestId?: string;
  finishReason?: string;
  firstByteMs?: number;
  firstContentMs?: number;
  durationMs: number;
  contentChars: number;
  reasoningChars: number;
  done: boolean;
};

export class FusionResponseError extends Error {
  constructor(message: string, readonly detail: Record<string, unknown>) {
    super(message);
    this.name = 'FusionResponseError';
  }
}

type Options = {
  startedAt: number;
  signal: AbortSignal;
  redact: (text: string) => string;
  onProgress?: (progress: FusionTransport) => Promise<void> | void;
};

const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const safeId = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,180}$/.test(value) ? value : undefined;
/** Best-effort telemetry cannot hold a paid request or accumulate hanging writes. */
export function createFusionProgressReporter<T>(callback: ((value: T) => Promise<void> | void) | undefined, signal: AbortSignal) {
  let inFlight: Promise<void> | undefined;
  return async (value: T) => {
    if (!callback || signal.aborted || inFlight) return;
    const current = Promise.resolve().then(() => callback(value)).then(() => undefined, () => undefined);
    inFlight = current;
    void current.then(() => { if (inFlight === current) inFlight = undefined; });
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, 200);
      signal.addEventListener('abort', finish, { once: true });
      void current.then(finish);
      if (signal.aborted) finish();
    });
  };
}
export function fusionUsage(value: unknown): Record<string, number> | undefined {
  const source = record(value), result: Record<string, number> = {};
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
    if (typeof source[key] === 'number' && Number.isFinite(source[key]) && source[key] >= 0) result[key] = source[key];
  }
  const reasoning = record(source.completion_tokens_details).reasoning_tokens;
  if (typeof reasoning === 'number' && Number.isFinite(reasoning) && reasoning >= 0) result.reasoning_tokens = reasoning;
  return Object.keys(result).length ? result : undefined;
}

export async function readFusionChatResponse(response: Response, options: Options) {
  const redactedId = (value: unknown) => typeof value === 'string' ? safeId(options.redact(value)) : undefined;
  const reportProgress = createFusionProgressReporter(options.onProgress, options.signal);
  const streaming = /text\/event-stream/i.test(response.headers.get('content-type') || '');
  const stats: FusionTransport = {
    protocol: streaming ? 'sse' : 'json', httpStatus: response.status,
    requestId: redactedId(response.headers.get('x-request-id') || response.headers.get('request-id')),
    durationMs: Date.now() - options.startedAt, contentChars: 0, reasoningChars: 0, done: false,
  };
  let content = '', model: string | undefined, usage: Record<string, number> | undefined;
  let lastProgressAt = 0;
  const notify = async (force = false) => {
    const now = Date.now();
    stats.durationMs = now - options.startedAt;
    if (options.onProgress && (force || now - lastProgressAt >= 5000)) {
      lastProgressAt = now;
      await reportProgress({ ...stats });
    }
  };
  const fail = (message: string, failureKind: string, extra: Record<string, unknown> = {}): never => {
    stats.durationMs = Date.now() - options.startedAt;
    throw new FusionResponseError(message, {
      failureKind, upstreamStatus: response.status, transport: { ...stats },
      returnedModel: model, finishReason: stats.finishReason, usage,
      completionId: stats.completionId, requestId: stats.requestId,
      modelOutputLength: content.length, ...extra,
    });
  };
  const envelope = (item: Record<string, any>) => {
    const id = redactedId(item.id); if (id) stats.completionId = id;
    const requestId = redactedId(item.request_id || item.requestId); if (requestId) stats.requestId = requestId;
    if (typeof item.model === 'string') {
      if (model && model !== item.model) fail('Fusion 流中模型标识发生变化，停止交付。', 'stream-invalid');
      model = options.redact(item.model).slice(0, 200);
    }
    if (item.usage) usage = fusionUsage(item.usage) || usage;
    if (item.error) {
      const error = record(item.error);
      fail(`Fusion 上游返回错误：${options.redact(String(error.message || '服务错误')).slice(0, 280)}`, 'upstream-error', {
        upstreamErrorCode: redactedId(error.code), upstreamErrorType: redactedId(error.type),
      });
    }
  };
  const frame = async (raw: string) => {
    if (!raw.trim()) return;
    if (raw.trim() === '[DONE]') { stats.done = true; return; }
    let item: Record<string, any>;
    try { item = record(JSON.parse(raw)); } catch { fail('Fusion 流包含无效 JSON 帧。', 'stream-invalid'); }
    envelope(item!);
    const choices = Array.isArray(item!.choices) ? item!.choices : [];
    const choice = choices.find((entry: any) => entry?.index === 0 || entry?.index === undefined);
    if (!choice) return; // Includes the final usage-only frame.
    const delta = record(choice.delta);
    if (typeof delta.reasoning_content === 'string') stats.reasoningChars += delta.reasoning_content.length;
    if (typeof delta.content === 'string' && delta.content) {
      if (stats.finishReason) fail('Fusion 终止帧之后又返回正文，停止交付。', 'stream-invalid');
      const firstContent = stats.firstContentMs === undefined;
      content += delta.content; stats.contentChars = content.length;
      if (content.length > 2_000_000) fail('Fusion 正文超过接收上限。', 'response-too-large');
      if (firstContent) stats.firstContentMs = Date.now() - options.startedAt;
      await notify(firstContent);
    }
    if (typeof choice.finish_reason === 'string') {
      if (stats.finishReason && stats.finishReason !== choice.finish_reason) fail('Fusion 返回互相矛盾的终止帧，停止交付。', 'stream-invalid');
      stats.finishReason = options.redact(choice.finish_reason).slice(0, 100);
    }
  };
  const reader = response.body?.getReader();
  if (!reader) fail('Fusion 返回了空响应体。', 'stream-incomplete');
  const onAbort = () => { void reader!.cancel(options.signal.reason).catch(() => undefined); };
  options.signal.addEventListener('abort', onAbort, { once: true });
  const decoder = new TextDecoder();
  let pending = '', dataLines: string[] = [], rawBytes = 0;
  try {
    while (true) {
      options.signal.throwIfAborted();
      const { value, done } = await reader!.read();
      options.signal.throwIfAborted();
      if (done) { pending += decoder.decode(); break; }
      const firstByte = stats.firstByteMs === undefined;
      if (firstByte) stats.firstByteMs = Date.now() - options.startedAt;
      const text = decoder.decode(value, { stream: true });
      if (!streaming || !response.ok) {
        rawBytes += value.byteLength;
        if (rawBytes > (response.ok ? 2_000_000 : 64_000)) fail('Fusion 响应超过接收上限。', 'response-too-large');
        pending += text;
      } else {
        pending += text;
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline).replace(/\r$/, '').replace(/^\uFEFF/, '');
          pending = pending.slice(newline + 1);
          if (!line) {
            if (dataLines.length) await frame(dataLines.join('\n'));
            dataLines = [];
            if (stats.done) break;
          } else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
          if (pending.length > 2_000_000 || dataLines.reduce((n, line) => n + line.length, 0) > 2_000_000) fail('Fusion 流帧超过接收上限。', 'response-too-large');
        }
        if (pending.length > 2_000_000) fail('Fusion 流帧超过接收上限。', 'response-too-large');
      }
      await notify(firstByte);
      if (stats.done) break;
    }
    options.signal.throwIfAborted();
    if (!response.ok) {
      let json: Record<string, any> = {}; try { json = record(JSON.parse(pending)); } catch {}
      const requestId = redactedId(json.request_id || json.requestId); if (requestId) stats.requestId = requestId;
      const error = record(json.error);
      fail(`Fusion HTTP ${response.status}：${options.redact(String(error.message || response.statusText || '调用失败')).slice(0, 280)}`, 'http-error', { upstreamErrorCode: redactedId(error.code) });
    }
    if (!streaming) {
      let item: Record<string, any>;
      try { item = record(JSON.parse(pending)); } catch { fail('Fusion 返回的响应不是合法 JSON。', 'response-invalid'); }
      envelope(item!);
      const choice = item!.choices?.[0];
      content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
      stats.contentChars = content.length;
      stats.reasoningChars = typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content.length : 0;
      stats.finishReason = typeof choice?.finish_reason === 'string' ? options.redact(choice.finish_reason).slice(0, 100) : undefined;
      if (content) stats.firstContentMs = Date.now() - options.startedAt;
      stats.done = Boolean(stats.finishReason);
    } else {
      if (pending.trim()) { // Accept a final event without a trailing blank line, but still require DONE.
        const line = pending.replace(/\r$/, ''); if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      if (!stats.done && dataLines.length) await frame(dataLines.join('\n'));
    }
    if (stats.finishReason === 'length') fail('Fusion 输出预算已耗尽，已停止同预算重复生成；请缩小需求或调整 Fusion 输出预算。', 'output-limit');
    if (!stats.done || !stats.finishReason) fail('Fusion 响应流提前结束，尚未收到完整结束标记，未交付半成品。', 'stream-incomplete');
    if (stats.finishReason !== 'stop') fail('Fusion 未正常完成文本生成，未交付作品。', 'response-incomplete');
    if (model !== 'fusion-max-2.0') fail('Fusion 返回模型与所选配置不一致，停止交付。', 'model-mismatch');
    if (!content.trim()) fail('Fusion 已结束但未返回可用正文。', 'empty-output');
    await notify(true);
    options.signal.throwIfAborted();
    return { content, model, usage, transport: { ...stats } };
  } catch (error) {
    if (error instanceof FusionResponseError) throw error;
    fail(options.signal.aborted ? 'Fusion 请求达到时间上限，已停止接收。' : 'Fusion 流式连接中断，未交付半成品。', options.signal.aborted ? 'timeout' : 'stream-incomplete');
  } finally {
    options.signal.removeEventListener('abort', onAbort);
    await reader!.cancel().catch(() => undefined);
    reader!.releaseLock();
  }
}
