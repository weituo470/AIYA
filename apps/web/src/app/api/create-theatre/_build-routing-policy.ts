import { hasAffirmedIntent, isCameraInputRequest, isMicrophoneInputRequest, isMotionSensorRequest } from './_teacher-coder-intent';

/** Bounded, transparent rules. No hidden classifier or extra model request. */
export function assessBuildRequest(idea: string, revision = false) {
  // Titles/labels are content, not capabilities. Do not ignore quoted real instructions.
  const text = idea.replace(/(?:标题|文案|文字|标签)(?:为|是|写|显示)?\s*["“「『][^"”」』]{0,100}["”」』]/g, '');
  const rules: Array<[string, RegExp]> = [
    ['multiple-pages', /多(?:个)?页面|[两二三四五六七八九十2-9]\s*(?:个)?(?:页面|页)|多个模块|多模块|流程审批|multi[- ]?page|(?:two|three|\d+)\s+pages/i],
    ['device-media', /摄像头|人脸|目光|陀螺仪|体感|麦克风|口哨|语音输入|倾斜手机|摇晃手机|重力感应|camera|microphone|gyroscope|deviceorientation/i],
    ['complex-game', /(?:[两二三四五六七八九十2-9]\s*(?:个)?关|多关|boss|敌人|碰撞|闯关).*(?:关卡|金币|生命|胜利|失败|敌人|碰撞|boss)|(?:多人|双人).*(?:对战|游戏)/i],
    ['complex-revision', /修复|报错|崩溃|不正常|失效|回归|bug|debug|(?:按钮|计算|功能|操作).*(?:不能|不对|错误)/i],
    ['server-data', /服务器|多人在线|用户登录|云端|跨设备|支付|远程数据库|(?:数据|用户|记录).*(?:同步|数据库)|database|backend|server/i],
  ];
  const signals = rules.filter(([name, pattern]) => (name !== 'complex-revision' || revision) && (name === 'device-media'
    ? isCameraInputRequest(text) || isMicrophoneInputRequest(text) || isMotionSensorRequest(text)
    : hasAffirmedIntent(text, pattern))).map(([name]) => name);
  const backend = hasAffirmedIntent(text, /(?:真实|真正|接入|部署).{0,12}(?:服务器|数据库|登录|支付)|(?:多人在线|跨设备同步|远程数据库|云端同步)|(?:服务器|数据库).{0,12}(?:持久化|共享|同步)|real\s+(?:backend|database)|deploy.*server/i);
  const demoOnly = hasAffirmedIntent(text, /(?:只做|仅做|只要|仅需).{0,8}(?:演示|模拟|原型|界面)|(?:模拟|演示).{0,8}(?:登录|数据库|服务器)/i);
  return { signals, complexity: signals.length ? 'complex' as const : 'standard' as const,
    capability: backend && !demoOnly ? 'unsupported-backend' as const : 'single-html' as const,
    capabilityMessage: backend && !demoOnly ? '当前作品路线只支持单文件前端，不能交付真实服务器、跨设备同步、数据库或支付。请改为明确的界面演示/模拟原型；真实后端需要独立工程路线。' : undefined };
}

const clampEnv = (key: string, fallback: number, min: number, max: number) => {
  const value = Number(process.env[key] || fallback);
  return Number.isFinite(value) ? Math.floor(Math.max(min, Math.min(max, value))) : fallback;
};
export function smartCandidateTimeout(mode: string, configured: number, automatic: boolean) {
  return automatic ? Math.min(configured, clampEnv(mode === 'quality' ? 'AIYA_BUILD_AUTO_QUALITY_TIMEOUT_MS' : 'AIYA_BUILD_AUTO_DEFAULT_TIMEOUT_MS', mode === 'quality' ? 90000 : 120000, 1000, 240000)) : configured;
}

type Health = { failures: number; lastFailure: number; openUntil: number };
// Per-process circuit, keyed by credential-inclusive HASH. No credentials are retained.
const health = new Map<string, Health>();
export function recordGenerationHealth(fingerprint: string, outcome: 'success' | 'transport-failure' | 'semantic-failure', now = Date.now()) {
  if (outcome === 'success') { health.delete(fingerprint); return; }
  if (outcome === 'semantic-failure') return;
  const previous = health.get(fingerprint);
  const failures = previous && now - previous.lastFailure < 600000 ? previous.failures + 1 : 1;
  health.set(fingerprint, { failures, lastFailure: now, openUntil: failures >= 2 ? now + 300000 : 0 });
  if (health.size > 128) health.delete(health.keys().next().value!);
}
export function generationCircuitOpen(fingerprint: string, now = Date.now()) {
  const value = health.get(fingerprint);
  if (!value || !value.openUntil) return false;
  if (now >= value.openUntil) { health.delete(fingerprint); return false; }
  return true;
}
