import path from 'node:path';

const splitArgs = (value) => String(value || '').split(/\s+/).filter(Boolean);

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') return value;
  }
  return '';
}

function makeCliProvider({ id, title, description, command, args, argsInitial, argsRepair, modelLabel, modelLabelInitial, modelLabelRepair, timeoutMs, timeoutMsInitial, timeoutMsRepair }) {
  return {
    id,
    title,
    description,
    command: command || '',
    args: splitArgs(args),
    argsInitial: splitArgs(argsInitial || args),
    argsRepair: splitArgs(argsRepair || args),
    modelLabel: modelLabel || title,
    modelLabelInitial: modelLabelInitial || modelLabel || title,
    modelLabelRepair: modelLabelRepair || modelLabel || title,
    timeoutMs: Number.parseInt(timeoutMs || '180000', 10),
    timeoutMsInitial: Number.parseInt(timeoutMsInitial || timeoutMs || '180000', 10),
    timeoutMsRepair: Number.parseInt(timeoutMsRepair || timeoutMs || '180000', 10),
  };
}

function buildCliProviders() {
  const codexArgs = process.env.AIYA_CREATE_CODEX_ARGS || '';
  return [
    makeCliProvider({
      id: 'codex',
      title: 'Codex CLI',
      description: 'OpenAI Codex 命令行编程与验证链路',
      command: process.env.AIYA_CREATE_CODEX_COMMAND || '',
      args: codexArgs,
      argsInitial: process.env.AIYA_CREATE_CODEX_ARGS_INITIAL || codexArgs,
      argsRepair: process.env.AIYA_CREATE_CODEX_ARGS_REPAIR || codexArgs,
      modelLabel: process.env.AIYA_CREATE_CODEX_MODEL_LABEL || 'codex-cli',
      modelLabelInitial: process.env.AIYA_CREATE_CODEX_MODEL_LABEL_INITIAL || process.env.AIYA_CREATE_CODEX_MODEL_LABEL || 'codex-cli',
      modelLabelRepair: process.env.AIYA_CREATE_CODEX_MODEL_LABEL_REPAIR || process.env.AIYA_CREATE_CODEX_MODEL_LABEL || 'codex-cli',
      timeoutMs: process.env.AIYA_CREATE_JOB_TIMEOUT_MS || '180000',
      timeoutMsInitial: process.env.AIYA_CREATE_JOB_TIMEOUT_MS_INITIAL || process.env.AIYA_CREATE_JOB_TIMEOUT_MS || '180000',
      timeoutMsRepair: process.env.AIYA_CREATE_JOB_TIMEOUT_MS_REPAIR || process.env.AIYA_CREATE_JOB_TIMEOUT_MS || '180000',
    }),
    makeCliProvider({
      id: 'claude-code',
      title: 'Claude Code',
      description: 'Claude Code 命令行编程链路，已接入 DeepPraxis Anthropic 网关',
      command: envValue('AIYA_CREATE_CLAUDE_CODE_COMMAND', 'AIYA_CREATE_CLAUDE_COMMAND') || 'claude',
      args: envValue('AIYA_CREATE_CLAUDE_CODE_ARGS', 'AIYA_CREATE_CLAUDE_ARGS') || '-p {prompt}',
      argsRepair: envValue('AIYA_CREATE_CLAUDE_CODE_ARGS_REPAIR', 'AIYA_CREATE_CLAUDE_ARGS_REPAIR') || envValue('AIYA_CREATE_CLAUDE_CODE_ARGS', 'AIYA_CREATE_CLAUDE_ARGS') || '-p {prompt}',
      modelLabel: envValue('AIYA_CREATE_CLAUDE_CODE_MODEL_LABEL', 'AIYA_CREATE_CLAUDE_MODEL_LABEL') || 'claude-code',
    }),
    makeCliProvider({
      id: 'gemini-cli',
      title: 'Gemini CLI',
      description: 'Google Gemini CLI 编程入口，可通过环境变量覆盖参数',
      command: envValue('AIYA_CREATE_GEMINI_CLI_COMMAND', 'AIYA_CREATE_GEMINI_COMMAND') || 'gemini',
      args: envValue('AIYA_CREATE_GEMINI_CLI_ARGS', 'AIYA_CREATE_GEMINI_ARGS') || '-p {prompt}',
      argsRepair: envValue('AIYA_CREATE_GEMINI_CLI_ARGS_REPAIR', 'AIYA_CREATE_GEMINI_ARGS_REPAIR') || envValue('AIYA_CREATE_GEMINI_CLI_ARGS', 'AIYA_CREATE_GEMINI_ARGS') || '-p {prompt}',
      modelLabel: envValue('AIYA_CREATE_GEMINI_CLI_MODEL_LABEL', 'AIYA_CREATE_GEMINI_MODEL_LABEL') || 'gemini-cli',
    }),
    makeCliProvider({
      id: 'qwen-code',
      title: 'Qwen Code',
      description: '通义 / Qwen 代码 CLI 入口，可通过环境变量覆盖参数',
      command: envValue('AIYA_CREATE_QWEN_CODE_COMMAND', 'AIYA_CREATE_QWEN_COMMAND') || 'qwen',
      args: envValue('AIYA_CREATE_QWEN_CODE_ARGS', 'AIYA_CREATE_QWEN_ARGS') || '-p {prompt}',
      argsRepair: envValue('AIYA_CREATE_QWEN_CODE_ARGS_REPAIR', 'AIYA_CREATE_QWEN_ARGS_REPAIR') || envValue('AIYA_CREATE_QWEN_CODE_ARGS', 'AIYA_CREATE_QWEN_ARGS') || '-p {prompt}',
      modelLabel: envValue('AIYA_CREATE_QWEN_CODE_MODEL_LABEL', 'AIYA_CREATE_QWEN_MODEL_LABEL') || 'qwen-code',
    }),
    makeCliProvider({
      id: 'aider',
      title: 'Aider',
      description: 'Aider 结对编程 CLI，适合本地模型或多模型配置',
      command: process.env.AIYA_CREATE_AIDER_COMMAND || 'aider',
      args: process.env.AIYA_CREATE_AIDER_ARGS || '--yes --message {prompt}',
      argsRepair: process.env.AIYA_CREATE_AIDER_ARGS_REPAIR || process.env.AIYA_CREATE_AIDER_ARGS || '--yes --message {prompt}',
      modelLabel: process.env.AIYA_CREATE_AIDER_MODEL_LABEL || 'aider',
    }),
  ];
}


function withModelArg(args, model) {
  const list = Array.isArray(args) ? [...args] : splitArgs(args);
  const index = list.findIndex((arg) => arg === '--model' || arg === '-m');
  if (index >= 0) {
    list[index + 1] = model;
    return list;
  }
  return ['--model', model, ...list];
}

function makeCliModelProfile({ id, providerId, title, description, model, args, argsInitial, argsRepair, modelLabel, modelLabelInitial, modelLabelRepair, timeoutMs, timeoutMsInitial, timeoutMsRepair, requiresAuthEnv, env, blockedReason }) {
  return {
    id,
    providerId,
    title,
    description,
    model,
    args: splitArgs(args),
    argsInitial: splitArgs(argsInitial || args),
    argsRepair: splitArgs(argsRepair || args),
    modelLabel: modelLabel || `${providerId}/${model}`,
    modelLabelInitial: modelLabelInitial || modelLabel || `${providerId}/${model}`,
    modelLabelRepair: modelLabelRepair || modelLabel || `${providerId}/${model}`,
    timeoutMs: timeoutMs ? Number.parseInt(timeoutMs, 10) : null,
    timeoutMsInitial: timeoutMsInitial ? Number.parseInt(timeoutMsInitial, 10) : null,
    timeoutMsRepair: timeoutMsRepair ? Number.parseInt(timeoutMsRepair, 10) : null,
    requiresAuthEnv: requiresAuthEnv || '',
    env: env || {},
    blockedReason: blockedReason || '',
  };
}

function buildCliModelProfiles(cliProviders) {
  return buildCliModelProfilesV2(cliProviders);
}

function buildCliModelProfilesV2(cliProviders) {
  const codexProvider = cliProviders.find((provider) => provider.id === 'codex');
  const codexBaseArgs = codexProvider?.args?.length
    ? codexProvider.args
    : splitArgs('exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral --ignore-user-config --ignore-rules --disable plugins --disable memories --color never -');
  const codexBaseInitialArgs = codexProvider?.argsInitial?.length ? codexProvider.argsInitial : codexBaseArgs;
  const codexBaseRepairArgs = codexProvider?.argsRepair?.length ? codexProvider.argsRepair : codexBaseArgs;
  const codexProfile = (id, title, model, description, repairModel = model) => makeCliModelProfile({
    id,
    providerId: 'codex',
    title,
    description,
    model,
    args: withModelArg(codexBaseArgs, model).join(' '),
    argsInitial: withModelArg(codexBaseInitialArgs, model).join(' '),
    argsRepair: withModelArg(codexBaseRepairArgs, repairModel).join(' '),
    modelLabel: `codex-cli/${model}`,
    modelLabelInitial: `codex-cli/${model}`,
    modelLabelRepair: `codex-cli/${repairModel}`,
    timeoutMs: process.env.AIYA_CREATE_JOB_TIMEOUT_MS || '180000',
    timeoutMsInitial: process.env.AIYA_CREATE_JOB_TIMEOUT_MS_INITIAL || process.env.AIYA_CREATE_JOB_TIMEOUT_MS || '180000',
    timeoutMsRepair: process.env.AIYA_CREATE_JOB_TIMEOUT_MS_REPAIR || process.env.AIYA_CREATE_JOB_TIMEOUT_MS || '180000',
  });
  const deepPraxisApiKey = process.env.AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY
    || process.env.AIYA_CREATE_FAST_DIRECT_HTML_API_KEY
    || process.env.AIYA_CREATE_FAST_MODEL_API_KEY
    || process.env.AIYA_CREATE_MODEL_API_KEY
    || '';
  const deepPraxisAnthropicBaseUrl = process.env.AIYA_CREATE_CLAUDE_DEEPPRAXIS_BASE_URL || 'https://api.deepraxis.ai/anthropic';
  const claudeArgs = (model) => `--bare --print --input-format text --model ${model} --effort low --permission-mode bypassPermissions --tools Read,Glob,Grep,Edit,Write,MultiEdit --disallowedTools Bash --no-session-persistence`;
  const claudeProfile = (id, title, model, description) => makeCliModelProfile({
    id,
    providerId: 'claude-code',
    title,
    description,
    model,
    args: claudeArgs(model),
    argsRepair: claudeArgs(model),
    modelLabel: `claude-code/deepraxis/${model}`,
    requiresAuthEnv: 'ANTHROPIC_API_KEY',
    env: {
      ANTHROPIC_API_KEY: deepPraxisApiKey,
      ANTHROPIC_BASE_URL: deepPraxisAnthropicBaseUrl,
      CLAUDE_CODE_SIMPLE: '1',
    },
  });
  const codexDeepPraxisHome = path.resolve(process.env.AIYA_CREATE_RUNNER_STATE_DIR || '.state/create-runner', 'codex-deepraxis-responses-home');
  const codexDeepPraxisAdapterBaseUrl = process.env.AIYA_CREATE_CODEX_DEEPPRAXIS_BASE_URL || `http://127.0.0.1:${process.env.PORT || '3334'}/codex-deepraxis/v1`;
  const codexDeepPraxisArgs = (model) => `exec --model ${model} --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check --ephemeral --disable plugins --disable memories --color never -`;
  const codexDeepPraxisProfile = (id, title, model, description) => makeCliModelProfile({
    id,
    providerId: 'codex',
    title,
    description,
    model,
    args: codexDeepPraxisArgs(model),
    argsRepair: codexDeepPraxisArgs(model),
    modelLabel: `codex-cli/deepraxis/${model}`,
    requiresAuthEnv: 'OPENAI_API_KEY',
    timeoutMs: process.env.AIYA_CREATE_CODEX_DEEPPRAXIS_TIMEOUT_MS || '180000',
    timeoutMsInitial: process.env.AIYA_CREATE_CODEX_DEEPPRAXIS_TIMEOUT_MS_INITIAL || process.env.AIYA_CREATE_CODEX_DEEPPRAXIS_TIMEOUT_MS || '180000',
    timeoutMsRepair: process.env.AIYA_CREATE_CODEX_DEEPPRAXIS_TIMEOUT_MS_REPAIR || process.env.AIYA_CREATE_CODEX_DEEPPRAXIS_TIMEOUT_MS || '180000',
    env: {
      CODEX_HOME: codexDeepPraxisHome,
      OPENAI_API_KEY: deepPraxisApiKey,
      AIYA_CODEX_DEEPPRAXIS_BASE_URL: codexDeepPraxisAdapterBaseUrl,
      AIYA_CODEX_DEEPPRAXIS_MODEL: model,
    },
  });
  return [
    claudeProfile('claude-deepraxis-qwen3-7-max', 'Claude Code - DeepPraxis Qwen3.7 Max', 'qwen3.7-max', 'Verified Anthropic-compatible DeepPraxis lane for Claude Code.'),
    claudeProfile('claude-deepraxis-deepseek-v4-pro', 'Claude Code - DeepPraxis DeepSeek V4 Pro', 'deepseek-v4-pro', 'DeepPraxis Anthropic-compatible coding lane for stronger reasoning.'),
    claudeProfile('claude-deepraxis-kimi-k2-7-code', 'Claude Code - DeepPraxis Kimi K2.7 Code', 'kimi-k2.7-code', 'DeepPraxis Anthropic-compatible code-specialized lane.'),
    codexDeepPraxisProfile('codex-deepraxis-kimi-k2-7-code', 'Codex CLI - DeepPraxis Kimi K2.7 Code', 'kimi-k2.7-code', 'Codex CLI through local Responses adapter to DeepPraxis OpenAI chat/completions.'),
    codexDeepPraxisProfile('codex-deepraxis-deepseek-v4-pro', 'Codex CLI - DeepPraxis DeepSeek V4 Pro', 'deepseek-v4-pro', 'Codex CLI through local Responses adapter to DeepPraxis OpenAI chat/completions.'),
    codexDeepPraxisProfile('codex-deepraxis-qwen3-7-max', 'Codex CLI - DeepPraxis Qwen3.7 Max', 'qwen3.7-max', 'Codex CLI through local Responses adapter to DeepPraxis OpenAI chat/completions.'),
  ];
}

export function getCliModelProfile(configObject, providerId, profileId) {
  const profiles = Array.isArray(configObject?.cliModelProfiles) ? configObject.cliModelProfiles : [];
  const fallbackId = configObject?.defaultCliModel || 'claude-deepraxis-qwen3-7-max';
  return profiles.find((profile) => profile.id === profileId && (!providerId || profile.providerId === providerId))
    || profiles.find((profile) => profile.id === fallbackId && (!providerId || profile.providerId === providerId))
    || profiles.find((profile) => profile.providerId === providerId)
    || null;
}

export function applyCliModelProfile(provider, profile) {
  if (!provider || !profile) return provider;
  return {
    ...provider,
    args: profile.args?.length ? profile.args : provider.args,
    argsInitial: profile.argsInitial?.length ? profile.argsInitial : provider.argsInitial,
    argsRepair: profile.argsRepair?.length ? profile.argsRepair : provider.argsRepair,
    modelLabel: profile.modelLabel || provider.modelLabel,
    modelLabelInitial: profile.modelLabelInitial || provider.modelLabelInitial,
    modelLabelRepair: profile.modelLabelRepair || provider.modelLabelRepair,
    timeoutMs: profile.timeoutMs || provider.timeoutMs,
    timeoutMsInitial: profile.timeoutMsInitial || provider.timeoutMsInitial,
    timeoutMsRepair: profile.timeoutMsRepair || provider.timeoutMsRepair,
    env: { ...(provider.env || {}), ...(profile.env || {}) },
    blockedReason: profile.blockedReason || '',
    selectedModelProfile: profile,
  };
}

function makeModelProvider({ id, title, description, baseUrl, apiKey, model, timeoutMs, maxTokens, temperature, apiType }) {
  return {
    id,
    title,
    description,
    baseUrl: baseUrl || '',
    apiKey: apiKey || '',
    model: model || '',
    timeoutMs: Number.parseInt(timeoutMs || '90000', 10),
    maxTokens: Number.parseInt(maxTokens || '8192', 10),
    temperature: Number.parseFloat(temperature || '0.15'),
    apiType: apiType || 'openai-chat',
  };
}

function buildModelProviders() {
  const direct = {
    id: 'direct',
    title: 'Direct',
    baseUrl: process.env.AIYA_CREATE_FAST_DIRECT_HTML_BASE_URL || process.env.AIYA_CREATE_FAST_MODEL_BASE_URL || process.env.AIYA_CREATE_MODEL_BASE_URL || '',
    apiKey: process.env.AIYA_CREATE_FAST_DIRECT_HTML_API_KEY || process.env.AIYA_CREATE_FAST_MODEL_API_KEY || process.env.AIYA_CREATE_MODEL_API_KEY || '',
  };
  const router = {
    id: 'router',
    title: 'Router',
    baseUrl: process.env.AIYA_CREATE_FAST_MODEL_BASE_URL || process.env.AIYA_CREATE_MODEL_BASE_URL || '',
    apiKey: process.env.AIYA_CREATE_FAST_MODEL_API_KEY || process.env.AIYA_CREATE_MODEL_API_KEY || '',
  };
  const arkResponses = {
    id: 'ark-responses',
    title: 'Doubao Assistant',
    baseUrl: process.env.DOUBAO_ASSISTANT_BASE_URL || process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: process.env.DOUBAO_ASSISTANT_API_KEY || process.env.ARK_API_KEY || '',
  };
  const deepSeekOfficial = {
    id: 'official-deepseek',
    title: 'DeepSeek Official',
    baseUrl: process.env.AIYA_CREATE_DEEPSEEK_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    apiKey: process.env.AIYA_CREATE_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '',
  };
  const timeoutMs = process.env.AIYA_CREATE_FAST_DIRECT_HTML_TIMEOUT_MS || process.env.AIYA_CREATE_FAST_MODEL_TIMEOUT_MS || '180000';
  const maxTokens = process.env.AIYA_CREATE_FAST_DIRECT_HTML_MAX_TOKENS || process.env.AIYA_CREATE_FAST_MODEL_MAX_TOKENS || '8192';
  const temperature = process.env.AIYA_CREATE_FAST_MODEL_TEMPERATURE || '0.15';
  const selected = [
    { channel: arkResponses, apiType: 'ark-responses', model: process.env.DOUBAO_ASSISTANT_MODEL || 'doubao-seed-2-1-pro-260628', title: 'Doubao Assistant Coder', description: 'Volcano Ark Responses API with Doubao Assistant, used as a controlled coding agent.' },
    { channel: deepSeekOfficial, model: 'deepseek-v4-flash', title: 'DeepSeek V4 Flash', description: 'Official DeepSeek API fast lane, isolated from third-party routers.' },
    { channel: deepSeekOfficial, model: 'deepseek-v4-pro', title: 'DeepSeek V4 Pro', description: 'Official DeepSeek API stronger reasoning lane, isolated from third-party routers.' },
    { channel: direct, model: 'kimi-k2.7-code', title: 'Kimi K2.7 Code', description: 'Code-specialized model from the PraxisRouter catalog; best first choice for app/demo coding.' },
    { channel: direct, model: 'deepseek-v4-pro', title: 'DeepSeek V4 Pro', description: 'Strong general coding and reasoning model.' },
    { channel: direct, model: 'glm-5.2', title: 'GLM-5.2', description: 'New strong model for structured generation and reasoning.' },
    { channel: router, model: 'qwen3.7-max', title: 'Qwen3.7 Max', description: 'High-capability Qwen model; kept for stronger-code comparisons.' },
    { channel: direct, model: 'minimax-m2.7', title: 'MiniMax M2.7', description: 'Modern strong model from the catalog; useful as a second-opinion generator.' },
    { channel: direct, model: 'doubao-seed-2.1-pro', title: 'Doubao Seed 2.1 Pro', description: 'Newer Pro-grade Doubao model; kept over older 2.0 variants.' },
    { channel: direct, model: 'deepseek-v4-flash', title: 'DeepSeek V4 Flash', description: 'Fast coding lane for quick iteration when speed matters.' },
  ];
  return selected
    .filter((item) => item.channel?.baseUrl)
    .map((item) => makeModelProvider({
      id: `${item.channel.id}-${item.model}`.replace(/[^a-z0-9_-]/gi, '-').toLowerCase(),
      title: `${item.title} - ${item.channel.title}`,
      description: item.description,
      baseUrl: item.channel.baseUrl,
      apiKey: item.channel.apiKey,
      model: item.model,
      timeoutMs,
      maxTokens,
      temperature,
      apiType: item.apiType,
    }));
}

const cliProviders = buildCliProviders();

export const config = {
  port: Number.parseInt(process.env.PORT || '3334', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  stateDir: path.resolve(process.env.AIYA_CREATE_RUNNER_STATE_DIR || '.state/create-runner'),
  workDir: path.resolve(process.env.AIYA_CREATE_RUNNER_WORK_DIR || '.state/create-runner/workspaces'),
  repoRoot: path.resolve(process.env.AIYA_CREATE_REPO_ROOT || path.join(process.cwd(), '../..')),
  codexMode: process.env.AIYA_CREATE_CODEX_MODE || 'auto',
  codexCommand: process.env.AIYA_CREATE_CODEX_COMMAND || '',
  codexArgs: (process.env.AIYA_CREATE_CODEX_ARGS || '').split(/\s+/).filter(Boolean),
  codexArgsInitial: (process.env.AIYA_CREATE_CODEX_ARGS_INITIAL || process.env.AIYA_CREATE_CODEX_ARGS || '').split(/\s+/).filter(Boolean),
  codexArgsRepair: (process.env.AIYA_CREATE_CODEX_ARGS_REPAIR || process.env.AIYA_CREATE_CODEX_ARGS || '').split(/\s+/).filter(Boolean),
  codexModelLabel: process.env.AIYA_CREATE_CODEX_MODEL_LABEL || '',
  codexModelLabelInitial: process.env.AIYA_CREATE_CODEX_MODEL_LABEL_INITIAL || process.env.AIYA_CREATE_CODEX_MODEL_LABEL || '',
  codexModelLabelRepair: process.env.AIYA_CREATE_CODEX_MODEL_LABEL_REPAIR || process.env.AIYA_CREATE_CODEX_MODEL_LABEL || '',
  jobTimeoutMs: Number.parseInt(process.env.AIYA_CREATE_JOB_TIMEOUT_MS || '180000', 10),
  jobTimeoutMsInitial: Number.parseInt(process.env.AIYA_CREATE_JOB_TIMEOUT_MS_INITIAL || process.env.AIYA_CREATE_JOB_TIMEOUT_MS || '180000', 10),
  jobTimeoutMsRepair: Number.parseInt(process.env.AIYA_CREATE_JOB_TIMEOUT_MS_REPAIR || process.env.AIYA_CREATE_JOB_TIMEOUT_MS || '180000', 10),
  repairAttempts: Number.parseInt(process.env.AIYA_CREATE_REPAIR_ATTEMPTS || '2', 10),
  fastLaneEnabled: (process.env.AIYA_CREATE_FAST_LANE_ENABLED || 'true') !== 'false',
  fastModelBaseUrl: process.env.AIYA_CREATE_FAST_MODEL_BASE_URL || process.env.AIYA_CREATE_MODEL_BASE_URL || '',
  fastModelApiKey: process.env.AIYA_CREATE_FAST_MODEL_API_KEY || process.env.AIYA_CREATE_MODEL_API_KEY || '',
  fastModel: process.env.AIYA_CREATE_FAST_MODEL || process.env.AIYA_CREATE_MODEL || 'deepseek-v4-pro',
  fastModelTimeoutMs: Number.parseInt(process.env.AIYA_CREATE_FAST_MODEL_TIMEOUT_MS || '90000', 10),
  fastModelMaxTokens: Number.parseInt(process.env.AIYA_CREATE_FAST_MODEL_MAX_TOKENS || '8192', 10),
  fastModelTemperature: Number.parseFloat(process.env.AIYA_CREATE_FAST_MODEL_TEMPERATURE || '0.15'),
  fastModelAttempts: Number.parseInt(process.env.AIYA_CREATE_FAST_MODEL_ATTEMPTS || '2', 10),
  fastDirectHtmlBaseUrl: process.env.AIYA_CREATE_FAST_DIRECT_HTML_BASE_URL || process.env.AIYA_CREATE_FAST_MODEL_BASE_URL || process.env.AIYA_CREATE_MODEL_BASE_URL || '',
  fastDirectHtmlApiKey: process.env.AIYA_CREATE_FAST_DIRECT_HTML_API_KEY || process.env.AIYA_CREATE_FAST_MODEL_API_KEY || process.env.AIYA_CREATE_MODEL_API_KEY || '',
  fastDirectHtmlModel: process.env.AIYA_CREATE_FAST_DIRECT_HTML_MODEL || process.env.AIYA_CREATE_FAST_MODEL || process.env.AIYA_CREATE_MODEL || 'deepseek-v3',
  fastDirectHtmlTimeoutMs: Number.parseInt(process.env.AIYA_CREATE_FAST_DIRECT_HTML_TIMEOUT_MS || process.env.AIYA_CREATE_FAST_MODEL_TIMEOUT_MS || '180000', 10),
  fastDirectHtmlMaxTokens: Number.parseInt(process.env.AIYA_CREATE_FAST_DIRECT_HTML_MAX_TOKENS || process.env.AIYA_CREATE_FAST_MODEL_MAX_TOKENS || '8192', 10),
  fastDirectHtmlAttempts: Number.parseInt(process.env.AIYA_CREATE_FAST_DIRECT_HTML_ATTEMPTS || '2', 10),
  codexFallbackOnFastLaneFail: (process.env.AIYA_CREATE_CODEX_FALLBACK_ON_FAST_LANE_FAIL || 'true') !== 'false',
  modelProviders: buildModelProviders(),
  defaultModelProvider: process.env.AIYA_CREATE_DEFAULT_MODEL_PROVIDER || 'direct-kimi-k2-7-code',
  cliProviders,
  defaultCliProvider: process.env.AIYA_CREATE_DEFAULT_CLI_PROVIDER || 'claude-code',
  cliModelProfiles: buildCliModelProfilesV2(cliProviders),
  defaultCliModel: process.env.AIYA_CREATE_DEFAULT_CLI_MODEL || 'claude-deepraxis-qwen3-7-max',
  deepPraxisApiKey: process.env.AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY || process.env.AIYA_CREATE_FAST_DIRECT_HTML_API_KEY || process.env.AIYA_CREATE_FAST_MODEL_API_KEY || process.env.AIYA_CREATE_MODEL_API_KEY || '',
  codexDeepPraxisUpstreamBaseUrl: process.env.AIYA_CREATE_CODEX_DEEPPRAXIS_UPSTREAM_BASE_URL || 'https://api.deepraxis.ai/openai/v1',
  maxParallelJobs: Number.parseInt(process.env.AIYA_CREATE_MAX_PARALLEL_JOBS || '4', 10),
};


export function getCliProvider(configObject, providerId) {
  const providers = Array.isArray(configObject?.cliProviders) ? configObject.cliProviders : [];
  const fallbackId = configObject?.defaultCliProvider || 'claude-code';
  return providers.find((provider) => provider.id === providerId)
    || providers.find((provider) => provider.id === fallbackId)
    || providers[0]
    || null;
}

export function publicCliProvider(provider) {
  if (!provider) return null;
  return {
    id: provider.id,
    title: provider.title,
    description: provider.description,
    command: provider.command,
    modelLabel: provider.modelLabel,
    configured: Boolean(provider.command),
  };
}

export function publicCliModelProfile(profile, providerStatus) {
  if (!profile) return null;
  const provider = providerStatus?.find((item) => item.id === profile.providerId);
  const authConfigured = profile.requiresAuthEnv ? Boolean(process.env[profile.requiresAuthEnv] || profile.env?.[profile.requiresAuthEnv]) : true;
  const blocked = Boolean(profile.blockedReason);
  return {
    id: profile.id,
    providerId: profile.providerId,
    title: profile.title,
    description: profile.description,
    model: profile.model,
    modelLabel: profile.modelLabel,
    configured: Boolean(provider?.configured),
    installed: Boolean(provider?.installed),
    available: Boolean(provider?.available && authConfigured && !blocked),
    authConfigured,
    authHint: profile.blockedReason || (profile.requiresAuthEnv ? `${profile.requiresAuthEnv} ${authConfigured ? 'configured' : 'missing'}` : ''),
    blockedReason: profile.blockedReason || '',
  };
}


export function getModelProvider(configObject, providerId) {
  const providers = Array.isArray(configObject?.modelProviders) ? configObject.modelProviders : [];
  const fallbackId = configObject?.defaultModelProvider || 'direct-kimi-k2-7-code';
  return providers.find((provider) => provider.id === providerId)
    || providers.find((provider) => provider.model === providerId)
    || providers.find((provider) => provider.id === fallbackId || provider.model === fallbackId)
    || providers[0]
    || null;
}

export function publicModelProvider(provider) {
  if (!provider) return null;
  return {
    id: provider.id,
    title: provider.title,
    description: provider.description,
    model: provider.model,
    baseUrl: provider.baseUrl,
    apiType: provider.apiType,
    configured: Boolean(provider.baseUrl && provider.apiKey && provider.model),
  };
}
