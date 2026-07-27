import Fastify from 'fastify';
import { spawn } from 'node:child_process';
import { config, publicCliModelProfile, publicCliProvider, publicModelProvider } from './config.js';
import { JobStore, publicJob } from './store.js';
import { CreatePipeline } from './pipeline.js';
import { codexDeepPraxisAdapterHealth, handleCodexDeepPraxisResponses } from './codex-deepraxis-adapter.js';

const fastify = Fastify({ logger: { level: config.logLevel } });
const store = new JobStore({ stateDir: config.stateDir });
const pipeline = new CreatePipeline({ store, config });
let modelHealthCache = { at: 0, items: [] };
const MODEL_HEALTH_CACHE_MS = 30_000;
const MODEL_HEALTH_TIMEOUT_MS = 15_000;

fastify.get('/health', async () => {
  const cliProviders = await Promise.all((config.cliProviders || []).map(async (provider) => {
    const pub = publicCliProvider(provider);
    const installed = provider.command ? await commandExists(provider.command) : false;
    return { ...pub, installed, available: Boolean(pub?.configured && installed) };
  }));
  const cliModels = (config.cliModelProfiles || []).map((profile) => publicCliModelProfile(profile, cliProviders));
  const modelProviders = await getModelProviderHealth();
  const defaultProvider = cliProviders.find((provider) => provider.id === config.defaultCliProvider) || cliProviders[0];
  return {
    status: defaultProvider?.available && config.codexMode !== 'mock' ? 'ok' : 'misconfigured',
    service: 'aiya-create-runner',
    timestamp: new Date().toISOString(),
    codexMode: config.codexMode === 'mock' ? 'mock-disabled' : (config.codexCommand ? 'command' : 'not-configured'),
    fastLane: {
      enabled: config.fastLaneEnabled,
      configured: Boolean(config.fastModelBaseUrl && config.fastModelApiKey && config.fastModel),
      model: config.fastModel || null,
      baseUrl: config.fastModelBaseUrl || null,
      attempts: config.fastModelAttempts,
      directHtmlModel: config.fastDirectHtmlModel,
      directHtmlBaseUrl: config.fastDirectHtmlBaseUrl,
      directHtmlConfigured: Boolean(config.fastDirectHtmlBaseUrl && config.fastDirectHtmlApiKey && config.fastDirectHtmlModel),
      directHtmlTimeoutMs: config.fastDirectHtmlTimeoutMs,
      directHtmlMaxTokens: config.fastDirectHtmlMaxTokens,
      directHtmlAttempts: config.fastDirectHtmlAttempts,
      codexFallbackOnFail: config.codexFallbackOnFastLaneFail,
    },
    cliProviders,
    defaultCliProvider: config.defaultCliProvider,
    cliModels,
    defaultCliModel: config.defaultCliModel,
    codexDeepPraxisAdapter: codexDeepPraxisAdapterHealth(config),
    modelProviders,
    defaultModelProvider: config.defaultModelProvider,
    maxParallelJobs: config.maxParallelJobs,
    runtime: pipeline.stats(),
    fallbackEnabled: false,
  };
});

fastify.post('/codex-deepraxis/v1/responses', async (request, reply) => {
  return handleCodexDeepPraxisResponses(request, reply, config);
});

fastify.post('/jobs', async (request, reply) => {
  const body = request.body || {};
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const revision = typeof body.revision === 'string' ? body.revision.trim() : '';
  const currentApp = body.currentApp && typeof body.currentApp === 'object' ? body.currentApp : null;
  const requestedMode = typeof body.mode === 'string' ? body.mode.trim() : '';
  const mode = ['codex', 'cli', 'model', 'auto'].includes(requestedMode) ? (requestedMode === 'cli' ? 'codex' : requestedMode) : 'auto';
  const requestedCliProvider = typeof body.cliProvider === 'string' ? body.cliProvider.trim() : '';
  const providerIds = new Set((config.cliProviders || []).map((provider) => provider.id));
  if (requestedCliProvider && !providerIds.has(requestedCliProvider)) {
    return reply.code(400).send({ error: `unknown cliProvider: ${requestedCliProvider}` });
  }
  const cliProvider = requestedCliProvider || (config.defaultCliProvider || 'codex');
  const requestedCliModel = typeof body.cliModel === 'string' ? body.cliModel.trim() : '';
  const cliModelIds = new Set((config.cliModelProfiles || []).filter((profile) => profile.providerId === cliProvider).map((profile) => profile.id));
  if (requestedCliModel && !cliModelIds.has(requestedCliModel)) {
    return reply.code(400).send({ error: `unknown cliModel for ${cliProvider}: ${requestedCliModel}` });
  }
  const cliModel = requestedCliModel || (config.cliModelProfiles || []).find((profile) => profile.id === config.defaultCliModel && profile.providerId === cliProvider)?.id || (config.cliModelProfiles || []).find((profile) => profile.providerId === cliProvider)?.id || '';
  const requestedModelProvider = typeof body.modelProvider === 'string' ? body.modelProvider.trim() : '';
  const modelProviderIds = new Set((config.modelProviders || []).flatMap((provider) => [provider.id, provider.model]));
  if (requestedModelProvider && !modelProviderIds.has(requestedModelProvider)) {
    return reply.code(400).send({ error: `unknown modelProvider: ${requestedModelProvider}` });
  }
  const modelFallbacks = Array.isArray(body.modelFallbacks)
    ? body.modelFallbacks.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const unknownFallback = modelFallbacks.find((modelProvider) => !modelProviderIds.has(modelProvider));
  if (unknownFallback) {
    return reply.code(400).send({ error: `unknown modelFallbacks item: ${unknownFallback}` });
  }
  const modelProvider = requestedModelProvider || (config.defaultModelProvider || 'deepseek-v4-pro');
  if (!prompt && !currentApp) return reply.code(400).send({ error: 'prompt or currentApp is required' });
  if (prompt.length > 1600 || revision.length > 1600) return reply.code(400).send({ error: 'prompt or revision is too long' });
  const job = store.createJob({ prompt, revision, currentApp, mode, cliProvider, cliModel, modelProvider, modelFallbacks });
  pipeline.enqueue(job);
  return reply.code(202).send({ job: publicJob(job) });
});

fastify.get('/jobs', async () => ({ items: store.list().map(publicJob) }));

fastify.get('/jobs/:id', async (request, reply) => {
  const job = store.get(request.params.id);
  if (!job) return reply.code(404).send({ error: 'job not found' });
  return { job: publicJob(job) };
});

fastify.get('/jobs/:id/events', async (request, reply) => {
  const job = store.get(request.params.id);
  if (!job) return reply.code(404).send({ error: 'job not found' });
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
  });
  const send = (payload) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ type: 'job', job: publicJob(job) });
  const unsubscribe = store.subscribe(job.id, send);
  request.raw.on('close', unsubscribe);
});


async function getModelProviderHealth() {
  const now = Date.now();
  if (now - modelHealthCache.at < MODEL_HEALTH_CACHE_MS && modelHealthCache.items.length) return modelHealthCache.items;
  const items = await Promise.all((config.modelProviders || []).map(pingModelProvider));
  modelHealthCache = { at: now, items };
  return items;
}

async function pingModelProvider(provider) {
  const pub = publicModelProvider(provider);
  if (!pub?.configured) {
    return { ...pub, available: false, latencyMs: null, error: 'not configured' };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_HEALTH_TIMEOUT_MS);
  try {
    const response = provider.apiType === 'ark-responses'
      ? await fetch(`${trimTrailingSlash(provider.baseUrl)}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
          'ark-beta-doubao-app': 'true',
        },
        body: JSON.stringify({
          model: provider.model,
          stream: false,
          tools: [{
            type: 'doubao_app',
            feature: {
              chat: {
                type: 'enabled',
                role_description: '你是 AIYA 的连通性检测助手，只回复 pong。',
              },
              deep_chat: { type: 'disabled' },
              ai_search: { type: 'disabled' },
              reasoning_search: { type: 'disabled' },
            },
          }],
          input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
        }),
        signal: controller.signal,
      })
      : await fetch(`${trimTrailingSlash(provider.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: controller.signal,
      });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ...pub, available: false, latencyMs, error: `HTTP ${response.status}: ${text.slice(0, 120)}` };
    }
    return { ...pub, available: true, latencyMs, error: null };
  } catch (error) {
    return { ...pub, available: false, latencyMs: Date.now() - started, error: error?.name === 'AbortError' ? 'timeout' : (error?.message || 'ping failed') };
  } finally {
    clearTimeout(timer);
  }
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function commandExists(command) {
  return new Promise((resolve) => {
    if (!command) return resolve(false);
    const checker = process.platform === 'win32' ? 'where' : 'command';
    const args = process.platform === 'win32' ? [command] : ['-v', command];
    const child = spawn(checker, args, { shell: process.platform !== 'win32', stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

async function main() {

  await store.init();
  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info(`AIYA Create Runner listening on ${config.port}`);
}

main().catch((error) => {
  fastify.log.error(error);
  process.exit(1);
});
