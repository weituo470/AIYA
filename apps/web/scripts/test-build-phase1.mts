import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildExecution, chooseBuildModelMode, advanceBuildStage, finalizeBuild, collectBuildCalls, htmlHash } from '../src/app/api/create-theatre/_build-execution';
import { prisma } from '@aiya/database';

process.env.AIYA_BUILD_VALIDATION = 'off'; // Explicit legacy-only regression suite.
const scratch = await mkdtemp(join(tmpdir(), 'aiya-build-phase1-'));
process.env.CREATE_THEATRE_SETTINGS_FILE = join(scratch, 'settings.json');
process.env.AIYA_DIAGNOSTICS_DIR = join(scratch, 'diagnostics');
process.env.CREATE_THEATRE_SETTINGS_ENCRYPTION_KEY = 'test-signing-only';
process.env.AIYA_TEACHER_CODER_MODEL = '';
process.env.HERMES_MODEL = '';
process.env.AIYA_TEACHER_CODER_BASE_URL = '';
process.env.AIYA_TEACHER_CODER_API_KEY = '';

const saved = new Map<string, any>();
const task = prisma.theatreTask as any;
task.upsert = async ({ where, create }: any) => { const row = { id: where.diagnosticId, ...structuredClone(create), createdAt: new Date(), updatedAt: new Date() }; saved.set(where.diagnosticId, row); return row; };
task.update = async ({ where, data }: any) => { const row = saved.get(where.diagnosticId); assert(row, 'Task must exist before update'); for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = structuredClone(value); row.updatedAt = new Date(); return row; };
task.findFirst = async ({ where }: any) => [...saved.values()].find(row => where.OR.some((condition: any) => Object.entries(condition).every(([key, value]) => row[key] === value))) || null;
(prisma.theatreSession as any).findFirst = async () => null;
(prisma.theatreStudent as any).findUnique = async () => null;

async function configure(enabled = true) {
  await writeFile(process.env.CREATE_THEATRE_SETTINGS_FILE!, JSON.stringify({ modelMode: 'default', hermesProfiles: enabled ? {
    default: { baseUrl: 'https://test.invalid/v1', model: 'test-speed', apiKeyEncrypted: 'test-key-only' },
    quality: { baseUrl: 'https://test.invalid/v1', model: 'test-quality', apiKeyEncrypted: 'test-key-only' },
    fast: {},
  } : {} }));
}
await configure();
const { POST, GET } = await import('../src/app/api/teacher-coder/route');
const { encodeModelSelection, modelSelectionCookie } = await import('../src/app/api/create-theatre/_model-selection');
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-size:18px}button{font-size:16px}</style></head><body><button id="start">开始</button><output id="count">0</output><script>document.getElementById("start").onclick=function(){document.getElementById("count").textContent="1";};</script></body></html>';
const work = { title: '计数器', brief: '点击计数', reply: '完成', html, events: [] };
let requests: Array<{ model: string; endpoint: string }> = [];
let behavior: 'good' | 'fail-speed' | 'syntax' | 'unsafe' | 'all-fail' = 'good';
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  const payload = JSON.parse(init.body); requests.push({ model: payload.model, endpoint: String(url) });
  if (behavior === 'all-fail' || (behavior === 'fail-speed' && payload.model === 'test-speed')) return new Response('Unavailable', { status: 503 });
  const output = { ...work, html: behavior === 'syntax' ? html.replace('textContent="1";', 'const x = ;') : behavior === 'unsafe' ? html.replace('textContent="1";', 'fetch("https://evil.test/");') : html };
  const result = { model: `${payload.model}-returned`, usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 } };
  return Response.json(String(url).endsWith('/responses') ? { ...result, output_text: JSON.stringify(output) } : { ...result, choices: [{ message: { content: JSON.stringify(output) } }] });
}) as typeof fetch;

let passed = 0;
async function check(name: string, run: () => Promise<void> | void) { await run(); passed++; console.log(`PASS ${name}`); }
async function submit(body: any, cookie?: string) {
  requests = [];
  const response = await POST(new Request('https://aiya.test/api/teacher-coder', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie, origin: 'https://aiya.test' } : {}) }, body: JSON.stringify(body) }));
  return { response, payload: await response.json() as any, calls: [...requests] };
}
try {
  await check('deterministic preference matrix and manual precedence', () => {
    for (const preference of ['auto', 'speed', 'quality']) for (const idea of ['做一个计数器', '做一个体感游戏']) {
      const build = createBuildExecution({ taskId: 'test', preference, idea, startedAt: 1000 });
      assert.equal(chooseBuildModelMode(build, 'default'), preference === 'quality' || preference === 'auto' && idea.includes('体感') ? 'quality' : 'default');
      assert.equal(chooseBuildModelMode(build, 'default', 'default'), 'default'); assert.equal(build.selection.source, 'manual');
    }
  });
  await check('version hashing and failed artifact isolation', () => {
    const build = createBuildExecution({ taskId: 'test', preference: 'auto', idea: '修改', html, projectId: 'project-1', startedAt: 1000 });
    advanceBuildStage(build, 'generation', false, 1100);
    finalizeBuild(build, { succeeded: true, startedAt: 1000, html: html + ' ', now: 1300 });
    assert.equal(build.version.parentHtmlSha256, htmlHash(html)); assert.notEqual(build.version.parentHtmlSha256, build.version.outputHtmlSha256);
    assert.equal(build.totalDurationMs, 300); assert.equal(build.stages[0].durationMs, 100);
    assert.equal(build.version.projectId, 'project-1'); assert(build.version.artifactId?.startsWith('test:'));
  });
  await check('pending calls are not mislabeled as failures', () => {
    const build = createBuildExecution({ taskId: 'test', idea: '', startedAt: 1000 });
    collectBuildCalls(build, [{ model: 'm', status: 'started' }]); assert.equal(build.calls.length, 0);
  });
  await check('negated capabilities do not trigger a costly route', () => {
    const build = createBuildExecution({ taskId: 'test', preference: 'auto', idea: '做一个计数器，不需要数据库，不要摄像头', startedAt: 1000 });
    assert.equal(chooseBuildModelMode(build, 'default'), 'default'); assert.deepEqual(build.selection.signals, []);
  });
  for (const preference of ['auto', 'speed', 'quality']) await check(`${preference}: real route handler + persisted canonical trace`, async () => {
    const { response, payload, calls } = await submit({ idea: '做一个计数器', buildPreference: preference });
    assert.equal(response.status, 200, payload.error); assert.equal(calls.length, 1);
    assert.equal(calls[0].model, preference === 'quality' ? 'test-quality' : 'test-speed');
    assert.equal(payload.build.preference, preference); assert.equal(payload.build.route, 'direct-http');
    assert.equal(payload.build.model.returned, `${calls[0].model}-returned`);
    assert.equal(payload.build.calls[0].usage.total_tokens, 33);
    assert.equal(payload.build.checks.find((x: any) => x.name === 'browser-runtime').status, 'not-run');
    assert.equal(payload.build.checks[0].status, 'passed'); assert.equal(payload.build.checks[1].status, 'passed');
    assert.deepEqual(saved.get(payload.diagnosticId).attempts.build, payload.build);
    assert.equal(payload.build.cost.amount, null); assert(!JSON.stringify(payload.build).includes('test-key-only'));
  });
  await check('database explanation alone does not imply remote backend difficulty', async () => {
    const { payload, calls } = await submit({ idea: '做一个带数据库规划说明的计数器', buildPreference: 'auto' });
    assert.equal(payload.ok, true, payload.error); assert.equal(calls.length, 1); assert.equal(calls[0].model, 'test-speed');
  });
  await check('APK manual model and old client compatibility', async () => {
    for (const extra of [{ buildPreference: 'speed', modelSelectionMode: 'manual' }, {}]) {
      const { payload, calls } = await submit({ idea: '做一个计数器', modelMode: 'quality', ...extra });
      assert(payload.ok); assert.equal(calls[0].model, 'test-quality');
      assert.equal(payload.build.selection.source, 'buildPreference' in extra ? 'manual' : 'legacy');
    }
  });
  await check('signed Web override, not forged request mode', async () => {
    const { payload, calls } = await submit({ idea: '做一个计数器', buildPreference: 'speed' }, `${modelSelectionCookie}=${encodeModelSelection('quality')}`);
    assert(payload.ok); assert.equal(calls[0].model, 'gpt-6-astra'); assert.equal(payload.build.selection.source, 'manual'); assert(calls[0].endpoint.endsWith('/responses'));
  });
  await check('clear manual selection keeps password, origin and cookie protections', async () => {
    const { POST: select } = await import('../src/app/api/create-theatre/model-selection/route');
    process.env.CREATE_THEATRE_MODEL_OPERATION_PASSWORD = 'phase1-test-pass';
    const clear = (password: string, origin: string, ip: string) => select(new Request('https://aiya.test/api/create-theatre/model-selection', { method: 'POST', headers: { origin, 'x-forwarded-for': ip }, body: JSON.stringify({ action: 'clear', password }) }));
    assert.equal((await clear('wrong', 'https://aiya.test', 'clear-a')).status, 403);
    assert.equal((await clear('phase1-test-pass', 'https://evil.test', 'clear-b')).status, 403);
    const response = await clear('phase1-test-pass', 'https://aiya.test', 'clear-c');
    assert.equal(response.status, 200); const cookie = response.headers.get('set-cookie') || '';
    for (const value of ['Max-Age=0', 'HttpOnly', 'Secure', 'SameSite=lax']) assert(cookie.includes(value));
  });
  await check('all model attempts, token usage and finite failover', async () => {
    behavior = 'fail-speed';
    const { payload, calls } = await submit({ idea: '做一个计数器', buildPreference: 'speed' });
    assert(payload.ok); assert.equal(calls.length, 3); assert.equal(payload.build.calls.length, 3);
    assert.deepEqual(payload.build.calls.map((x: any) => x.status), ['failed', 'failed', 'succeeded']);
    assert.equal(payload.build.selection.selectedModelMode, 'quality'); behavior = 'good';
  });
  await check('syntax failure recorded, no runtime pass claim', async () => {
    behavior = 'syntax'; const { response, payload, calls } = await submit({ idea: '做一个计数器', buildPreference: 'auto' });
    assert.equal(response.status, 502); assert.equal(calls.length, 2); assert.equal(payload.build.status, 'failed');
    assert.equal(payload.build.version.artifactId, null); assert.equal(payload.build.checks[0].status, 'failed');
    assert.equal(saved.get(payload.diagnosticId).attempts.build.status, 'failed'); behavior = 'good';
  });
  await check('resource safety failure preserved separately', async () => {
    behavior = 'unsafe'; const { payload } = await submit({ idea: '做一个计数器', buildPreference: 'auto' });
    assert.equal(payload.build.checks[1].status, 'failed'); assert.equal(payload.build.version.artifactId, null); behavior = 'good';
  });
  await check('APK idempotency and GET recovery preserve original preference/trace', async () => {
    const body = { idea: '做一个计数器', buildPreference: 'quality', taskContext: { clientTaskId: 'task-unique', deviceId: 'device-test', source: 'android-v3' } };
    const first = await submit(body); assert(first.payload.ok);
    const repeated = await submit(body); assert.equal(repeated.calls.length, 0); assert(repeated.payload.idempotent); assert.deepEqual(first.payload.build, repeated.payload.build);
    const recovery = await GET(new Request('https://aiya.test/api/teacher-coder?clientTaskId=task-unique&deviceId=device-test'));
    assert.deepEqual((await recovery.json()).build, first.payload.build);
    assert.equal((await GET(new Request('https://aiya.test/api/teacher-coder?clientTaskId=task-unique&deviceId=wrong'))).status, 404);
  });
  await check('revision keeps parent content hash and project ID', async () => {
    const { payload } = await submit({ idea: '把计数器标题改为绿色', buildPreference: 'speed', currentApp: { id: 'project-id', html, title: '计数器' } });
    assert.equal(payload.build.operation, 'revise'); assert.equal(payload.build.version.projectId, 'project-id'); assert.equal(payload.build.version.parentHtmlSha256, htmlHash(html));
  });
  await check('invalid preference / empty idea / invalid JSON objects are audited without upstream call', async () => {
    for (const body of [{ idea: 'a', buildPreference: 'bogus' }, { idea: '', buildPreference: 'auto' }, null, []]) {
      const { response, payload, calls } = await submit(body); assert.equal(response.status, 400); assert.equal(calls.length, 0); assert.equal(payload.build?.status || saved.get(payload.diagnosticId).attempts.build.status, 'failed');
    }
  });
  await check('missing configuration is audited, no synthetic success', async () => {
    await configure(false); const { response, payload, calls } = await submit({ idea: '计数器', buildPreference: 'auto' });
    assert.equal(response.status, 503); assert.equal(calls.length, 0); assert.equal(saved.get(payload.diagnosticId).attempts.build.status, 'failed'); await configure();
  });
  const sample = [...saved.values()].find(row => row.status === 'succeeded' && row.attempts?.build?.preference === 'quality').attempts.build;
  await mkdir(new URL('../../../outputs/build-phase1/', import.meta.url), { recursive: true });
  await writeFile(new URL('../../../outputs/build-phase1/mock-handler-evidence.json', import.meta.url), JSON.stringify({ source: 'Real route handlers with mocked provider and task store; not live model or database verification', passed, sample }, null, 2));
  console.log(`PASS ${passed} phase-1 scenarios. Provider and DB mocked; no paid calls or real device validation. Evidence: ${scratch}`);
} finally { globalThis.fetch = originalFetch; await prisma.$disconnect(); }
