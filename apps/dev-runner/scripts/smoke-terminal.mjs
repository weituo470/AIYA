const baseUrl = process.env.AIYA_DEV_RUNNER_URL || 'http://127.0.0.1:3335';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cases = [
  { provider: 'codex-native', command: '/help', bootMs: 6000, replyMs: 5000, minBytes: 1000 },
  { provider: 'claude-code', command: '/help', bootMs: 6000, replyMs: 5000, minBytes: 800 },
];

function wsUrlFor(sessionId, provider) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/terminal';
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('provider', provider);
  url.searchParams.set('cols', '120');
  url.searchParams.set('rows', '34');
  return url.toString();
}

function summarizeText(text) {
  return text
    .replace(/\x1b\[[0-9;:?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\u0007]*(\u0007|\x1b\\)/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 260);
}

async function createSession(provider) {
  const response = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: `smoke-${provider}-${Date.now()}`, provider }),
  });
  if (!response.ok) throw new Error(`create ${provider} failed ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  return payload.session;
}

async function smokeTerminal(testCase) {
  const session = await createSession(testCase.provider);
  let output = '';
  let opened = false;
  let closed = false;
  let closeCode = null;
  const socket = new WebSocket(wsUrlFor(session.id, testCase.provider));
  socket.addEventListener('open', () => { opened = true; });
  socket.addEventListener('message', (event) => { output += String(event.data); });
  socket.addEventListener('close', (event) => { closed = true; closeCode = event.code; });

  await wait(testCase.bootMs);
  if (socket.readyState === WebSocket.OPEN) socket.send(`${testCase.command}\r`);
  await wait(testCase.replyMs);
  try { socket.close(); } catch {}

  const failurePatterns = [
    /failed to start/i,
    /Cannot create process/i,
    /AIYA Dev Runner: session not found/i,
    /ERROR: Reconnecting/i,
    /尚未登录/i,
    /缺少/i,
    /command not found/i,
  ];
  const failures = failurePatterns.filter((pattern) => pattern.test(output)).map((pattern) => pattern.source);
  const hasHelp = /help|Commands|命令|\/help|getting started|Run \/init/i.test(output);
  const passed = opened && output.length >= testCase.minBytes && hasHelp && failures.length === 0;
  return {
    provider: testCase.provider,
    sessionId: session.id,
    passed,
    opened,
    closed,
    closeCode,
    bytes: output.length,
    hasHelp,
    failures,
    sample: summarizeText(output),
  };
}

const health = await fetch(`${baseUrl}/health`).then((response) => response.json());
const diagnostics = await fetch(`${baseUrl}/diagnostics`).then((response) => response.json());
const results = [];
for (const testCase of cases) {
  try {
    results.push(await smokeTerminal(testCase));
  } catch (error) {
    results.push({ provider: testCase.provider, passed: false, error: String(error?.stack || error) });
  }
}
const passed = results.every((item) => item.passed);
console.log(JSON.stringify({ baseUrl, health, diagnostics, passed, results }, null, 2));
if (!passed) process.exit(1);
