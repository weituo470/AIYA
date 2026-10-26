import { createHash } from 'node:crypto';
import { normalizeBuildPreference, type BuildExecution } from '../../../lib/build-contract';
import { assessBuildRequest } from './_build-routing-policy';

export const htmlHash = (html?: string | null) => html ? createHash('sha256').update(html).digest('hex') : null;

export function createBuildExecution(input: { taskId: string; preference?: unknown; idea: string; html?: string | null; projectId?: string; startedAt: number }): BuildExecution {
  // Cheap deterministic routing, not a new classifier API call or an Agent claim.
  const assessment = assessBuildRequest(input.idea, Boolean(input.html));
  const signals = assessment.signals;
  return {
    schemaVersion: 1, policyVersion: process.env.AIYA_BUILD_VALIDATION === 'off' ? 'aiya-build-phase1-v1' : 'aiya-build-phase2-v1', taskId: input.taskId,
    preference: normalizeBuildPreference(input.preference), operation: input.html ? 'revise' : 'create',
    selection: { source: input.preference === undefined ? 'legacy' : 'strategy', requestedModelMode: null, selectedModelMode: null, complexity: signals.length ? 'complex' : 'standard', signals, reason: '' },
    route: 'pending', model: { requested: null, returned: null, provider: null, apiType: null },
    stages: [{ name: 'received', startedAt: new Date(input.startedAt).toISOString(), status: 'running' }],
    checks: [
      { name: 'html-syntax-intent', status: 'not-run', detail: 'HTML 结构、JavaScript 语法与需求特征静态检查。' },
      { name: 'resource-safety', status: 'not-run', detail: '外部资源和禁止 API 静态检查。' },
      { name: 'browser-runtime', status: 'not-run', detail: '等待独立浏览器验证；未知应用类型仅做冒烟，不代表所有功能通过。' },
      { name: 'android-device', status: 'not-run', detail: '未自动执行 Android 实机验证。' },
    ],
    calls: [], cost: { currency: null, amount: null, status: 'unknown' },
    capability: { route: assessment.capability, message: assessment.capabilityMessage },
    version: { projectId: input.projectId?.slice(0, 160) || `project_${input.taskId}`, parentHtmlSha256: htmlHash(input.html), outputHtmlSha256: null, artifactId: null }, status: 'running',
  };
}

export function chooseBuildModelMode(build: BuildExecution, fallback: string, manualMode?: string): string {
  if (manualMode) {
    build.selection.source = build.selection.source === 'legacy' ? 'legacy' : 'manual';
    build.selection.requestedModelMode = manualMode;
    build.selection.reason = '保留用户指定模型；生成偏好不覆盖手选配置。';
    return manualMode;
  }
  build.selection.source = 'strategy';
  const mode = build.preference === 'quality' || (build.preference === 'auto' && build.selection.complexity === 'complex') ? 'quality' : 'default';
  build.selection.requestedModelMode = mode;
  build.selection.reason = build.preference === 'quality' ? '质量偏好：优先现有质量配置。'
    : build.preference === 'speed' ? '速度偏好：优先现有快速响应配置。'
      : build.selection.complexity === 'complex' ? `规则识别 ${build.selection.signals.join('、')}，优先质量配置；未调用难度分类模型。`
        : '常规任务优先快速响应配置；未调用难度分类模型。';
  return mode || fallback;
}

export function advanceBuildStage(build: BuildExecution, name: string, failed = false, now = Date.now()) {
  const previous = build.stages.at(-1);
  if (previous?.status === 'running') {
    previous.finishedAt = new Date(now).toISOString();
    previous.durationMs = Math.max(0, now - Date.parse(previous.startedAt));
    previous.status = failed ? 'failed' : 'passed';
  }
  if (name !== 'finished') build.stages.push({ name, startedAt: new Date(now).toISOString(), status: 'running' });
}

export function finalizeBuild(build: BuildExecution, input: { succeeded: boolean; startedAt: number; html?: string; error?: string; now?: number }) {
  const now = input.now ?? Date.now();
  advanceBuildStage(build, 'finished', !input.succeeded, now);
  build.status = input.succeeded ? 'succeeded' : 'failed';
  build.totalDurationMs = Math.max(0, now - input.startedAt);
  if (input.error) build.error = input.error.slice(0, 500);
  if (input.succeeded && input.html) {
    build.version.outputHtmlSha256 = htmlHash(input.html);
    build.version.artifactId = `${build.taskId}:${build.version.outputHtmlSha256!.slice(0, 12)}`;
  }
  return build;
}

export function collectBuildCalls(build: BuildExecution, failover: Array<{ model: string; status: string; durationMs?: number; generationAttempts?: Array<{ error?: unknown; state?: string; durationMs?: number; returnedModel?: string; usage?: Record<string, number>; finishReason?: string; transport?: object; maxOutputTokens?: number; reasoningEffort?: string }> }>) {
  build.calls = failover.filter(candidate => candidate.status !== 'started' || candidate.generationAttempts?.length).flatMap<BuildExecution['calls'][number]>(candidate => candidate.generationAttempts !== undefined
    ? candidate.generationAttempts.map(attempt => {
      const error = attempt.error && typeof attempt.error === 'object' ? attempt.error as Record<string, any> : undefined;
      return { model: candidate.model, returnedModel: attempt.returnedModel || null, status: (attempt.state === 'running' ? 'running' : attempt.error ? 'failed' : 'succeeded') as 'running' | 'failed' | 'succeeded', durationMs: attempt.durationMs, usage: attempt.usage || null,
        finishReason: attempt.finishReason || error?.detail?.finishReason, error: error?.message?.slice(0, 240), failureKind: error?.detail?.failureKind,
        transport: attempt.transport, maxOutputTokens: attempt.maxOutputTokens, reasoningEffort: attempt.reasoningEffort };
    })
    : [{ model: candidate.model, returnedModel: null, status: (candidate.status === 'succeeded' ? 'succeeded' : 'failed') as 'failed' | 'succeeded', durationMs: candidate.durationMs, usage: null }]);
  build.model.returned = build.calls.filter(call => call.status === 'succeeded').at(-1)?.returnedModel || null;
}
