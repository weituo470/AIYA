import type { DeviceContext, GeneratedResult, JobEvent } from './types';

export type TeacherCoderOutput = {
  result: GeneratedResult;
  reply?: string;
  events?: Array<Pick<JobEvent, 'stage' | 'message'>>;
  model?: string;
};

export type TeacherCoderTaskContext = {
  clientTaskId?: string;
  interactionId?: string;
  userId?: string;
  userName?: string;
  deviceId?: string;
  sessionId?: string;
  source?: string;
  appId?: string;
  appVersion?: string;
};

export async function runTeacherCoder(input: {
  idea: string;
  modelMode?: string;
  teacherProfile?: { name?: string; avatar?: string } | null;
  currentApp?: GeneratedResult | null;
  deviceContext?: DeviceContext | null;
  taskContext?: TeacherCoderTaskContext | null;
}): Promise<TeacherCoderOutput> {
  const response = await fetch('/api/teacher-coder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idea: input.idea,
      modelMode: input.modelMode,
      teacherProfile: input.teacherProfile || null,
      currentApp: input.currentApp || null,
      deviceContext: input.deviceContext || null,
      taskContext: input.taskContext || null,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok || !payload?.result?.html) {
    const diagnosticSuffix = payload?.diagnosticId ? `（诊断ID：${payload.diagnosticId}）` : '';
    throw new Error(`${payload?.error || `Hermes Teacher Coding Agent ${response.status}`}${diagnosticSuffix}`);
  }
  return {
    result: payload.result as GeneratedResult,
    reply: typeof payload.reply === 'string' ? payload.reply : undefined,
    events: Array.isArray(payload.events) ? payload.events : undefined,
    model: typeof payload.model === 'string' ? payload.model : undefined,
  };
}
