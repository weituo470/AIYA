import { recoverableGeneration } from '../../_shared/recoverable-generation';
import { TeacherCoderError } from '../../_shared/task-trace';
import { readBuildPreference } from '../../_shared/build-preference-storage';
import type { BuildExecution } from '../../../lib/build-contract';
import type { DeviceContext, GeneratedResult, JobEvent } from './types';

export type TeacherCoderOutput = {
  result: GeneratedResult;
  reply?: string;
  events?: Array<Pick<JobEvent, 'stage' | 'message'>>;
  model?: string;
  build?: BuildExecution;
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
  onProgress?: (payload: { stage?: string; build?: BuildExecution }) => void;
}): Promise<TeacherCoderOutput> {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  const recoveryToken = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  let payload;
  try {
    payload = await recoverableGeneration({
      idea: input.idea, buildPreference: readBuildPreference(), modelSelectionMode: 'auto',
      teacherProfile: input.teacherProfile || null, currentApp: input.currentApp || null,
      deviceContext: input.deviceContext || null,
      taskContext: { ...input.taskContext, source: 'web-v2', clientTaskId: input.taskContext?.clientTaskId || `web-${crypto.randomUUID()}`, recoveryToken },
    }, { onProgress: input.onProgress });
  } catch (error) {
    throw new TeacherCoderError(error instanceof Error ? error.message : '应用构建失败。', (error as { build?: BuildExecution })?.build);
  }
  return {
    result: { ...payload.result, build: payload.build } as GeneratedResult,
    reply: typeof payload.reply === 'string' ? payload.reply : undefined,
    events: Array.isArray(payload.events) ? payload.events : undefined,
    model: typeof payload.model === 'string' ? payload.model : undefined,
    build: payload.build,
  };
}
