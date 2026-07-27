import type { CreateJob, GeneratedResult, StudentProfile, TeacherChatMessage } from './types';

export const theatreReplayStorageKey = 'aiya:create-theatre:replay-current';
export const theatreReplayLibraryStorageKey = 'aiya:create-theatre:replay-library';
export const theatreReplaySchemaVersion = 2;

export type TheatreReplayVersion = {
  version: number;
  at: string;
  prompt: string;
  title: string;
  brief: string;
  html: string;
  model?: string;
  events: string[];
  summary: string;
  lines: number;
  chars: number;
};

export type TheatreReplaySample = {
  schemaVersion: number;
  id: string;
  projectId: string;
  title: string;
  studentName?: string;
  createdAt: string;
  updatedAt: string;
  messages: TeacherChatMessage[];
  versions: TheatreReplayVersion[];
};

export type TheatreReplayScene = {
  id: string;
  type: 'intro' | 'message' | 'version';
  title: string;
  narration: string;
  detail: string;
  version?: TheatreReplayVersion;
  html?: string;
};

const createReplayId = () => `replay-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

type CreateReplaySampleOptions = {
  projectId?: string;
  studentName?: string;
  messages?: TeacherChatMessage[];
  createdAt?: string;
};

export const createEmptyReplaySample = (options: CreateReplaySampleOptions = {}): TheatreReplaySample => {
  const now = new Date().toISOString();
  const id = createReplayId();
  const messages = Array.isArray(options.messages) ? options.messages.filter(Boolean).slice(-80) : [];
  const createdAt = options.createdAt || messages[0]?.at || now;
  return {
    schemaVersion: theatreReplaySchemaVersion,
    id,
    projectId: options.projectId || id,
    title: options.studentName ? `${options.studentName}的 AI 编程课堂回放` : 'AI 编程课堂回放',
    studentName: options.studentName,
    createdAt,
    updatedAt: now,
    messages,
    versions: [],
  };
};

export const normalizeReplaySample = (value: unknown): TheatreReplaySample => {
  if (!value || typeof value !== 'object') return createEmptyReplaySample();
  const sample = value as Partial<TheatreReplaySample>;
  if (
    sample.schemaVersion !== theatreReplaySchemaVersion
    || typeof sample.projectId !== 'string'
    || !sample.projectId.trim()
  ) {
    return createEmptyReplaySample();
  }
  const fallback = createEmptyReplaySample();
  return {
    schemaVersion: theatreReplaySchemaVersion,
    id: typeof sample.id === 'string' ? sample.id : fallback.id,
    projectId: sample.projectId,
    title: typeof sample.title === 'string' ? sample.title : fallback.title,
    studentName: typeof sample.studentName === 'string' ? sample.studentName : undefined,
    createdAt: typeof sample.createdAt === 'string' ? sample.createdAt : fallback.createdAt,
    updatedAt: typeof sample.updatedAt === 'string' ? sample.updatedAt : fallback.updatedAt,
    messages: Array.isArray(sample.messages) ? sample.messages.filter(Boolean).slice(-80) as TeacherChatMessage[] : [],
    versions: Array.isArray(sample.versions) ? sample.versions.filter(Boolean).slice(-12) as TheatreReplayVersion[] : [],
  };
};

export const filterReplayMessagesForSample = (
  sample: TheatreReplaySample,
  messages: TeacherChatMessage[],
) => {
  const projectStartedAt = new Date(sample.createdAt).getTime();
  return messages
    .filter((message) => {
      const messageAt = new Date(message.at).getTime();
      return !Number.isFinite(projectStartedAt) || !Number.isFinite(messageAt) || messageAt >= projectStartedAt;
    })
    .slice(-80);
};

export const makeReplayVersion = (version: number, job: CreateJob): TheatreReplayVersion | null => {
  const result = job.result as GeneratedResult | null | undefined;
  const html = result?.html || '';
  if (!html) return null;
  const lines = html.split('\n').length;
  const title = result?.title || `第 ${version} 版作品`;
  const brief = result?.brief || '老师完成了一个可运行的网页版本。';
  const events = (job.events || [])
    .map((event) => event.message)
    .filter((message): message is string => Boolean(message && !/[�]/.test(message)))
    .slice(-8);
  const summary = [
    `${title}：${brief}`,
    `本次需求：${job.revision || job.prompt || '生成第一个作品'}`,
    `代码规模：约 ${lines} 行，${html.length.toLocaleString('zh-CN')} 个字符。`,
    events.length ? `过程记录：${events.join(' / ')}` : '',
  ].filter(Boolean).join('\n');

  return {
    version,
    at: new Date().toISOString(),
    prompt: job.revision || job.prompt || '',
    title,
    brief,
    html,
    model: result?.model,
    events,
    summary,
    lines,
    chars: html.length,
  };
};

const buildIntroScene = (sample: TheatreReplaySample): TheatreReplayScene => {
  const student = sample.studentName ? `${sample.studentName}同学` : '一位同学';
  const versionCount = sample.versions.length;
  return {
    id: `${sample.id}-intro`,
    type: 'intro',
    title: '课堂回放开始',
    narration: `这是一段 AI 编程课堂回放。${student}和老师一起完成了${versionCount || '若干'}个作品版本。接下来我会按时间顺序讲解对话、需求和代码变化。`,
    detail: versionCount
      ? `本回放包含 ${sample.messages.length} 条对话、${versionCount} 个代码版本。`
      : '还没有生成代码版本。先完成一次作品生成，就可以形成完整学习样本。',
  };
};

export const buildReplayScenes = (sample: TheatreReplaySample): TheatreReplayScene[] => {
  if (!sample.versions.length) return [];
  const scenes: TheatreReplayScene[] = [buildIntroScene(sample)];
  sample.messages.slice(-20).forEach((message, index) => {
    const speaker = message.role === 'teacher' ? '老师' : '学生';
    scenes.push({
      id: `${message.id || index}-message`,
      type: 'message',
      title: `${speaker}发言`,
      narration: `${speaker}说：${message.text}`,
      detail: message.text,
    });
  });
  sample.versions.forEach((version) => {
    scenes.push({
      id: `${sample.id}-version-${version.version}`,
      type: 'version',
      title: `第 ${version.version} 版代码`,
      narration: `第 ${version.version} 版完成。学生的需求是：${version.prompt || '先做一个可运行版本'}。老师写出了《${version.title}》。${version.brief} 这一版代码大约 ${version.lines} 行。`,
      detail: version.summary,
      version,
      html: version.html,
    });
  });
  return scenes;
};

export const saveReplayToLibrary = (sample: TheatreReplaySample) => {
  const saved = { ...sample, updatedAt: new Date().toISOString() };
  const raw = window.localStorage.getItem(theatreReplayLibraryStorageKey);
  const list = raw ? JSON.parse(raw) as TheatreReplaySample[] : [];
  const next = [saved, ...list.filter((item) => item.id !== saved.id)].slice(0, 20);
  window.localStorage.setItem(theatreReplayLibraryStorageKey, JSON.stringify(next));
  return saved;
};
