import type { BuildExecution } from '../../lib/build-contract';

/** A failed revision must never inherit the previous successful artifact's trace. */
export function selectTaskBuild(job: { build?: BuildExecution; status: string } | null, artifact: { build?: BuildExecution } | null): BuildExecution | undefined {
  return job ? job.build : artifact?.build;
}

export class TeacherCoderError extends Error {
  constructor(message: string, public readonly build?: BuildExecution) {
    super(message);
    this.name = 'TeacherCoderError';
  }
}

export function buildValidationSummary(build?: BuildExecution) {
  if (!build) return { warnings: ['没有返回检查证据，不能据此认定作品已通过测试。'] };
  const failed = build.checks.filter(check => check.status === 'failed');
  return {
    ok: failed.length ? false : undefined,
    failures: failed.map(check => `${check.name}：${check.detail}`),
    warnings: ['生成成功不代表完整功能验收，请在任务轨迹查看具体检查与覆盖范围。', ...build.checks.filter(check => check.status !== 'passed').map(check => `${check.name}：${check.detail}`)],
  };
}
