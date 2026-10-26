import type { BuildExecution } from '../../../lib/build-contract';
import type { GoldenKeyContext, GoldenKeyLineage } from '../../_shared/golden-key-flow';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
export type ViewMode = 'preview' | 'source' | 'evidence' | 'replay' | 'trace';

export type JobEvent = {
  at: string;
  stage: string;
  message: string;
  data?: Record<string, unknown>;
};


export type DeviceContext = {
  surface?: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  pointer?: 'fine' | 'coarse' | 'none' | 'unknown';
  touch?: boolean;
  width?: number;
  height?: number;
  isApk?: boolean;
};

export type GeneratedResult = {
  goldenKey?: GoldenKeyLineage;
  id?: string;
  build?: BuildExecution;
  title?: string;
  brief?: string;
  html?: string;
  model?: string;
};

export type ValidationReport = {
  ok?: boolean;
  failures?: string[];
  warnings?: string[];
  quality?: {
    score?: number;
    threshold?: number;
    warnings?: string[];
    gateFailures?: string[];
  };
};

export type CreateJob = {
  goldenKeyContext?: GoldenKeyContext;
  id: string;
  build?: BuildExecution;
  interactionId?: string;
  status: JobStatus;
  stage: string;
  prompt: string;
  revision?: string;
  attempts?: number;
  events?: JobEvent[];
  result?: GeneratedResult | null;
  validationReport?: ValidationReport | null;
  error?: string | null;
};

export type StudentProfile = {
  nickname?: string;
  nicknameConfirmedByUser?: boolean;
  ageGroup?: 'child' | 'adult';
  pronoun?: string;
  deviceBound?: boolean;
  deviceId?: string;
  loginMethod?: 'android-device' | 'voiceprint' | 'nickname' | 'manual';
  voiceprintEnrolled?: boolean;
  voiceprintSampleCount?: number;
  voiceprintUpdatedAt?: string;
  updatedAt?: string;
};

export type TeacherChatMessage = {
  id: string;
  role: 'teacher' | 'student';
  text: string;
  at: string;
};

export type StudentMemory = {
  profile: StudentProfile;
  chatMessages: TeacherChatMessage[];
  currentApp?: GeneratedResult | null;
  updatedAt: string;
};
