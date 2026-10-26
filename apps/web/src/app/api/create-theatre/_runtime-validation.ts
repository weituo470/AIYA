import type { RuntimeValidationReport } from '../../../lib/build-contract';

export function runtimeValidationMode() { return process.env.AIYA_BUILD_VALIDATION === 'off' ? 'off' : 'required'; }
function connection() {
  const base = new URL(process.env.AIYA_BUILD_VALIDATOR_URL || 'http://127.0.0.1:3346');
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname) || base.protocol !== 'http:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('验证器必须使用独立的本机 HTTP 地址。');
  const token = process.env.AIYA_BUILD_VALIDATOR_TOKEN || '';
  if (token.length < 24) throw new Error('浏览器验证器未配置安全访问令牌，停止交付未经验证的作品。');
  return { base, token };
}
export async function ensureRuntimeValidatorReady(remainingMs: number) {
  if (runtimeValidationMode() === 'off') return;
  const { base, token } = connection();
  try {
    const response = await fetch(new URL('/health', base), { redirect: 'error', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(Math.max(1, Math.min(remainingMs, 5000))) });
    const health = await response.json();
    if (!response.ok || health.service !== 'aiya-build-validator' || health.schemaVersion !== 1 || health.ready !== true) throw new Error('not ready');
  } catch { throw new Error('浏览器验证器未就绪，本次未调用生成模型；请启动独立验证服务。'); }
}
export async function validateGeneratedRuntime(input: { html: string; previousHtml?: string; idea: string; preference: string }, remainingMs: number): Promise<RuntimeValidationReport> {
  if (runtimeValidationMode() === 'off') return { schemaVersion: 1, status: 'not-run', coverage: 'disabled', durationMs: 0, checks: [], error: '运行验证已由服务器显式关闭，不能视为功能通过。' };
  const { base, token } = connection();
  const timeout = Math.max(1, Math.min(remainingMs, 20000));
  let response: Response;
  try { response = await fetch(new URL('/validate', base), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...input, idea: input.idea.slice(0, 1200) }), signal: AbortSignal.timeout(timeout) }); }
  catch { throw new Error('浏览器验证服务不可用或超时，作品尚未确认可用。'); }
  if (!response.ok) throw new Error(`浏览器验证服务不可用（HTTP ${response.status}），未继续调用模型。`);
  const report = await response.json() as RuntimeValidationReport;
  if (report.schemaVersion !== 1 || !['passed', 'failed', 'inconclusive', 'not-run'].includes(report.status) || !Array.isArray(report.checks) || report.checks.length > 80) throw new Error('浏览器验证服务返回无效证据。');
  if (!Number.isFinite(report.durationMs) || report.durationMs < 0 || typeof report.coverage !== 'string' || report.checks.some(check => typeof check.name !== 'string' || !['passed', 'failed', 'inconclusive', 'not-run'].includes(check.status) || !['error', 'warning'].includes(check.severity) || typeof check.detail !== 'string')) throw new Error('浏览器验证服务返回无效检查内容。');
  return report;
}
