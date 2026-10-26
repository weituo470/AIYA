import type { BuildExecution } from '../../../lib/build-contract';
import { createHash } from 'node:crypto';
import { prisma } from '@aiya/database';
import { theatreStudentKey } from './_server';

export type TheatreTaskContext = {
  clientTaskId?: string;
  interactionId?: string;
  userId?: string;
  userName?: string;
  deviceId?: string;
  sessionId?: string;
  source?: string;
  appId?: string;
  appVersion?: string;
  recoveryTokenHash?: string;
};

type TaskStatus = 'started' | 'succeeded' | 'failed' | 'cancelled';

const text = (value: unknown, max = 240) => String(value || '').trim().slice(0, max);
const jsonValue = (value: unknown) => value == null ? undefined : JSON.parse(JSON.stringify(value));

export const normalizeTheatreTaskContext = (value: unknown): TheatreTaskContext => {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    clientTaskId: text(input.clientTaskId || input.taskId, 120) || undefined,
    interactionId: text(input.interactionId, 120) || undefined,
    userId: text(input.userId, 160) || undefined,
    userName: text(input.userName || input.studentNickname, 80) || undefined,
    deviceId: text(input.deviceId, 160) || undefined,
    sessionId: text(input.sessionId, 160) || undefined,
    source: text(input.source, 60) || 'unknown',
    appId: text(input.appId, 120) || undefined,
    appVersion: text(input.appVersion, 60) || undefined,
    recoveryTokenHash: typeof input.recoveryTokenHash === 'string' && /^[a-f0-9]{64}$/i.test(input.recoveryTokenHash) ? input.recoveryTokenHash : undefined,
  };
};

const requestFingerprint = (request: Request) => {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  const userAgent = request.headers.get('user-agent') || '';
  return createHash('sha256').update(`${forwarded}|${userAgent}`).digest('hex').slice(0, 20);
};

const resolveTaskIdentity = async (context: TheatreTaskContext, request: Request) => {
  let studentId = '';
  let studentName = '';
  if (context.deviceId) {
    const session = await prisma.theatreSession.findFirst({
      where: { deviceId: context.deviceId },
      orderBy: { updatedAt: 'desc' },
      include: { student: { select: { id: true, nickname: true } } },
    }).catch(() => null);
    studentId = session?.student?.id || '';
    studentName = session?.student?.nickname || '';
  }
  if (!studentId && context.userName) {
    const student = await prisma.theatreStudent.findUnique({
      where: { normalizedNickname: theatreStudentKey(context.userName) },
      select: { id: true, nickname: true },
    }).catch(() => null);
    studentId = student?.id || '';
    studentName = student?.nickname || '';
  }
  const userKey = context.userId
    || (studentId ? `student:${studentId}` : '')
    || (context.deviceId ? `device:${context.deviceId}` : '')
    || (context.userName ? `name:${theatreStudentKey(context.userName)}` : '')
    || `anonymous:${requestFingerprint(request)}`;
  return {
    userKey,
    userName: context.userName || studentName || (context.deviceId ? '未建档设备用户' : '匿名用户'),
    studentId: studentId || undefined,
  };
};

export async function beginTheatreTaskAudit(input: {
  diagnosticId: string;
  context?: unknown;
  request: Request;
  idea?: string;
  requestBody?: unknown;
  attempts?: unknown;
  currentApp?: unknown;
  modelMode?: string;
  model?: string;
  provider?: string;
  apiType?: string;
}) {
  const context = normalizeTheatreTaskContext(input.context);
  const identity = await resolveTaskIdentity(context, input.request);
  const startedAt = new Date();
  return prisma.theatreTask.upsert({
    where: { diagnosticId: input.diagnosticId },
    create: {
      diagnosticId: input.diagnosticId,
      clientTaskId: context.clientTaskId,
      interactionId: context.interactionId,
      userKey: identity.userKey,
      userName: identity.userName,
      studentId: identity.studentId,
      deviceId: context.deviceId,
      sessionId: context.sessionId,
      source: context.source || 'unknown',
      appId: context.appId,
      appVersion: context.appVersion,
      status: 'started',
      stage: 'received',
      idea: text(input.idea, 1_200),
      request: jsonValue(input.requestBody) as any || {},
      currentApp: jsonValue(input.currentApp) as any,
      modelMode: text(input.modelMode, 40) || undefined,
      model: text(input.model, 200) || undefined,
      provider: text(input.provider, 80) || undefined,
      apiType: text(input.apiType, 80) || undefined,
      startedAt,
      attempts: jsonValue(input.attempts) as any || [],
    },
    update: {
      clientTaskId: context.clientTaskId,
      interactionId: context.interactionId,
      userKey: identity.userKey,
      userName: identity.userName,
      studentId: identity.studentId,
      deviceId: context.deviceId,
      sessionId: context.sessionId,
      source: context.source || 'unknown',
      appId: context.appId,
      appVersion: context.appVersion,
      status: 'started',
      stage: 'received',
      idea: text(input.idea, 1_200),
      request: jsonValue(input.requestBody) as any || {},
      currentApp: jsonValue(input.currentApp) as any,
      modelMode: text(input.modelMode, 40) || undefined,
      model: text(input.model, 200) || undefined,
      provider: text(input.provider, 80) || undefined,
      apiType: text(input.apiType, 80) || undefined,
      startedAt,
      finishedAt: null,
      durationMs: null,
      httpStatus: null,
      error: undefined,
      result: undefined,
      attempts: jsonValue(input.attempts) as any || [],
    },
  });
}

export async function finishTheatreTaskAudit(diagnosticId: string, patch: {
  status: TaskStatus;
  stage?: string;
  durationMs?: number;
  httpStatus?: number;
  modelMode?: string;
  model?: string;
  provider?: string;
  apiType?: string;
  result?: unknown;
  error?: unknown;
  attempts?: unknown;
}) {
  return prisma.theatreTask.update({
    where: { diagnosticId },
    data: {
      status: patch.status,
      stage: text(patch.stage, 80) || patch.status,
      durationMs: Number.isFinite(patch.durationMs) ? Math.max(0, Math.round(patch.durationMs || 0)) : undefined,
      httpStatus: Number.isFinite(patch.httpStatus) ? Math.round(patch.httpStatus || 0) : undefined,
      modelMode: text(patch.modelMode, 40) || undefined,
      model: text(patch.model, 200) || undefined,
      provider: text(patch.provider, 80) || undefined,
      apiType: text(patch.apiType, 80) || undefined,
      result: jsonValue(patch.result) as any,
      error: jsonValue(patch.error) as any,
      attempts: jsonValue(patch.attempts) as any || [],
      finishedAt: new Date(),
    },
  });
}

export async function updateTheatreTaskProgress(diagnosticId: string, patch: {
  stage?: string;
  modelMode?: string;
  model?: string;
  provider?: string;
  apiType?: string;
  attempts?: unknown;
}) {
  return prisma.theatreTask.update({
    where: { diagnosticId },
    data: {
      stage: text(patch.stage, 80) || undefined,
      modelMode: text(patch.modelMode, 40) || undefined,
      model: text(patch.model, 200) || undefined,
      provider: text(patch.provider, 80) || undefined,
      apiType: text(patch.apiType, 80) || undefined,
      attempts: patch.attempts === undefined ? undefined : jsonValue(patch.attempts) as any,
    },
  });
}

const record = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

const rows = (value: unknown) => Array.isArray(value) ? value : [];

const buildTaskProcess = (task: any) => {
  const attemptBundle = record(task.attempts);
  const result = record(task.result);
  const error = record(task.error);
  const errorDetail = record(error.detail);
  const webSearch = record(attemptBundle.webSearch);
  const modelFailover = rows(
    attemptBundle.modelFailover
    || result.modelFailover
    || error.modelFailover
    || errorDetail.modelFailover,
  );
  const generationAttempts = rows(
    attemptBundle.generationAttempts
    || attemptBundle.attempts
    || (Array.isArray(task.attempts) ? task.attempts : undefined)
    || result.attempts
    || errorDetail.attempts,
  );
  const build = record(attemptBundle.build || result.build);
  const startedAt = task.startedAt?.toISOString?.() || String(task.startedAt || '');
  const finishedAt = task.finishedAt?.toISOString?.() || (task.finishedAt ? String(task.finishedAt) : null);
  const timeline: Array<Record<string, unknown>> = [
    {
      id: 'received',
      at: startedAt,
      stage: 'received',
      status: 'succeeded',
      title: '收到用户任务',
      summary: task.idea || '未记录需求内容',
      detail: {
        userKey: task.userKey,
        userName: task.userName,
        deviceId: task.deviceId,
        sessionId: task.sessionId,
        source: task.source,
        appVersion: task.appVersion,
      },
    },
  ];

  if (build.schemaVersion === 1) {
    timeline.push({ id: 'build-plan', at: startedAt, stage: 'build_plan', status: 'succeeded', title: '生成偏好与构建路线', summary: String(record(build.selection).reason || '保留既有生成路线'), detail: build });
    rows(build.stages).filter(value => record(value).name !== 'received').forEach((value, index) => {
      const item = record(value);
      timeline.push({ id: `build-stage-${index}`, at: item.finishedAt || item.startedAt, stage: item.name, status: item.status, title: `构建阶段：${item.name}`, summary: `耗时 ${item.durationMs ?? '进行中'} ms`, detail: item });
    });
  }
  if (webSearch.triggered === true) {
    const searchResults = rows(webSearch.results);
    const searchStatus = String(webSearch.status || 'failed');
    timeline.push({
      id: 'web-search',
      at: webSearch.finishedAt || webSearch.startedAt || startedAt,
      stage: 'web_search',
      status: searchStatus,
      title: '联网资料查询',
      summary: searchStatus === 'succeeded'
        ? `通过 ${String(webSearch.provider || 'search')} 获得 ${searchResults.length} 条参考资料，耗时 ${Number(webSearch.durationMs || 0)} ms`
        : `查询失败但未阻塞代码生成：${String(webSearch.error || '未获取到可用结果')}`,
      detail: webSearch,
    });
  }

  modelFailover.forEach((value, index) => {
    const item = record(value);
    const status = String(item.status || 'unknown');
    timeline.push({
      id: `model-${index + 1}`,
      at: item.finishedAt || item.startedAt || startedAt,
      stage: 'model_attempt',
      status,
      title: `模型配置 ${index + 1}：${String(item.model || '未记录模型')}`,
      summary: status === 'succeeded'
        ? `使用 ${String(item.mode || 'unknown')} 配置成功`
        : status === 'started'
          ? `正在调用 ${String(item.mode || 'unknown')} 配置`
          : `配置失败，${index + 1 < modelFailover.length ? '继续切换下一配置' : '没有更多可用配置'}`,
      detail: item,
    });
  });

  generationAttempts.forEach((value, index) => {
    const item = record(value);
    timeline.push({
      id: `generation-${index + 1}`,
      at: item.finishedAt || item.startedAt || startedAt,
      stage: 'generation_attempt',
      status: item.error ? 'failed' : 'succeeded',
      title: `生成检查 ${index + 1}`,
      summary: item.error ? String(record(item.error).message || '生成或验证失败') : '模型输出通过本轮检查',
      detail: item,
    });
  });

  if (finishedAt) {
    timeline.push({
      id: 'finished',
      at: finishedAt,
      stage: task.stage || task.status,
      status: task.status,
      title: task.status === 'succeeded' ? '任务完成' : task.status === 'failed' ? '任务失败' : '任务结束',
      summary: task.status === 'succeeded'
        ? `HTTP ${task.httpStatus || 200}，总耗时 ${task.durationMs || 0} ms`
        : String(record(error.error).message || error.message || `HTTP ${task.httpStatus || '—'}`),
      detail: task.status === 'succeeded' ? { result: task.result } : { error: task.error },
    });
  }

  return { webSearch, modelFailover, generationAttempts, timeline };
};

export async function listTheatreTaskAudits(input: {
  limit?: number;
  offset?: number;
  status?: string;
  search?: string;
} = {}) {
  const limit = Math.max(1, Math.min(Number(input.limit) || 200, 500));
  const offset = Math.max(0, Math.min(Number(input.offset) || 0, 100_000));
  const status = text(input.status, 30);
  const search = text(input.search, 120);
  const where: any = {};
  if (status && status !== 'all') where.status = status;
  if (search) {
    where.OR = [
      { diagnosticId: { contains: search, mode: 'insensitive' } },
      { clientTaskId: { contains: search, mode: 'insensitive' } },
      { interactionId: { contains: search, mode: 'insensitive' } },
      { userKey: { contains: search, mode: 'insensitive' } },
      { userName: { contains: search, mode: 'insensitive' } },
      { deviceId: { contains: search, mode: 'insensitive' } },
      { idea: { contains: search, mode: 'insensitive' } },
      { model: { contains: search, mode: 'insensitive' } },
    ];
  }
  const [tasks, filteredTotal, total, failed, running, succeeded] = await Promise.all([
    prisma.theatreTask.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        diagnosticId: true,
        clientTaskId: true,
        interactionId: true,
        userKey: true,
        userName: true,
        studentId: true,
        deviceId: true,
        sessionId: true,
        source: true,
        appId: true,
        appVersion: true,
        status: true,
        stage: true,
        idea: true,
        error: true,
        modelMode: true,
        model: true,
        provider: true,
        apiType: true,
        httpStatus: true,
        durationMs: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.theatreTask.count({ where }),
    prisma.theatreTask.count(),
    prisma.theatreTask.count({ where: { status: 'failed' } }),
    prisma.theatreTask.count({ where: { status: 'started' } }),
    prisma.theatreTask.count({ where: { status: 'succeeded' } }),
  ]);
  return {
    tasks: tasks.map((task: any) => ({
      ...task,
      startedAt: task.startedAt?.toISOString?.() || task.startedAt,
      finishedAt: task.finishedAt?.toISOString?.() || task.finishedAt,
      createdAt: task.createdAt?.toISOString?.() || task.createdAt,
      updatedAt: task.updatedAt?.toISOString?.() || task.updatedAt,
    })),
    stats: { total, failed, running, succeeded },
    page: {
      offset,
      limit,
      filteredTotal,
      hasMore: offset + tasks.length < filteredTotal,
    },
  };
}

export async function getTheatreTaskAudit(taskId: string) {
  const id = text(taskId, 160);
  if (!id) return null;
  const task = await prisma.theatreTask.findFirst({
    where: {
      OR: [
        { id },
        { diagnosticId: id },
        { clientTaskId: id },
      ],
    },
  });
  if (!task) return null;
  const process = buildTaskProcess(task);
  const buildRecord = record(record(task.attempts).build || record(task.result).build);
  return {
    ...task,
    process,
    build: buildRecord.schemaVersion === 1 ? buildRecord as unknown as BuildExecution : null,
    startedAt: task.startedAt.toISOString(),
    finishedAt: task.finishedAt?.toISOString() || null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}
