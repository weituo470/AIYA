import Fastify from 'fastify';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import websocket from '@fastify/websocket';

const config = {
  port: Number.parseInt(process.env.PORT || '3335', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  stateDir: path.resolve(process.env.AIYA_DEV_STATE_DIR || '.state/dev-runner'),
  workDir: path.resolve(process.env.AIYA_DEV_WORK_DIR || '.state/dev-runner/workspaces'),
  codexCommand: process.env.AIYA_DEV_CODEX_COMMAND || 'codex',
  codexModel: process.env.AIYA_DEV_CODEX_MODEL || 'kimi-k2.7-code',
  codexNativeModel: process.env.AIYA_DEV_NATIVE_CODEX_MODEL || 'gpt-5.4-mini',
  codexTimeoutMs: Number.parseInt(process.env.AIYA_DEV_CODEX_TIMEOUT_MS || '300000', 10),
  codexAuthMode: process.env.AIYA_DEV_CODEX_AUTH_MODE || 'deepraxis-responses',
  codexResponsesBaseUrl: process.env.AIYA_DEV_CODEX_RESPONSES_BASE_URL || 'http://127.0.0.1:3334/codex-deepraxis/v1',
  claudeCommand: process.env.AIYA_DEV_CLAUDE_COMMAND || 'claude',
  claudeModel: process.env.AIYA_DEV_CLAUDE_MODEL || 'qwen3.7-max',
  claudeBaseUrl: process.env.AIYA_DEV_CLAUDE_BASE_URL || 'https://api.deepraxis.ai/anthropic',
};

const fastify = Fastify({ logger: { level: config.logLevel } });
const sessions = new Map();
const listeners = new Map();
const nativeProcesses = new Map();

await fastify.register(websocket, { options: { maxPayload: 1024 * 1024 } });

const now = () => new Date().toISOString();
const stableProviders = new Set(['claude-code', 'codex-native']);
const normalizeProvider = (value) => stableProviders.has(value) ? value : 'claude-code';
const modelForProvider = (provider) => provider === 'claude-code' ? config.claudeModel : config.codexNativeModel;
const publicSession = (session) => ({
  id: session.id,
  title: session.title,
  status: session.status,
  workspace: session.workspace,
  provider: session.provider,
  model: session.model,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  lastError: session.lastError || null,
  events: session.events.slice(-80),
});

fastify.get('/health', async () => ({
  status: 'ok',
  service: 'aiya-dev-runner',
  timestamp: now(),
  codexCommand: config.codexCommand,
  codexModel: config.codexModel,
  codexNativeModel: config.codexNativeModel,
  codexAuthMode: config.codexAuthMode,
  claudeCommand: config.claudeCommand,
  claudeModel: config.claudeModel,
  workDir: config.workDir,
}));

fastify.get('/diagnostics', async () => ({
  timestamp: now(),
  codex: await codexDiagnostics(),
  claude: await claudeDiagnostics(),
}));

fastify.get('/terminal', { websocket: true }, (socket, request) => {
  const sessionId = typeof request.query.sessionId === 'string' ? request.query.sessionId : '';
  const session = sessions.get(sessionId);
  if (!session) {
    socket.send('\r\n\x1b[31mAIYA Dev Runner: session not found.\x1b[0m\r\n');
    socket.close();
    return;
  }
  const provider = normalizeProvider(typeof request.query.provider === 'string' ? request.query.provider : session.provider);
  session.provider = provider;
  session.model = modelForProvider(session.provider);
  session.status = 'interactive';
  saveSession(session).catch(() => {});

  let proc = null;
  let disposed = false;
  const start = async () => {
    try {
      const pty = await import('node-pty');
      const cols = Number.parseInt(request.query.cols || '120', 10) || 120;
      const rows = Number.parseInt(request.query.rows || '32', 10) || 32;
      const cli = session.provider === 'claude-code' ? resolveClaudeCommand(config.claudeCommand) : resolveCodexCommand(config.codexCommand);
      const command = cli.command;
      const args = session.provider === 'claude-code'
        ? [...cli.args, '--bare', '--model', config.claudeModel, '--permission-mode', 'acceptEdits', '--settings', JSON.stringify({ theme: 'custom:aiya-web', tui: 'default' })]
        : [...cli.args, ...codexNativeArgs(session.workspace)];
      const env = session.provider === 'claude-code' ? await claudeEnv() : await codexNativeEnv();
      socket.send(`\x1b[90mAIYA Web Terminal connected. Launching ${session.provider === 'claude-code' ? 'Claude Code' : 'native Codex CLI'}...\x1b[0m\r\n`);
      proc = pty.spawn(command, args, {
        name: 'xterm-256color',
        cwd: session.workspace,
        env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        cols,
        rows,
      });
      proc.onData((data) => {
        if (!disposed && socket.readyState === 1) socket.send(data);
      });
      proc.onExit(({ exitCode }) => {
        if (disposed) return;
        session.status = exitCode === 0 ? 'idle' : 'failed';
        saveSession(session).catch(() => {});
        try { socket.send(`\r\n\x1b[90m[${session.provider === 'claude-code' ? 'Claude Code' : 'Codex CLI'} exited ${exitCode ?? 0}]\x1b[0m\r\n`); } catch {}
        try { socket.close(); } catch {}
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      socket.send(`\r\n\x1b[31mAIYA Dev Runner: failed to start native terminal: ${message}\x1b[0m\r\n`);
      socket.close();
    }
  };

  socket.on('message', (message) => {
    const text = message.toString();
    try {
      const payload = JSON.parse(text);
      if (payload?.type === 'input' && typeof payload.data === 'string') {
        proc?.write(payload.data);
      } else if (payload?.type === 'resize') {
        const cols = Math.max(20, Math.min(240, Number.parseInt(payload.cols, 10) || 120));
        const rows = Math.max(8, Math.min(80, Number.parseInt(payload.rows, 10) || 32));
        proc?.resize(cols, rows);
      }
    } catch {
      proc?.write(text);
    }
  });
  socket.on('close', () => {
    disposed = true;
    try { proc?.kill(); } catch {}
    session.status = 'idle';
    saveSession(session).catch(() => {});
  });
  start();
});

fastify.get('/sessions', async () => ({ items: [...sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicSession) }));

fastify.post('/sessions', async (request, reply) => {
  const body = request.body || {};
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : 'Untitled Dev Session';
  const provider = normalizeProvider(typeof body.provider === 'string' && body.provider.trim() ? body.provider.trim() : 'claude-code');
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : modelForProvider(provider);
  const session = await createSession({ title, model, provider });
  return reply.code(201).send({ session: publicSession(session) });
});

fastify.get('/sessions/:id', async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) return reply.code(404).send({ error: 'session not found' });
  return { session: publicSession(session) };
});

fastify.post('/sessions/:id/messages', async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) return reply.code(404).send({ error: 'session not found' });
  if (session.status === 'running') return reply.code(409).send({ error: 'session is already running' });
  const body = request.body || {};
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : session.model;
  if (!content) return reply.code(400).send({ error: 'content is required' });
  if (content.length > 12000) return reply.code(400).send({ error: 'content is too long' });
  session.model = model;
  if (session.provider === 'codex-native') {
    addEvent(session, 'user', content);
    await sendNativeInput(session, content);
    return reply.code(202).send({ session: publicSession(session) });
  }
  session.status = 'running';
  session.updatedAt = now();
  addEvent(session, 'user', content);
  addEvent(session, 'system', `starting Codex CLI in ${session.workspace}`);
  saveSession(session).catch(() => {});
  runCodexTurn(session, content).catch((error) => {
    session.status = 'failed';
    session.lastError = error instanceof Error ? error.message : String(error || 'run failed');
    addEvent(session, 'error', session.lastError);
    saveSession(session).catch(() => {});
  });
  return reply.code(202).send({ session: publicSession(session) });
});

fastify.get('/sessions/:id/events', async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) return reply.code(404).send({ error: 'session not found' });
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  const send = (payload) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ type: 'session', session: publicSession(session) });
  const unsubscribe = subscribe(session.id, send);
  request.raw.on('close', unsubscribe);
});

fastify.get('/sessions/:id/files', async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) return reply.code(404).send({ error: 'session not found' });
  const tree = await listFiles(session.workspace);
  const filePath = typeof request.query.path === 'string' ? request.query.path : '';
  let file = null;
  if (filePath) file = await readWorkspaceFile(session.workspace, filePath);
  return { tree, file };
});

fastify.get('/sessions/:id/preview', async (request, reply) => {
  const session = sessions.get(request.params.id);
  if (!session) return reply.code(404).send({ error: 'session not found' });
  const candidates = ['index.html', 'dist/index.html', 'public/index.html'];
  for (const rel of candidates) {
    const full = path.join(session.workspace, rel);
    if (isInside(session.workspace, full) && fsSync.existsSync(full)) {
      const html = await fs.readFile(full, 'utf8');
      return reply.type('text/html; charset=utf-8').send(html);
    }
  }
  return reply.type('text/html; charset=utf-8').send(`<main style="font-family:system-ui;padding:32px"><h1>暂无预览</h1><p>让 Codex 在当前会话中创建 index.html 后，这里会显示预览。</p></main>`);
});

async function init() {
  await fs.mkdir(config.stateDir, { recursive: true });
  await fs.mkdir(config.workDir, { recursive: true });
  const dir = path.join(config.stateDir, 'sessions');
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const session = JSON.parse(await fs.readFile(path.join(dir, entry.name), 'utf8'));
      if (!session?.id || !session?.workspace) continue;
      if (session.status === 'running' || session.status === 'interactive') session.status = 'idle';
      const provider = normalizeProvider(session.provider);
      sessions.set(session.id, {
        ...session,
        provider,
        model: modelForProvider(provider),
        events: Array.isArray(session.events) ? session.events : [],
      });
    } catch {}
  }
}

async function createSession({ title, model, provider = 'claude-code' }) {
  const normalizedProvider = normalizeProvider(provider);
  const id = `dev_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const workspace = path.join(config.workDir, id);
  await fs.mkdir(workspace, { recursive: true });
  const session = {
    id,
    title,
    status: 'idle',
    workspace,
    provider: normalizedProvider,
    model: model || modelForProvider(normalizedProvider),
    createdAt: now(),
    updatedAt: now(),
    events: [],
    lastError: null,
  };
  await fs.writeFile(path.join(workspace, 'README.md'), `# ${title}\n\nAIYA Dev Terminal workspace.\n`, 'utf8');
  sessions.set(id, session);
  addEvent(session, 'system', `workspace created: ${workspace}`);
  if (session.provider === 'codex-native') addEvent(session, 'system', 'native Codex CLI session; slash commands are passed through as-is.');
  await saveSession(session);
  return session;
}

async function runCodexTurn(session, prompt) {
  const env = await codexEnv(session.model);
  const args = [
    'exec',
    '--model', session.model,
    '--dangerously-bypass-approvals-and-sandbox',
    '--skip-git-repo-check',
    '--ephemeral',
    '--disable', 'plugins',
    '--disable', 'memories',
    '--color', 'never',
    '-',
  ];
  addEvent(session, 'command', `${config.codexCommand} ${args.join(' ')}`);
  const result = await runCommand(config.codexCommand, args, {
    cwd: session.workspace,
    input: prompt,
    timeoutMs: config.codexTimeoutMs,
    env,
    onChunk: (text) => addEvent(session, 'stdout', sanitize(text)),
  });
  session.status = result.code === 0 ? 'idle' : 'failed';
  session.updatedAt = now();
  addEvent(session, result.code === 0 ? 'done' : 'error', `exit code ${result.code}`);
  await saveSession(session);
}

async function sendNativeInput(session, content) {
  if (!hasNativeCodexAuth()) {
    const current = nativeProcesses.get(session.id);
    if (current?.alive) {
      try { current.kill?.(); } catch {}
      nativeProcesses.delete(session.id);
    }
    session.status = 'idle';
    session.lastError = '原生 Codex CLI 尚未登录';
    addEvent(session, 'error', '原生 Codex CLI 尚未登录。请先在本机/服务器终端执行 `codex login`，登录完成后回到本页点击“重新检测”。登录前 /help、/model 等 slash 命令会被登录流程拦截。');
    addEvent(session, 'system', `当前输入未发送给原生 CLI：${content}`);
    await saveSession(session);
    return;
  }
  const terminal = await startNativeCodex(session);
  if (!terminal?.write) {
    session.status = 'failed';
    session.lastError = 'native Codex CLI terminal is not writable';
    addEvent(session, 'error', session.lastError);
    await saveSession(session);
    return;
  }
  terminal.write(`${content}\r`);
  session.status = 'interactive';
  session.updatedAt = now();
  await saveSession(session);
}

async function startNativeCodex(session) {
  const current = nativeProcesses.get(session.id);
  if (current?.alive) return current;

  const args = [
    '--no-alt-screen',
    ...codexNativeArgs(session.workspace),
  ];
  addEvent(session, 'command', `${config.codexCommand} ${args.join(' ')}`);
  const nativeCommand = resolveNativeCodexCommand(config.codexCommand);
  const terminal = await spawnNativeTerminal(nativeCommand, args, session);
  nativeProcesses.set(session.id, terminal);
  session.status = 'interactive';
  addEvent(session, 'system', 'native Codex CLI started. You can type /help or other slash commands.');
  saveSession(session).catch(() => {});
  return terminal;
}

async function spawnNativeTerminal(command, args, session) {
  const env = await codexNativeEnv();
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  try {
    const pty = await import('node-pty');
    const proc = pty.spawn(command, args, {
      name: 'xterm-256color',
      cwd: session.workspace,
      env,
      cols: 120,
      rows: 32,
    });
    const terminal = {
      alive: true,
      write: (text) => proc.write(text),
      kill: () => proc.kill(),
    };
    proc.onData((data) => addEvent(session, 'stdout', sanitize(data)));
    proc.onExit(({ exitCode }) => {
      terminal.alive = false;
      nativeProcesses.delete(session.id);
      session.status = exitCode === 0 ? 'idle' : 'failed';
      addEvent(session, exitCode === 0 ? 'done' : 'error', `native Codex CLI exited ${exitCode ?? 0}`);
      saveSession(session).catch(() => {});
    });
    return terminal;
  } catch (error) {
    addEvent(session, 'error', `node-pty unavailable, fallback pipe mode: ${error instanceof Error ? error.message : String(error)}`);
    const child = spawn(command, args, {
      cwd: session.workspace,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    const terminal = {
      alive: true,
      write: (text) => child.stdin.write(text),
      kill: () => child.kill(),
    };
    child.stdout.on('data', (chunk) => addEvent(session, 'stdout', sanitize(chunk.toString())));
    child.stderr.on('data', (chunk) => addEvent(session, 'stdout', sanitize(chunk.toString())));
    child.on('error', (childError) => {
      terminal.alive = false;
      session.status = 'failed';
      session.lastError = childError instanceof Error ? childError.message : String(childError);
      addEvent(session, 'error', session.lastError);
      saveSession(session).catch(() => {});
    });
    child.on('exit', (code) => {
      terminal.alive = false;
      nativeProcesses.delete(session.id);
      session.status = code === 0 ? 'idle' : 'failed';
      addEvent(session, code === 0 ? 'done' : 'error', `native Codex CLI exited ${code ?? 0}`);
      saveSession(session).catch(() => {});
    });
    return terminal;
  }
}

async function codexNativeEnv() {
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
  };
  if (process.env.AIYA_DEV_NATIVE_CODEX_HOME) {
    env.CODEX_HOME = await ensureNativeCodexHome();
  }
  delete env.CODEX_CONFIG;
  delete env.CODEX_INSTRUCTIONS;
  return env;
}

function codexNativeArgs(workspace) {
  return [
    '-c', 'instructions="You are running inside AIYA Dev Terminal. Answer the user directly and concisely. Do not report project status unless the user asks for project status."',
    '--model', config.codexNativeModel,
    '--dangerously-bypass-approvals-and-sandbox',
    '--cd', workspace,
  ];
}

async function ensureNativeCodexHome() {
  const codeHome = path.resolve(process.env.AIYA_DEV_NATIVE_CODEX_HOME || path.join(config.stateDir, 'codex-native-home'));
  await fs.mkdir(codeHome, { recursive: true });

  const userAuth = path.join(os.homedir(), '.codex', 'auth.json');
  const isolatedAuth = path.join(codeHome, 'auth.json');
  if (fsSync.existsSync(userAuth)) {
    const shouldCopy = !fsSync.existsSync(isolatedAuth)
      || fsSync.statSync(userAuth).mtimeMs > fsSync.statSync(isolatedAuth).mtimeMs
      || fsSync.statSync(userAuth).size !== fsSync.statSync(isolatedAuth).size;
    if (shouldCopy) await fs.copyFile(userAuth, isolatedAuth);
  }

  const configText = [
    '# AIYA Dev Terminal isolated Codex config.',
    '# Intentionally does not copy user-level project/index instructions.',
    `model = "${config.codexNativeModel}"`,
    'model_reasoning_effort = "medium"',
    'sandbox = "elevated"',
    '',
  ].join('\n');
  const configPath = path.join(codeHome, 'config.toml');
  const existing = fsSync.existsSync(configPath) ? await fs.readFile(configPath, 'utf8').catch(() => '') : '';
  if (existing !== configText) await fs.writeFile(configPath, configText, 'utf8');
  return codeHome;
}

function resolveCodexCommand(command) {
  if (process.platform !== 'win32') return { command, args: [] };
  if (command.toLowerCase().endsWith('.exe') && fsSync.existsSync(command)) return { command, args: [] };
  const candidates = [
    process.env.CODEX_CLI_PATH,
    path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),
    ...whereCommand('codex.exe'),
  ].filter(Boolean);
  return { command: candidates.find((candidate) => candidate.toLowerCase().endsWith('.exe') && fsSync.existsSync(candidate)) || command, args: [] };
}

function resolveNativeCodexCommand(command) {
  const resolved = resolveCodexCommand(command);
  return resolved.command;
}

function resolveClaudeCommand(command) {
  const configured = process.env.AIYA_DEV_CLAUDE_CLI_JS;
  const cliJs = [
    configured,
    path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/cli.js'),
  ].filter(Boolean).find((candidate) => fsSync.existsSync(candidate));
  if (cliJs) return { command: process.execPath, args: [cliJs] };
  if (process.platform === 'win32') {
    const candidates = [
      process.env.AIYA_DEV_CLAUDE_EXE,
      path.join(os.homedir(), 'AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe'),
      path.join(os.homedir(), 'AppData/Roaming/npm/claude.cmd'),
      ...whereCommand('claude.exe'),
      ...whereCommand('claude.cmd'),
      ...whereCommand(command),
    ].filter(Boolean);
    const resolved = candidates.find((candidate) => fsSync.existsSync(candidate));
    if (resolved) return { command: resolved, args: [] };
  }
  return { command, args: [] };
}

function whereCommand(command) {
  try {
    return execFileSync('where.exe', [command], { encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function codexEnv(model) {
  if (config.codexAuthMode !== 'deepraxis-responses') return { TERM: 'xterm-256color' };

  const codeHome = path.join(config.stateDir, 'codex-home');
  await fs.mkdir(codeHome, { recursive: true });
  const apiKey = envValue('OPENAI_API_KEY', 'AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY', 'AIYA_CREATE_FAST_DIRECT_HTML_API_KEY', 'AIYA_CREATE_FAST_MODEL_API_KEY', 'AIYA_CREATE_MODEL_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_FAST_DIRECT_HTML_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_FAST_MODEL_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_MODEL_API_KEY')
    || process.env.OPENAI_API_KEY
    || '';
  if (apiKey && config.codexResponsesBaseUrl) {
    const text = [
      `model = "${model}"`,
      'model_provider = "deepraxis_openai"',
      'model_reasoning_effort = "none"',
      '',
      '[model_providers.deepraxis_openai]',
      'name = "DeepPraxis Responses"',
      `base_url = "${config.codexResponsesBaseUrl}"`,
      'env_key = "OPENAI_API_KEY"',
      'wire_api = "responses"',
      '',
    ].join('\n');
    await fs.writeFile(path.join(codeHome, 'config.toml'), text, 'utf8');
    return { CODEX_HOME: codeHome, OPENAI_API_KEY: apiKey };
  }
  return { CODEX_HOME: codeHome };
}

async function claudeEnv() {
  const apiKey = envValue('AIYA_DEV_CLAUDE_API_KEY', 'AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY', 'AIYA_CREATE_FAST_DIRECT_HTML_API_KEY', 'AIYA_CREATE_FAST_MODEL_API_KEY', 'AIYA_CREATE_MODEL_API_KEY')
    || readCreateRunnerEnvValue('AIYA_DEV_CLAUDE_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_FAST_DIRECT_HTML_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_FAST_MODEL_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_MODEL_API_KEY')
    || '';
  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: envValue('AIYA_DEV_CLAUDE_BASE_URL') || config.claudeBaseUrl,
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_MODEL: envValue('AIYA_DEV_CLAUDE_MODEL') || config.claudeModel,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
  };
  delete env.NO_COLOR;
  delete env.NODE_DISABLE_COLORS;
  delete env.CLAUDE_CODE_SIMPLE;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_SMALL_FAST_MODEL;
  delete env.ANTHROPIC_MEDIUM_MODEL;
  return env;
}

async function codexDiagnostics() {
  const hasUserAuthFile = hasCodexUserAuthFile();
  const hasOpenAIKey = hasOpenAIAuthKey();
  const hasDeepPraxisKey = Boolean(
    envValue('AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY', 'AIYA_CREATE_FAST_DIRECT_HTML_API_KEY', 'AIYA_CREATE_FAST_MODEL_API_KEY', 'AIYA_CREATE_MODEL_API_KEY')
      || readCreateRunnerEnvValue('AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY')
      || readCreateRunnerEnvValue('AIYA_CREATE_FAST_DIRECT_HTML_API_KEY')
      || readCreateRunnerEnvValue('AIYA_CREATE_FAST_MODEL_API_KEY')
      || readCreateRunnerEnvValue('AIYA_CREATE_MODEL_API_KEY')
  );
  const warnings = [];
  if (config.codexAuthMode === 'user' && !hasUserAuthFile && !hasOpenAIKey) {
    warnings.push('当前服务端 Codex CLI 未检测到登录凭证或 OPENAI_API_KEY。请在服务器执行 codex login，或切换到 deepraxis-responses 模式并配置可用网关。');
  }
  if (config.codexAuthMode === 'deepraxis-responses' && !hasDeepPraxisKey) {
    warnings.push('DeepPraxis 模式缺少 API Key，Codex CLI 会无法请求模型。');
  }
  const nativeReady = hasNativeCodexAuth();
  const nativeWarnings = nativeReady ? [] : [
    '原生 Codex CLI 未检测到登录凭证。请在本机/服务器终端执行 codex login；登录前 /help、/model 等 slash 命令会被登录流程拦截。',
  ];
  return {
    command: config.codexCommand,
    model: config.codexModel,
    authMode: config.codexAuthMode,
    hasUserAuthFile,
    hasOpenAIKey,
    hasDeepPraxisKey,
    nativeReady,
    nativeWarnings,
    ready: warnings.length === 0,
    warnings,
  };
}

async function claudeDiagnostics() {
  const cli = resolveClaudeCommand(config.claudeCommand);
  const apiKey = envValue('AIYA_DEV_CLAUDE_API_KEY', 'AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY', 'AIYA_CREATE_FAST_DIRECT_HTML_API_KEY', 'AIYA_CREATE_FAST_MODEL_API_KEY', 'AIYA_CREATE_MODEL_API_KEY')
    || readCreateRunnerEnvValue('AIYA_DEV_CLAUDE_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_CLI_DEEPPRAXIS_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_FAST_DIRECT_HTML_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_FAST_MODEL_API_KEY')
    || readCreateRunnerEnvValue('AIYA_CREATE_MODEL_API_KEY')
    || '';
  const warnings = [];
  if (!fsSync.existsSync(cli.command) && !whereCommand(config.claudeCommand).length) warnings.push('未找到 Claude Code CLI。请先安装 @anthropic-ai/claude-code。');
  if (!apiKey) warnings.push('Claude Code 缺少 ANTHROPIC_API_KEY / DeepPraxis API Key。');
  return {
    command: config.claudeCommand,
    resolvedCommand: cli.command,
    model: config.claudeModel,
    baseUrl: config.claudeBaseUrl,
    hasApiKey: Boolean(apiKey),
    ready: warnings.length === 0,
    warnings,
  };
}

function hasCodexUserAuthFile() {
  return fsSync.existsSync(path.join(os.homedir(), '.codex', 'auth.json'));
}

function hasOpenAIAuthKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function hasNativeCodexAuth() {
  return hasCodexUserAuthFile() || hasOpenAIAuthKey();
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env || {}) },
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    child.stdout.on('data', (chunk) => options.onChunk?.(chunk.toString()));
    child.stderr.on('data', (chunk) => options.onChunk?.(chunk.toString()));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 0 });
    });
    child.stdin.write(options.input || '');
    child.stdin.end();
  });
}

async function listFiles(root) {
  const files = [];
  const skipDirs = new Set(['node_modules', '.git', '.next', 'dist']);
  const visit = async (dir, depth) => {
    if (depth > 5 || files.length > 200) return;
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) await visit(full, depth + 1);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full);
        if (stat.size <= 600_000) files.push({ path: rel, bytes: stat.size, updatedAt: stat.mtime.toISOString() });
      }
    }
  };
  await visit(root, 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function readWorkspaceFile(root, rel) {
  const full = path.resolve(root, rel);
  if (!isInside(root, full)) return null;
  const stat = await fs.stat(full).catch(() => null);
  if (!stat?.isFile() || stat.size > 600_000) return null;
  return { path: rel, bytes: stat.size, content: await fs.readFile(full, 'utf8') };
}

function addEvent(session, type, text) {
  const event = { id: randomUUID(), at: now(), type, text: sanitize(text) };
  session.events.push(event);
  session.events = session.events.slice(-600);
  session.updatedAt = event.at;
  emit(session.id, { type: 'event', event, session: publicSession(session) });
  saveSession(session).catch(() => {});
}

function subscribe(id, fn) {
  const set = listeners.get(id) || new Set();
  set.add(fn);
  listeners.set(id, set);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(id);
  };
}

function emit(id, payload) {
  const set = listeners.get(id);
  if (!set) return;
  for (const fn of set) fn(payload);
}

async function saveSession(session) {
  const dir = path.join(config.stateDir, 'sessions');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${session.id}.json`), JSON.stringify(session, null, 2), 'utf8');
}

function isInside(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function sanitize(value) {
  return stripAnsi(String(value || ''))
    .split(/\r?\n/)
    .map((line) => /api[_-]?key|authorization|bearer\s+|password|secret|token/i.test(line) ? '[redacted sensitive log line]' : line)
    .join('\n')
    .slice(-12000);
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

function readEnvFileValue(file, name) {
  try {
    const text = fsSync.readFileSync(file, 'utf8');
    const line = text.split(/\r?\n/).find((item) => item.startsWith(`${name}=`));
    if (!line) return '';
    return line.slice(name.length + 1).trim().replace(/^['"]|['"]$/g, '');
  } catch {
    return '';
  }
}

function readCreateRunnerEnvValue(name) {
  const candidates = [
    process.env.AIYA_CREATE_RUNNER_ENV_FILE,
    path.resolve(process.cwd(), 'apps/create-runner/.env'),
    path.resolve(process.cwd(), '../create-runner/.env'),
    path.resolve(process.cwd(), '../../apps/create-runner/.env'),
  ].filter(Boolean);
  for (const file of candidates) {
    const value = readEnvFileValue(file, name);
    if (value) return value;
  }
  return '';
}

await init();
await fastify.listen({ port: config.port, host: '0.0.0.0' });
fastify.log.info(`AIYA Dev Runner listening on ${config.port}`);
