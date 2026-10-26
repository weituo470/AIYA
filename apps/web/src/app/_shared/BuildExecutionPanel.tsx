import { buildPreferenceLabels, type BuildExecution } from '../../lib/build-contract';
import styles from './build-execution.module.css';

const stageLabels: Record<string, string> = { received: '接收需求', planning: '选择配置', 'validator-readiness': '验证器就绪检查', 'web-research': '资料查询', generation: '模型生成（含有限重试）', 'static-validation': '安全检查', 'browser-validation': '浏览器验证', 'feedback-repair': '单次定向修复', 'browser-revalidation': '修复后复验', 'template-fallback': '模板回退' };
const checkLabels: Record<string, string> = { 'html-syntax-intent': '结构 / 语法 / 需求特征', 'resource-safety': '资源安全', 'browser-runtime': '浏览器验证（以覆盖范围为准）', 'android-device': 'Android 实机验证' };
const coverageLabels: Record<string, string> = { 'calculator-core': '计算器核心功能', 'task-board-core': '任务看板核心功能', 'smoke-only': '仅页面冒烟，未验业务逻辑', 'worker-error': '验证进程未完成', 'worker-timeout': '验证超时', disabled: '已关闭' };
const stateLabels: Record<string, string> = { passed: '通过', failed: '失败', inconclusive: '证据不足', blocked: '预算阻止执行', 'not-run': '未执行', running: '进行中', succeeded: '已完成' };
const duration = (value?: number) => value === undefined ? '—' : `${value} ms`;
export function BuildExecutionPanel({ build }: { build: BuildExecution }) {
  return <section className={styles.panel} aria-label="应用构建记录">
    <h3>应用构建记录</h3>
    <dl className={styles.summary}>
      <div><dt>生成偏好</dt><dd>{buildPreferenceLabels[build.preference]} · {build.operation === 'revise' ? '修改已有作品' : '新建作品'}</dd></div>
      <div><dt>实际路线</dt><dd>{build.route === 'direct-http' ? '现有直接生成' : build.route === 'template-fallback' ? '模板回退（非模型产物）' : build.route === 'hermes-cli' ? 'Hermes CLI' : '尚未执行'}</dd></div>
      <div><dt>选择依据</dt><dd>{build.selection.reason || '尚未选定'} {build.selection.source === 'manual' ? '（手选模型优先）' : ''}</dd></div>
      <div><dt>请求 / 返回模型</dt><dd>{build.model.requested || '—'} / {build.model.returned || '供应方未提供或未成功返回'}</dd></div>
      <div><dt>总耗时 / 调用</dt><dd>{duration(build.totalDurationMs)} · {build.calls.length} 次已记录调用</dd></div>
      <div><dt>实际费用</dt><dd>未知：未配置供应商计费，内部权重不当作金额</dd></div>
    </dl>
    <h4>阶段耗时</h4>
    <ul>{build.stages.map((stage, index) => <li key={`${stage.name}-${index}`}><strong>{stageLabels[stage.name] || stage.name}</strong><span>{stateLabels[stage.status]} · {duration(stage.durationMs)}</span></li>)}</ul>
    <h4>检查证据</h4>
    <ul>{build.checks.map(check => <li key={check.name}><strong>{checkLabels[check.name] || check.name}：{stateLabels[check.status]}</strong><p>{check.detail}</p></li>)}</ul>
    <h4>模型调用</h4>
    {build.repair && <p>定向修复：{build.repair.attempted ? `已尝试 1 / ${build.repair.maxAttempts} 次 · ${stateLabels[build.repair.status] || build.repair.status}` : build.repair.status === 'blocked' ? '预算阻止执行，没有额外模型调用' : '未触发'}。{build.repair.reason}</p>}
    {build.budget && <p>调用预算：{build.budget.calls} / {build.budget.maxCalls}；预留输出上限 {build.budget.reservedOutputTokens} / {build.budget.maxReservedOutputTokens} Tokens（不是实际用量或金额）。</p>}
    {build.validations?.map((report, index) => <details key={index}><summary>第 {index + 1} 轮验证 · {coverageLabels[report.coverage] || report.coverage} · {stateLabels[report.status]} · {report.durationMs} ms</summary><ul>{report.checks.map((check, n) => <li key={n}><strong>{check.name}：{stateLabels[check.status]} {check.severity === 'warning' ? '（提示）' : ''}</strong><p>{check.detail}</p></li>)}</ul></details>)}
    <ul>{build.calls.map((call, index) => <li key={index}><strong>{index + 1}. {call.model} · {stateLabels[call.status]}</strong><span>{duration(call.durationMs)} · 返回 {call.returnedModel || '未提供'} · Tokens {call.usage ? JSON.stringify(call.usage) : '未知'}</span></li>)}</ul>
    <details><summary>版本与原始构建记录</summary><pre>{JSON.stringify(build, null, 2)}</pre></details>
  </section>;
}
