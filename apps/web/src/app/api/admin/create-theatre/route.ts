import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { prisma } from '@aiya/database';
import { serializeStudent } from '../../create-theatre/_server';
import {
  normalizeCreateTheatreModelMode,
  readCreateTheatreAdminSettings,
  resolveCreateTheatreRuntimeModelConfig,
  toPublicCreateTheatreAdminSettings,
  toPublicCreateTheatreRuntimeModelConfig,
  writeCreateTheatreAdminSettings,
} from '../../create-theatre/_admin-settings';
import {
  chatWithHermesModel,
  testHermesModelConnection,
  type HermesChatMessage,
} from '../../create-theatre/_hermes-model-health';
import { getTheatreTaskAudit, listTheatreTaskAudits } from '../../create-theatre/_task-audit';
import {
  refreshTheatreShowcaseShortTitles,
  setTheatreTaskShowcase,
} from '../../create-theatre/_showcase';
import { readDiagnosticEvents, type DiagnosticEntry } from '../../../../lib/diagnostics';

export const runtime = 'nodejs';

const getAdminToken = () => process.env.CREATE_THEATRE_ADMIN_TOKEN || process.env.AIYA_ADMIN_TOKEN || '';
const getModelOperationPassword = () => process.env.CREATE_THEATRE_MODEL_OPERATION_PASSWORD || '';

type TaskConversationEntry = {
  id: string;
  role: 'user' | 'teacher' | 'system';
  text: string;
  at: string | null;
  phase: string;
  source: string;
  detail?: unknown;
};

const objectValue = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);

const buildTaskConversation = (
  task: NonNullable<Awaited<ReturnType<typeof getTheatreTaskAudit>>>,
  interactionEvents: DiagnosticEntry[],
) => {
  const entries: TaskConversationEntry[] = [];
  const seen = new Set<string>();
  const add = (entry: TaskConversationEntry) => {
    const normalized = entry.text.trim();
    if (!normalized) return;
    const key = `${entry.role}:${normalized.replace(/\s+/g, ' ')}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ ...entry, text: normalized });
  };

  add({
    id: 'task-user-request',
    role: 'user',
    text: task.idea,
    at: task.startedAt,
    phase: 'user_request',
    source: 'task',
    detail: { request: task.request, currentApp: task.currentApp },
  });

  interactionEvents.forEach((event, index) => {
    const data = objectValue(event.data);
    const phase = String(data.phase || 'interaction');
    const userText = String(data.userText || data.prompt || '').trim();
    const teacherReply = String(data.teacherReply || '').trim();
    if (userText) {
      add({
        id: `interaction-user-${index}`,
        role: 'user',
        text: userText,
        at: event.at,
        phase,
        source: event.scope,
        detail: event,
      });
    }
    if (teacherReply) {
      add({
        id: `interaction-teacher-${index}`,
        role: 'teacher',
        text: teacherReply,
        at: event.at,
        phase,
        source: event.scope,
        detail: event,
      });
    }
  });

  const result = objectValue(task.result);
  const reply = String(result.reply || '').trim();
  if (reply) {
    add({
      id: 'task-teacher-result',
      role: 'teacher',
      text: reply,
      at: task.finishedAt,
      phase: 'generation_result',
      source: 'teacher-coder',
      detail: { title: result.title, brief: result.brief, events: result.events },
    });
  }

  if (task.status === 'failed') {
    add({
      id: 'task-system-failure',
      role: 'system',
      text: '本次生成没有完成。失败原因和模型切换过程已记录，可在下方继续查看。',
      at: task.finishedAt,
      phase: task.stage || 'generation_failed',
      source: 'task-audit',
      detail: task.error,
    });
  }

  return entries.sort((left, right) => {
    const leftAt = left.at ? new Date(left.at).getTime() : 0;
    const rightAt = right.at ? new Date(right.at).getTime() : 0;
    return leftAt - rightAt;
  });
};

const hasValidModelOperationPassword = (value: unknown) => {
  const configuredText = getModelOperationPassword();
  const suppliedText = String(value || '');
  if (!configuredText || !suppliedText) return false;
  const supplied = Buffer.from(suppliedText, 'utf8');
  const configured = Buffer.from(configuredText, 'utf8');
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
};

const toPublicRuntimeModels = (settings: Awaited<ReturnType<typeof readCreateTheatreAdminSettings>>) => ({
  default: toPublicCreateTheatreRuntimeModelConfig(
    resolveCreateTheatreRuntimeModelConfig('default', settings.hermesProfiles.default),
  ),
  fast: toPublicCreateTheatreRuntimeModelConfig(
    resolveCreateTheatreRuntimeModelConfig('fast', settings.hermesProfiles.fast),
  ),
  quality: toPublicCreateTheatreRuntimeModelConfig(
    resolveCreateTheatreRuntimeModelConfig('quality', settings.hermesProfiles.quality),
  ),
    fusion: toPublicCreateTheatreRuntimeModelConfig(
      resolveCreateTheatreRuntimeModelConfig('fusion', settings.hermesProfiles.fusion),
    ),
});

const assertAdmin = (request: NextRequest) => {
  const configured = getAdminToken();
  if (!configured) {
    if (process.env.NODE_ENV !== 'production') return null;
    return NextResponse.json({ ok: false, error: 'CREATE_THEATRE_ADMIN_TOKEN is not configured' }, { status: 503 });
  }
  const token = request.headers.get('x-admin-token') || request.nextUrl.searchParams.get('token') || '';
  if (token !== configured) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  return null;
};

export async function GET(request: NextRequest) {
  const rejected = assertAdmin(request);
  if (rejected) return rejected;

  const taskId = request.nextUrl.searchParams.get('taskId') || '';
  if (taskId) {
    const task = await getTheatreTaskAudit(taskId);
    if (!task) return NextResponse.json({ ok: false, error: 'task not found' }, { status: 404 });
    const [diagnosticEvents, interactionEvents] = await Promise.all([
      readDiagnosticEvents({ id: task.diagnosticId, limit: 100 }).catch(() => []),
      task.interactionId
        ? readDiagnosticEvents({ id: task.interactionId, limit: 200 }).catch(() => [])
        : Promise.resolve([]),
    ]);
    const conversation = buildTaskConversation(task, interactionEvents);
    return NextResponse.json({
      ok: true,
      task: { ...task, conversation, interactionEvents, diagnosticEvents },
      generatedAt: new Date().toISOString(),
    });
  }

  const taskStatus = request.nextUrl.searchParams.get('taskStatus') || 'all';
  const taskSearch = request.nextUrl.searchParams.get('taskSearch') || '';
  const taskLimit = Number(request.nextUrl.searchParams.get('taskLimit') || 200);
  const taskOffset = Number(request.nextUrl.searchParams.get('taskOffset') || 0);
  if (request.nextUrl.searchParams.get('tasksOnly') === '1') {
    const taskAudit = await listTheatreTaskAudits({
      limit: taskLimit,
      offset: taskOffset,
      status: taskStatus,
      search: taskSearch,
    });
    return NextResponse.json({
      ok: true,
      tasks: taskAudit.tasks,
      taskStats: taskAudit.stats,
      taskPage: taskAudit.page,
      generatedAt: new Date().toISOString(),
    });
  }

  const [settings, studentCount, voiceprintCount, sessionCount, students, taskAudit] = await Promise.all([
    readCreateTheatreAdminSettings(),
    prisma.theatreStudent.count(),
    prisma.theatreVoiceprint.count(),
    prisma.theatreSession.count(),
    prisma.theatreStudent.findMany({
      include: {
        voiceprint: true,
        sessions: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    listTheatreTaskAudits({ limit: taskLimit, offset: taskOffset, status: taskStatus, search: taskSearch }),
  ]);

  const runtimeModels = toPublicRuntimeModels(settings);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    settings: toPublicCreateTheatreAdminSettings(settings),
    runtimeModel: runtimeModels[settings.modelMode],
    runtimeModels,
    kpis: {
      studentCount,
      voiceprintCount,
      sessionCount,
      taskCount: taskAudit.stats.total,
      failedTaskCount: taskAudit.stats.failed,
      runningTaskCount: taskAudit.stats.running,
      succeededTaskCount: taskAudit.stats.succeeded,
    },
    tasks: taskAudit.tasks,
    taskPage: taskAudit.page,
    students: students.map((student) => ({
      ...serializeStudent(student),
      latestSession: student.sessions[0] ? {
        id: student.sessions[0].id,
        deviceId: student.sessions[0].deviceId,
        status: student.sessions[0].status,
        messageCount: Array.isArray(student.sessions[0].chatMessages) ? student.sessions[0].chatMessages.length : 0,
        hasCurrentApp: Boolean(student.sessions[0].currentApp),
        updatedAt: student.sessions[0].updatedAt.toISOString(),
      } : null,
    })),
  });
}

export async function POST(request: NextRequest) {
  const rejected = assertAdmin(request);
  if (rejected) return rejected;

  const body = await request.json().catch(() => ({}));
  const mode = normalizeCreateTheatreModelMode(body.modelMode);
  const hermesInput = body.hermesProfile || {};

  if (body.action === 'save_settings') {
    if (!hasValidModelOperationPassword(body.operationPassword)) {
      return NextResponse.json({ ok: false, error: '操作密码错误，模型配置未修改' }, { status: 403 });
    }
    try {
      const currentSettings = await readCreateTheatreAdminSettings();
      const currentProfile = currentSettings.hermesProfiles[mode];
      const currentRuntime = resolveCreateTheatreRuntimeModelConfig(mode, currentProfile);
      const nextBaseUrl = String(hermesInput.baseUrl ?? currentProfile.baseUrl).trim().replace(/\/+$/, '');
      const nextModel = String(hermesInput.model ?? currentProfile.model).trim();
      const suppliedApiKey = String(hermesInput.apiKey || '').trim();
      const canMigrateEnvironmentKey = currentRuntime.source === 'environment'
        && nextBaseUrl === currentRuntime.baseUrl
        && nextModel === currentRuntime.model
        && !hermesInput.clearApiKey;
      const settings = await writeCreateTheatreAdminSettings({
        teacher: {
          name: body.teacher?.name,
          avatar: body.teacher?.avatar,
        },
        modelMode: mode,
        hermesProfiles: {
          [mode]: {
            baseUrl: nextBaseUrl,
            model: nextModel,
            apiKey: suppliedApiKey || (canMigrateEnvironmentKey ? currentRuntime.apiKey : ''),
            clearApiKey: Boolean(hermesInput.clearApiKey),
          },
        },
      });

      return NextResponse.json({
        ok: true,
        action: 'save_settings',
        settings: toPublicCreateTheatreAdminSettings(settings),
        runtimeModel: toPublicRuntimeModels(settings)[settings.modelMode],
        runtimeModels: toPublicRuntimeModels(settings),
        updatedAt: settings.updatedAt,
      });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : '保存课堂配置失败',
      }, { status: 400 });
    }
  }

  if (body.action === 'test_hermes_model') {
    try {
      const settings = await readCreateTheatreAdminSettings();
      const saved = settings.hermesProfiles[mode];
      const runtimeModel = resolveCreateTheatreRuntimeModelConfig(mode, saved);
      const suppliedApiKey = String(hermesInput.apiKey || '').trim();
      const baseUrl = String(hermesInput.baseUrl || saved.baseUrl || runtimeModel.baseUrl).trim().replace(/\/+$/, '');
      const model = String(hermesInput.model || saved.model || runtimeModel.model).trim();
      const canReuseRuntimeKey = baseUrl === runtimeModel.baseUrl;
      const result = await testHermesModelConnection({
        baseUrl,
        model,
        apiKey: suppliedApiKey || saved.apiKey || (canReuseRuntimeKey ? runtimeModel.apiKey : ''),
      });
      return NextResponse.json({
        ok: true,
        action: 'test_hermes_model',
        mode,
        result,
      });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : '模型检测失败',
      }, { status: 400 });
    }
  }

  if (body.action === 'chat_hermes_model') {
    try {
      const settings = await readCreateTheatreAdminSettings();
      const saved = settings.hermesProfiles[mode];
      const runtimeModel = resolveCreateTheatreRuntimeModelConfig(mode, saved);
      const suppliedApiKey = String(hermesInput.apiKey || '').trim();
      const baseUrl = String(hermesInput.baseUrl || saved.baseUrl || runtimeModel.baseUrl).trim().replace(/\/+$/, '');
      const model = String(hermesInput.model || saved.model || runtimeModel.model).trim();
      const canReuseRuntimeKey = baseUrl === runtimeModel.baseUrl;
      const messages: HermesChatMessage[] = (Array.isArray(body.messages) ? body.messages : [])
        .slice(-12)
        .map((message: unknown) => {
          const record = message && typeof message === 'object' ? message as Record<string, unknown> : {};
          const role = record.role === 'assistant' ? 'assistant' : 'user';
          const content = String(record.content || '').trim().slice(0, 4000);
          return { role, content };
        })
        .filter((message: HermesChatMessage) => Boolean(message.content));
      const result = await chatWithHermesModel({
        baseUrl,
        model,
        apiKey: suppliedApiKey || saved.apiKey || (canReuseRuntimeKey ? runtimeModel.apiKey : ''),
      }, messages);
      return NextResponse.json({
        ok: true,
        action: 'chat_hermes_model',
        mode,
        result,
      });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : '\u6a21\u578b\u5bf9\u8bdd\u5931\u8d25',
      }, { status: 400 });
    }
  }

  if (body.action === 'set_task_showcase') {
    const taskId = String(body.taskId || '').trim();
    if (!taskId) return NextResponse.json({ ok: false, error: 'taskId required' }, { status: 400 });
    try {
      await setTheatreTaskShowcase(taskId, Boolean(body.enabled));
      const task = await getTheatreTaskAudit(taskId);
      return NextResponse.json({
        ok: true,
        action: 'set_task_showcase',
        task,
        message: body.enabled ? '已设为优秀作品展示。' : '已从优秀作品展示中移除。',
      });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : '作品展示设置失败。',
      }, { status: 400 });
    }
  }

  if (body.action === 'refresh_showcase_titles') {
    try {
      const result = await refreshTheatreShowcaseShortTitles(Number(body.limit) || 60);
      return NextResponse.json({
        ok: true,
        action: 'refresh_showcase_titles',
        result,
        message: `已更新 ${result.updated.length} 个优秀作品名称。`,
      });
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : '优秀作品名称更新失败。',
      }, { status: 400 });
    }
  }

  if (body.action === 'delete_student') {
    const studentId = String(body.studentId || '').trim();
    if (!studentId) return NextResponse.json({ ok: false, error: 'studentId required' }, { status: 400 });

    const student = await prisma.theatreStudent.findUnique({
      where: { id: studentId },
      include: { sessions: true, voiceprint: true },
    });
    if (!student) return NextResponse.json({ ok: false, error: 'student not found' }, { status: 404 });

    await prisma.theatreStudent.delete({ where: { id: studentId } });

    return NextResponse.json({
      ok: true,
      action: 'delete_student',
      deletedStudent: student.nickname,
      deletedStudentId: student.id,
      deletedSessions: student.sessions.length,
      deletedVoiceprints: student.voiceprint ? 1 : 0,
      updatedAt: new Date().toISOString(),
    });
  }

  if (body.action === 'clear_students') {
    const [deletedSessions, deletedVoiceprints, deletedStudents] = await prisma.$transaction([
      prisma.theatreSession.deleteMany(),
      prisma.theatreVoiceprint.deleteMany(),
      prisma.theatreStudent.deleteMany(),
    ]);

    return NextResponse.json({
      ok: true,
      action: 'clear_students',
      deletedStudents: deletedStudents.count,
      deletedVoiceprints: deletedVoiceprints.count,
      deletedSessions: deletedSessions.count,
      updatedAt: new Date().toISOString(),
    });
  }

  if (body.action !== 'clear_voiceprints') {
    return NextResponse.json({ ok: false, error: 'unsupported action' }, { status: 400 });
  }

  const [deleted] = await prisma.$transaction([
    prisma.theatreVoiceprint.deleteMany(),
    prisma.$executeRaw`
      UPDATE "theatre_students"
      SET "profile" = "profile" - 'voiceprintEnrolled' - 'voiceprintSampleCount' - 'voiceprintUpdatedAt'
    `,
  ]);

  return NextResponse.json({
    ok: true,
    action: 'clear_voiceprints',
    deletedVoiceprints: deleted.count,
    updatedAt: new Date().toISOString(),
  });
}
