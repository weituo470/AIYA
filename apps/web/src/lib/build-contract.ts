/** User intent is independent of the provider/model configuration. */
export const buildPreferences = ['auto', 'speed', 'quality'] as const;
export type BuildPreference = typeof buildPreferences[number];
export const buildPreferenceLabels: Record<BuildPreference, string> = {
  auto: '智能判断', speed: '速度优先', quality: '质量优先',
};
export const buildPreferenceDescriptions: Record<BuildPreference, string> = {
  auto: '按需求选模型，限制等待，并跳过近期连续连接失败的配置。',
  speed: '优先快速配置，尽快验证想法。',
  quality: '优先质量配置，允许等待更久。',
};
export const isBuildPreference = (value: unknown): value is BuildPreference =>
  typeof value === 'string' && buildPreferences.includes(value as BuildPreference);
export const normalizeBuildPreference = (value: unknown): BuildPreference => isBuildPreference(value) ? value : 'auto';

export type RuntimeValidationReport = {
  schemaVersion: 1;
  status: 'passed' | 'failed' | 'inconclusive' | 'not-run';
  coverage: string;
  durationMs: number;
  checks: Array<{ name: string; status: 'passed' | 'failed' | 'inconclusive' | 'not-run'; severity: 'error' | 'warning'; detail: string }>;
  error?: string;
  candidateHtmlSha256?: string | null;
  baselineHtmlSha256?: string | null;
};
export type BuildExecution = {
  schemaVersion: 1;
  policyVersion: 'aiya-build-phase1-v1' | 'aiya-build-phase2-v1';
  taskId: string;
  preference: BuildPreference;
  operation: 'create' | 'revise';
  selection: {
    source: 'strategy' | 'manual' | 'legacy';
    requestedModelMode: string | null;
    selectedModelMode: string | null;
    complexity: 'standard' | 'complex';
    signals: string[];
    reason: string;
    skippedModels?: Array<{ model: string; reason: string }>;
  };
  capability?: { route: 'single-html' | 'unsupported-backend'; message?: string };
  route: 'pending' | 'direct-http' | 'hermes-cli' | 'template-fallback';
  model: { requested: string | null; returned: string | null; provider: string | null; apiType: string | null };
  stages: Array<{ name: string; startedAt: string; finishedAt?: string; durationMs?: number; status: 'running' | 'passed' | 'failed' }>;
  checks: Array<{ name: string; status: 'passed' | 'failed' | 'inconclusive' | 'not-run'; detail: string; durationMs?: number }>;
  validations?: RuntimeValidationReport[];
  repair?: { attempted: boolean; maxAttempts: 1; reason?: string; evidence?: unknown; status: 'not-needed' | 'running' | 'passed' | 'failed' | 'blocked' };
  budget?: { maxCalls: number; calls: number; maxReservedOutputTokens: number; reservedOutputTokens: number; deadline: string };
  calls: Array<{
    model: string; returnedModel: string | null; status: 'running' | 'succeeded' | 'failed';
    durationMs?: number; usage: Record<string, number> | null;
    finishReason?: string; error?: string; failureKind?: string;
    maxOutputTokens?: number; reasoningEffort?: string;
    transport?: object;
  }>;
  cost: { currency: null; amount: null; status: 'unknown' };
  version: { projectId: string | null; parentHtmlSha256: string | null; outputHtmlSha256: string | null; artifactId: string | null };
  status: 'running' | 'succeeded' | 'failed';
  totalDurationMs?: number;
  error?: string;
};
