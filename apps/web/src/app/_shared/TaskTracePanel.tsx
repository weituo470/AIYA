import { buildPreferenceLabels, type BuildExecution } from '../../lib/build-contract';
import styles from './task-trace.module.css';

const states: Record<string, string> = { running: '进行中', succeeded: '已完成', passed: '通过', failed: '失败', inconclusive: '证据不足', 'not-run': '未执行', blocked: '预算阻止执行', 'not-needed': '未触发' };
const stages: Record<string, string> = { received: '接收需求', planning: '选择生成方案', 'validator-readiness': '检查验证器', 'web-research': '联网查询', generation: '模型生成', 'static-validation': '静态检查', 'browser-validation': '浏览器验证', 'feedback-repair': '定向修复', 'browser-revalidation': '修复后复验', 'template-fallback': '模板回退' };
const checks: Record<string, string> = { 'html-syntax-intent': '结构 / 语法 / 需求特征', 'resource-safety': '资源安全', 'browser-runtime': '浏览器验证', 'android-device': 'Android 实机验证' };
const coverage: Record<string, string> = { 'calculator-core': '计算器核心功能', 'task-board-core': '任务看板核心功能', 'smoke-only': '仅页面冒烟，未验证业务逻辑', 'worker-error': '验证进程异常', 'worker-timeout': '验证超时', disabled: '验证已关闭' };
const time = (value?: number) => typeof value === 'number' ? `${(value / 1000).toFixed(1)} 秒` : '未记录';

export function TaskTracePanel({ build, pending = false, failed = false, taskId }: { build?: BuildExecution; pending?: boolean; failed?: boolean; taskId?: string }) {
  if (!build) return <section className={styles.panel} aria-label="任务轨迹">
    <h3>任务轨迹</h3>
    <p role="status">{pending ? '任务进行中，正在等待服务器返回本次构建记录。' : failed ? '本次任务失败，服务器未返回构建记录。' : '此作品暂无任务轨迹。新生成的任务会记录实际方案、模型与测试证据。'}</p>
    <p>没有记录不代表已测试；这里不会沿用上一个任务的成功结果。</p>
    {taskId && <p className={styles.meta}>客户端任务编号：{taskId}</p>}
  </section>;

  return <section className={styles.panel} aria-label="任务轨迹" data-testid="task-trace-panel">
    <header><h3>任务轨迹</h3><strong className={build.status === 'failed' ? styles.failure : styles.status}>{states[build.status]}</strong></header>
    <p className={styles.meta}>本次任务：{build.taskId}</p>
    {build.status === 'failed' && <p className={styles.failure}>失败原因：{build.error || '服务器未返回具体原因，请用任务编号查看后台记录。'}</p>}
    <dl className={styles.summary}>
      <div><dt>技术方案</dt><dd>{build.route === 'direct-http' ? '模型 API 直接生成 HTML / CSS / JavaScript' : build.route === 'hermes-cli' ? 'Hermes Agent / CLI 构建' : build.route === 'template-fallback' ? '模板回退（非本次模型生成）' : '尚未执行生成'}</dd></div>
      <div><dt>策略 / 操作</dt><dd>{buildPreferenceLabels[build.preference]} · {build.operation === 'revise' ? '在原作品上修改' : '新建作品'}</dd></div>
      <div><dt>请求模型</dt><dd>{build.model.requested || '未记录'}</dd></div>
      <div><dt>实际返回模型</dt><dd>{build.model.returned || '供应方未提供，或尚未成功返回'}</dd></div>
      <div><dt>协议 / 总耗时</dt><dd>{build.model.apiType || '未记录'} · {time(build.totalDurationMs)}</dd></div>
      <div><dt>调用 / 修复</dt><dd>{build.calls.length} 次模型调用 · {build.repair?.attempted ? `定向修复 ${states[build.repair.status] || build.repair.status}` : build.repair?.status === 'blocked' ? '预算阻止修复' : '未触发修复'}</dd></div>
    </dl>
    <p>选择依据：{build.selection.reason || '未记录'}</p>
    <h4>是否经过测试？</h4>
    <p>生成完成 ≠ 完整测试通过。以下只展示实际执行的检查；冒烟测试不代表玩法、语音或体感功能已验收。</p>
    <ul>{build.checks.length ? build.checks.map((check, index) => <li key={index}><strong>{checks[check.name] || check.name} · {states[check.status]}</strong><p>{check.detail}</p></li>) : <li>没有返回检查证据。</li>}</ul>
    {build.validations?.map((report, index) => <details key={index}><summary>第 {index + 1} 轮浏览器验证 · {coverage[report.coverage] || report.coverage} · {states[report.status]}</summary><p>验证耗时：{time(report.durationMs)}</p><ul>{report.checks.map((check, n) => <li key={n}><strong>{check.name} · {states[check.status]}{check.severity === 'warning' ? '（提示）' : ''}</strong><p>{check.detail}</p></li>)}</ul></details>)}
    <details open={build.status === 'failed'}><summary>阶段轨迹与耗时</summary><ol>{build.stages.map((stage, index) => <li key={index}><strong>{stages[stage.name] || stage.name} · {states[stage.status]}</strong><span>{time(stage.durationMs)}</span></li>)}</ol></details>
    <details><summary>模型调用、重试与用量</summary><ol>{build.calls.map((call, index) => <li key={index}><strong>{index + 1}. {call.model} · {states[call.status]}</strong><p>返回模型：{call.returnedModel || '未提供'} · {time(call.durationMs)}</p><p>Tokens：{call.usage ? Object.entries(call.usage).filter(([, value]) => typeof value === 'number').map(([key, value]) => `${key} ${value}`).join(' / ') || '未记录' : '供应方未提供'}</p></li>)}</ol>{build.repair?.reason && <p>修复原因：{build.repair.reason}</p>}<p>实际费用未知；调用次数和 Tokens 不当作计费金额。</p></details>
    <details><summary>版本与调试编号</summary><dl className={styles.summary}><div><dt>策略版本</dt><dd>{build.policyVersion}</dd></div><div><dt>作品编号</dt><dd>{build.version.artifactId || '未记录'}</dd></div><div><dt>上一版指纹</dt><dd>{build.version.parentHtmlSha256 || '无 / 未记录'}</dd></div><div><dt>本次输出指纹</dt><dd>{build.version.outputHtmlSha256 || '无 / 未记录'}</dd></div></dl></details>
  </section>;
}
