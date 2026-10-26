/** One POST only. Transport failures recover the same task, never resubmit it. */
export async function recoverableGeneration(body: Record<string, any>, options: {
  fetcher?: typeof fetch; now?: () => number; wait?: (ms: number) => Promise<void>;
  pollMs?: number; totalMs?: number; onProgress?: (payload: any) => void;
} = {}) {
  const fetcher = options.fetcher || fetch, now = options.now || Date.now;
  const wait = options.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = now() + (options.totalMs ?? 540000);
  const context = body.taskContext;
  let lastError = '等待同一任务的服务器结果。';
  const finish = (payload: any, status: number) => {
    if (payload?.ok && payload.result?.html) return payload;
    const error = new Error(`${payload?.error || `应用构建失败（HTTP ${status}）`}${payload?.diagnosticId ? `（诊断ID：${payload.diagnosticId}）` : ''}`) as Error & { build?: unknown; terminal?: boolean };
    error.build = payload?.build; error.terminal = true; throw error;
  };
  try {
    const response = await fetcher('/api/teacher-coder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const payload = await response.json();
    if (!payload?.pending && (response.ok || (response.status < 500 && response.status !== 408) || payload?.build?.status === 'failed')) return finish(payload, response.status);
    options.onProgress?.(payload);
  } catch (error) {
    // A definite product failure is not a transport failure and must not poll forever.
    if ((error as any)?.terminal) throw error;
    lastError = '连接暂时中断，正在恢复同一任务；没有重新调用生成模型。';
  }
  const query = new URLSearchParams({ clientTaskId: context.clientTaskId });
  while (now() < deadline) {
    await wait(options.pollMs ?? 2000);
    let response: Response, payload: any;
    try {
      response = await fetcher(`/api/teacher-coder?${query}`, { cache: 'no-store', headers: { 'X-Aiya-Recovery': context.recoveryToken }, signal: AbortSignal.timeout(10000) });
      payload = await response.json();
    } catch { lastError = '恢复连接暂不可用；不会重复提交需求。'; continue; }
    if (payload?.pending) { options.onProgress?.(payload); continue; }
    if (response.status === 404 || response.status >= 500) { lastError = '尚未获取到任务结果，继续查询同一任务。'; continue; }
    return finish(payload, response.status);
  }
  throw new Error(`${lastError}已达到等待上限，请检查任务记录，不要立即重复提交。任务：${context.clientTaskId}`);
}
