import { createHash, timingSafeEqual } from 'node:crypto';
export const recoveryHash = (token: unknown) => typeof token === 'string' && /^[a-f0-9]{64}$/i.test(token) ? createHash('sha256').update(token).digest('hex') : '';
export function canRecoverTask(task: any, clientTaskId: string, deviceId: string, token: unknown) {
  if (!task || task.clientTaskId !== clientTaskId) return false;
  if (task.source === 'android-v3') return Boolean(deviceId && task.deviceId === deviceId);
  if (task.source !== 'web-v2') return false;
  const expected = task.request?.taskContext?.recoveryTokenHash;
  const received = recoveryHash(token);
  return typeof expected === 'string' && expected.length === 64 && received.length === 64 && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
