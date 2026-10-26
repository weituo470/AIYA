import assert from 'node:assert/strict';
import { createFusionProgressReporter, FusionResponseError, readFusionChatResponse } from '../src/app/api/create-theatre/_fusion-chat';
import { resolveCreateTheatreRuntimeModelConfig } from '../src/app/api/create-theatre/_admin-settings';

const privateThought = 'PRIVATE_REASONING_NEVER_RETURN';
const frame = (data: unknown) => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\r\n\r\n`;
const delta = (data: unknown, finish: string | null = null, extra: object = {}) => ({ id: 'chatcmpl-fusion-unit', model: 'fusion-max-2.0', choices: [{ index: 0, delta: data, finish_reason: finish }], ...extra });
const usage = { prompt_tokens: 2163, completion_tokens: 16000, total_tokens: 18163, completion_tokens_details: { reasoning_tokens: 16000 } };
const sse = (frames: unknown[], fragment = 31, done = true) => {
  const bytes = new TextEncoder().encode(': keepalive\r\n\r\n' + frames.map(frame).join('') + (done ? frame('[DONE]') : ''));
  return new Response(new ReadableStream({ start(c) { for (let i=0; i<bytes.length; i+=fragment) c.enqueue(bytes.slice(i,i+fragment)); c.close(); } }), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'unit-request-id' } });
};
const run = (response: Response, extra = {}) => readFusionChatResponse(response, { startedAt: Date.now(), signal: new AbortController().signal, redact: text => text.replaceAll('unit-secret', '[redacted]'), ...extra });
let passed = 0;
async function test(label: string, fn: () => Promise<void> | void) { await fn(); passed++; console.log('PASS '+label); }
async function fails(response: Response, kind: string) {
  let seen: FusionResponseError | undefined;
  try { await run(response); } catch (error) { assert(error instanceof FusionResponseError); seen = error; }
  assert(seen, 'Response should fail'); assert.equal(seen.detail.failureKind, kind); assert(!JSON.stringify(seen.detail).includes(privateThought)); return seen;
}

await test('fragmented UTF-8, CRLF, reasoning ignored, terminal choice + usage-only frame + DONE', async () => {
  const progress: any[] = [];
  const content = '{"title":"生日🎂","html":"完整正文"}';
  const result = await run(sse([delta({ role:'assistant', reasoning_content:privateThought }),delta({content}),delta({},'stop'),{ choices:[],usage }],1), { onProgress: (value: any) => progress.push(value) });
  assert.equal(result.content,content); assert.equal(result.model,'fusion-max-2.0'); assert.equal(result.transport.protocol,'sse');
  assert.equal(result.usage?.reasoning_tokens,16000); assert.equal(result.transport.requestId,'unit-request-id');
  assert.equal(result.transport.completionId,'chatcmpl-fusion-unit'); assert.equal(result.transport.done,true);
  assert(result.transport.firstByteMs !== undefined && result.transport.firstContentMs !== undefined);
  assert(result.transport.firstContentMs! >= result.transport.firstByteMs!);
  assert(progress.length>=2); assert(!JSON.stringify({result,progress}).includes(privateThought));
});
await test('length with no body preserves 16000 reasoning tokens instead of generic JSON repair', async () => {
  const error = await fails(sse([delta({reasoning_content:privateThought}),delta({},'length'),{ choices:[],usage }]),'output-limit');
  assert.deepEqual(error.detail.usage,{prompt_tokens:2163,completion_tokens:16000,total_tokens:18163,reasoning_tokens:16000});
  assert.equal(error.detail.modelOutputLength,0); assert.equal(error.detail.finishReason,'length');
});
await test('length never delivers even a parseable partial JSON object', async () => { await fails(sse([delta({content:'{"ok":true}'},'length')]),'output-limit'); });
await test('missing DONE is not a success', async () => { await fails(sse([delta({content:'{}'}),delta({},'stop')],31,false),'stream-incomplete'); });
await test('DONE without finish_reason is not a success', async () => { await fails(sse([delta({content:'{}'})]),'stream-incomplete'); });
await test('empty normal completion is a classified failure', async () => { await fails(sse([delta({},'stop')]),'empty-output'); });
await test('wrong returned model is rejected', async () => { await fails(sse([{...delta({content:'{}'},'stop'),model:'another-model'}]),'model-mismatch'); });
await test('model changing midstream is rejected', async () => { await fails(sse([delta({content:'{' }),{...delta({content:'}'},'stop'),model:'another-model'}]),'stream-invalid'); });
await test('content after terminal choice is rejected', async () => { await fails(sse([delta({content:'{}'},'stop'),delta({content:'oops'})]),'stream-invalid'); });
await test('upstream SSE error retains safe request ID but never credentials', async () => {
  const error = await fails(sse([{ error:{message:'cannot use unit-secret',code:'unavailable'},request_id:'provider-request-1' }]),'upstream-error');
  assert.equal(error.detail.requestId,'provider-request-1'); assert(!error.message.includes('unit-secret'));
});
await test('HTTP error body retains request ID and status', async () => {
  const error=await fails(Response.json({error:{message:'unit-secret rejected',code:'no_access'},request_id:'provider-request-2'},{status:403}),'http-error');
  assert.equal(error.detail.upstreamStatus,403);assert.equal(error.detail.requestId,'provider-request-2');assert(!error.message.includes('unit-secret'));
});
await test('buffered JSON compatibility is recorded honestly, not called streaming', async () => {
  const result = await run(Response.json({ model:'fusion-max-2.0',choices:[{message:{content:'{"ok":true}',reasoning_content:privateThought},finish_reason:'stop'}],usage }));
  assert.equal(result.transport.protocol,'json'); assert.equal(result.content,'{"ok":true}'); assert(!JSON.stringify(result).includes(privateThought));
});
await test('buffered length is classified and usage retained', async () => { await fails(Response.json({model:'fusion-max-2.0',choices:[{message:{content:''},finish_reason:'length'}],usage}),'output-limit'); });
await test('malformed SSE event never delivers', async () => {
  const response = new Response('data: {invalid}\n\n',{headers:{'content-type':'text/event-stream'}}); await fails(response,'stream-invalid');
});
await test('oversized unterminated frame is bounded', async () => { await fails(new Response('data: '+'x'.repeat(2_000_010),{headers:{'content-type':'text/event-stream'}}),'response-too-large'); });
await test('abort releases a waiting stream without needing another chunk', async () => {
  const c=new AbortController(); let cancelled=false;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
  const promise=readFusionChatResponse(response,{startedAt:Date.now(),signal:c.signal,redact:s=>s});setTimeout(()=>c.abort(),20);
  await assert.rejects(promise,(e:any)=>e instanceof FusionResponseError && e.detail.failureKind==='timeout');assert(cancelled);
});
await test('progress callback failure does not lose valid completed content', async () => {
  const result=await run(sse([delta({content:'{}'},'stop')]),{onProgress:()=>{throw Error('audit temporarily unavailable');}});assert.equal(result.content,'{}');
});
await test('contradictory finish reasons cannot turn truncation or filtering into success', async () => {
  for (const first of ['length','content_filter']) {
    const error=await fails(sse([delta({content:'{}'},first),delta({},'stop')]),'stream-invalid');
    assert.equal(error.detail.finishReason,first);
  }
});
await test('credentials echoed in metadata and headers are discarded, not persisted', async () => {
  const response=sse([{id:'unit-secret',request_id:'unit-secret',error:{message:'unit-secret',code:'unit-secret',type:'unit-secret'}}]);
  response.headers.set('x-request-id','unit-secret');
  const error=await fails(response,'upstream-error');assert(!JSON.stringify(error).includes('unit-secret'));
  const buffered=await fails(Response.json({id:'unit-secret',model:'unit-secret',request_id:'unit-secret',choices:[{message:{content:'{}'},finish_reason:'stop'}]}),'model-mismatch');
  assert(!JSON.stringify(buffered).includes('unit-secret'));
  const http=await fails(Response.json({error:{message:'unit-secret',code:'unit-secret'},request_id:'unit-secret'},{status:503,headers:{'x-request-id':'unit-secret'}}),'http-error');
  assert(!JSON.stringify(http).includes('unit-secret'));
});
await test('hanging progress callback cannot defeat stream abort', async () => {
  const c=new AbortController();let writes=0;
  const promise=run(sse([delta({content:'{}'},'stop')]),{signal:c.signal,onProgress:()=>{writes++;return new Promise(()=>{});}});
  setTimeout(()=>c.abort(),20);
  await Promise.race([assert.rejects(promise,(e:any)=>e instanceof FusionResponseError&&e.detail.failureKind==='timeout'),new Promise((_,reject)=>setTimeout(()=>reject(Error('Progress defeated abort')),600))]);
  assert.equal(writes,1);
});
await test('hanging onStart/terminal telemetry is bounded and never queued repeatedly', async () => {
  let writes=0;const reporter=createFusionProgressReporter(()=>{writes++;return new Promise<void>(()=>{});},new AbortController().signal);
  const start=Date.now();await reporter('start');await reporter('stream');await reporter('end');assert.equal(writes,1);assert(Date.now()-start<600);
});
await test('Fusion-only config is bounded and does not inherit generic 16K', () => {
  process.env.AIYA_TEACHER_CODER_MAX_TOKENS='16000';
  assert.equal(resolveCreateTheatreRuntimeModelConfig('fusion').maxTokens,32768);
  process.env.AIYA_FUSION_MAX_TOKENS='999999';assert.equal(resolveCreateTheatreRuntimeModelConfig('fusion').maxTokens,65536);
  process.env.AIYA_FUSION_MAX_TOKENS='bad';assert.equal(resolveCreateTheatreRuntimeModelConfig('fusion').maxTokens,32768);
  process.env.AIYA_FUSION_REASONING_EFFORT='invalid';assert.equal(resolveCreateTheatreRuntimeModelConfig('fusion').reasoningEffort,'low');
  process.env.AIYA_FUSION_REASONING_EFFORT='high';assert.equal(resolveCreateTheatreRuntimeModelConfig('fusion').reasoningEffort,'high');
  process.env.AIYA_FUSION_STREAM='0';assert.equal(resolveCreateTheatreRuntimeModelConfig('fusion').stream,false);
  for(const key of ['AIYA_FUSION_MAX_TOKENS','AIYA_FUSION_REASONING_EFFORT','AIYA_FUSION_STREAM'])delete process.env[key];
  assert.equal(resolveCreateTheatreRuntimeModelConfig('default').maxTokens,16000);assert.equal(resolveCreateTheatreRuntimeModelConfig('default').stream,undefined);
});
console.log(`SUMMARY ${passed} Fusion transport checks; no provider requests.`);
