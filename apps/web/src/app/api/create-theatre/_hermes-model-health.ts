import type { HermesModelProfile } from './_admin-settings';

type EndpointCheck = {
  ok: boolean;
  url: string;
  status?: number;
  durationMs: number;
  error?: string;
};

export type HermesModelHealthResult = {
  ok: boolean;
  available: boolean;
  testedAt: string;
  totalDurationMs: number;
  model: string;
  discovery: EndpointCheck & {
    modelCount?: number;
    modelFound?: boolean;
    sampleModels?: string[];
  };
  completion: EndpointCheck & {
    responsePreview?: string;
    returnedModel?: string;
  };
};

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const validateBaseUrl = (value: string) => {
  const parsed = new URL(trimTrailingSlash(value));
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL 仅支持 http:// 或 https://');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL 中不能包含账号或密码，请使用 API Key 字段');
  }
  return trimTrailingSlash(parsed.toString());
};

export const resolveHermesChatUrl = (baseUrl: string) => {
  const base = validateBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/^https:\/\/api\.deepseek\.com$/i.test(base)) return `${base}/chat/completions`;
  if (/\/(v\d+|openai|api)$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
};

export const shouldUseHermesResponsesApi = (model: string) => /^(?:gpt-5\.6-(?:sol|terra|luna)|gpt-6-astra)$/i.test(model.trim());

export const hermesReasoningEffort = (model: string) => /^gpt-6-astra$/i.test(model.trim()) ? 'high' : 'low';

export const resolveHermesResponsesUrl = (baseUrl: string) => {
  const base = validateBaseUrl(baseUrl);
  if (/\/responses$/i.test(base)) return base;
  if (/\/v\d+$/i.test(base)) return `${base}/responses`;
  if (/^https:\/\/api\.openai\.com$/i.test(base)) return `${base}/v1/responses`;
  return `${base}/responses`;
};

export const resolveHermesModelsUrl = (baseUrl: string) => {
  const base = validateBaseUrl(baseUrl);
  if (/\/chat\/completions$/i.test(base)) return base.replace(/\/chat\/completions$/i, '/models');
  if (/^https:\/\/api\.deepseek\.com$/i.test(base)) return `${base}/models`;
  if (/\/(v\d+|openai|api)$/i.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
};

const safePreview = (value: string, length = 280) => value.replace(/\s+/g, ' ').trim().slice(0, length);

const requestHeaders = (apiKey: string) => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
});

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, redirect: 'error', signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
};

const parseModelIds = (json: unknown) => {
  if (!json || typeof json !== 'object') return [];
  const record = json as Record<string, unknown>;
  const rows = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : [];
  return rows
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      const row = item as Record<string, unknown>;
      return String(row.id || row.name || row.model || '').trim();
    })
    .filter(Boolean);
};

const readResponseJson = async (response: Response) => {
  const text = await response.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }
  return { text, json };
};

export type HermesChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type HermesChatResult = {
  content: string;
  model: string;
  status: number;
  durationMs: number;
  completedAt: string;
};

export type HermesChatOptions = {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

const readChatContent = (json: Record<string, unknown>) => {
  const choices = Array.isArray(json.choices) ? json.choices : [];
  const firstChoice = choices[0] as Record<string, unknown> | undefined;
  const message = firstChoice?.message as Record<string, unknown> | undefined;
  const rawContent = message?.content;
  if (typeof rawContent === 'string') return rawContent.trim();
  if (Array.isArray(rawContent)) {
    return rawContent
      .map((item) => item && typeof item === 'object' ? String((item as Record<string, unknown>).text || '') : '')
      .join('')
      .trim();
  }
  return String(json.output_text || '').trim();
};

const readResponsesContent = (json: Record<string, unknown>) => {
  if (typeof json.output_text === 'string' && json.output_text.trim()) return json.output_text.trim();
  const output = Array.isArray(json.output) ? json.output : [];
  return output
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const content = Array.isArray((item as Record<string, unknown>).content)
        ? (item as Record<string, unknown>).content as unknown[]
        : [];
      return content.map((part) => {
        if (!part || typeof part !== 'object') return '';
        const row = part as Record<string, unknown>;
        return typeof row.text === 'string' ? row.text : '';
      });
    })
    .join('')
    .trim();
};

export const chatWithHermesModel = async (
  profile: HermesModelProfile,
  messages: HermesChatMessage[],
  options: HermesChatOptions = {},
): Promise<HermesChatResult> => {
  const baseUrl = profile.baseUrl.trim();
  const model = profile.model.trim();
  const apiKey = profile.apiKey.trim();
  if (!baseUrl) throw new Error('\u8bf7\u586b\u5199 Hermes URL');
  if (!model) throw new Error('\u8bf7\u586b\u5199\u6a21\u578b\u540d\u79f0');
  if (!messages.length) throw new Error('\u8bf7\u8f93\u5165\u5bf9\u8bdd\u5185\u5bb9');

  const chatUrl = resolveHermesChatUrl(baseUrl);
  const responsesMode = shouldUseHermesResponsesApi(model);
  const requestUrl = responsesMode ? resolveHermesResponsesUrl(baseUrl) : chatUrl;
  const startedAt = Date.now();
  const response = await fetchWithTimeout(requestUrl, {
    method: 'POST',
    headers: requestHeaders(apiKey),
    body: JSON.stringify(responsesMode
      ? {
          model,
          input: messages.map((message) => ({ role: message.role, content: message.content })),
          reasoning: { effort: hermesReasoningEffort(model) },
          max_output_tokens: options.maxTokens ?? 1200,
          stream: false,
          store: false,
        }
      : {
          model,
          messages,
          temperature: options.temperature ?? 0.7,
          max_tokens: options.maxTokens ?? 1200,
          stream: false,
        }),
  }, options.timeoutMs ?? 90_000);
  const { text, json } = await readResponseJson(response);
  if (!response.ok) {
    throw new Error(safePreview(text, 500) || `HTTP ${response.status}`);
  }
  const content = responsesMode ? readResponsesContent(json) : readChatContent(json);
  if (!content) throw new Error('\u6a21\u578b\u8fd4\u56de\u6210\u529f\uff0c\u4f46\u6ca1\u6709\u53ef\u663e\u793a\u7684\u5185\u5bb9');

  return {
    content,
    model: String(json.model || model).trim(),
    status: response.status,
    durationMs: Date.now() - startedAt,
    completedAt: new Date().toISOString(),
  };
};

export const testHermesModelConnection = async (
  profile: HermesModelProfile,
): Promise<HermesModelHealthResult> => {
  const baseUrl = profile.baseUrl.trim();
  const model = profile.model.trim();
  const apiKey = profile.apiKey.trim();
  if (!baseUrl) throw new Error('请填写 Hermes URL');
  if (!model) throw new Error('请填写模型名称');

  const totalStartedAt = Date.now();
  const modelsUrl = resolveHermesModelsUrl(baseUrl);
  const responsesMode = shouldUseHermesResponsesApi(model);
  const completionUrl = responsesMode ? resolveHermesResponsesUrl(baseUrl) : resolveHermesChatUrl(baseUrl);

  const discoveryStartedAt = Date.now();
  let discovery: HermesModelHealthResult['discovery'];
  try {
    const response = await fetchWithTimeout(modelsUrl, {
      method: 'GET',
      headers: requestHeaders(apiKey),
    }, 12_000);
    const { text, json } = await readResponseJson(response);
    const modelIds = parseModelIds(json);
    discovery = {
      ok: response.ok,
      url: modelsUrl,
      status: response.status,
      durationMs: Date.now() - discoveryStartedAt,
      modelCount: modelIds.length,
      modelFound: response.ok ? modelIds.includes(model) : undefined,
      sampleModels: modelIds.slice(0, 8),
      ...(!response.ok ? { error: safePreview(text) || `HTTP ${response.status}` } : {}),
    };
  } catch (error) {
    discovery = {
      ok: false,
      url: modelsUrl,
      durationMs: Date.now() - discoveryStartedAt,
      error: error instanceof Error ? error.message : '模型列表检测失败',
    };
  }

  const completionStartedAt = Date.now();
  let completion: HermesModelHealthResult['completion'];
  try {
    const response = await fetchWithTimeout(completionUrl, {
      method: 'POST',
      headers: requestHeaders(apiKey),
      body: JSON.stringify(responsesMode
        ? {
            model,
            input: [{ role: 'user', content: 'Reply with exactly AIYA_OK.' }],
            reasoning: { effort: hermesReasoningEffort(model) },
            max_output_tokens: 2048,
            stream: false,
            store: false,
          }
        : {
            model,
            messages: [{ role: 'user', content: 'Reply with exactly AIYA_OK.' }],
            temperature: 0,
            max_tokens: model === 'fusion-max-2.0' ? 1024 : 16,
            ...(model === 'fusion-max-2.0' ? { reasoning_effort: 'low' } : {}),
            stream: false,
          }),
    }, 45_000);
    const { text, json } = await readResponseJson(response);
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const firstChoice = choices[0] as Record<string, unknown> | undefined;
    const message = firstChoice?.message as Record<string, unknown> | undefined;
    const content = responsesMode
      ? readResponsesContent(json)
      : String(message?.content || json.output_text || '').trim();
    completion = {
      ok: response.ok && Boolean(content || (model !== 'fusion-max-2.0' && choices.length))
        && (model !== 'fusion-max-2.0' || json.model === model),
      url: completionUrl,
      status: response.status,
      durationMs: Date.now() - completionStartedAt,
      responsePreview: safePreview(content || text),
      returnedModel: String(json.model || '').trim() || undefined,
      ...(!response.ok ? { error: safePreview(text) || `HTTP ${response.status}` } : {}),
    };
    if (response.ok && !completion.ok) completion.error = '接口返回成功，但没有生成内容';
  } catch (error) {
    completion = {
      ok: false,
      url: completionUrl,
      durationMs: Date.now() - completionStartedAt,
      error: error instanceof Error ? error.message : '模型调用检测失败',
    };
  }

  return {
    ok: completion.ok,
    available: completion.ok,
    testedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - totalStartedAt,
    model,
    discovery,
    completion,
  };
};
