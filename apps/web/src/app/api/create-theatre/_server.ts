import { prisma } from '@aiya/database';

type JsonObject = Record<string, unknown>;

export const normalizeTheatreNickname = (value: unknown) => String(value || '')
  .trim()
  .replace(/^叫我\s*/u, '')
  .replace(/^我是\s*/u, '')
  .replace(/[，。！？、,.!?\s]+$/u, '')
  .slice(0, 24);

export const theatreStudentKey = (value: unknown) => normalizeTheatreNickname(value).toLocaleLowerCase();

export const safeJsonObject = (value: unknown): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
};

export const safeJsonArray = (value: unknown): unknown[] => Array.isArray(value) ? value.slice(-80) : [];

export const sanitizeEmbedding = (value: unknown) => {
  if (!Array.isArray(value)) return null;
  const numbers = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .slice(0, 256);
  return numbers.length >= 8 ? numbers : null;
};

export const compareEmbedding = (left: number[], right: unknown) => {
  const rightValues = sanitizeEmbedding(right);
  if (!rightValues) return 0;
  const size = Math.min(left.length, rightValues.length);
  if (!size) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < size; index += 1) {
    const a = left[index] || 0;
    const b = rightValues[index] || 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
};

export const voiceprintThreshold = 0.88;

export const serializeStudent = (student: any) => ({
  id: student.id,
  nickname: student.nickname,
  normalizedNickname: student.normalizedNickname,
  profile: student.profile || {},
  lastSeenAt: student.lastSeenAt?.toISOString?.() || student.lastSeenAt,
  createdAt: student.createdAt?.toISOString?.() || student.createdAt,
  updatedAt: student.updatedAt?.toISOString?.() || student.updatedAt,
  voiceprint: student.voiceprint ? {
    model: student.voiceprint.model,
    sampleCount: student.voiceprint.sampleCount,
    updatedAt: student.voiceprint.updatedAt?.toISOString?.() || student.voiceprint.updatedAt,
    embeddingLength: Array.isArray(student.voiceprint.embedding) ? student.voiceprint.embedding.length : 0,
  } : null,
});

export const serializeMemory = (student: any, session?: any) => ({
  profile: student?.profile || {},
  chatMessages: safeJsonArray(session?.chatMessages),
  currentApp: session?.currentApp || null,
  updatedAt: session?.updatedAt?.toISOString?.() || student?.updatedAt?.toISOString?.() || new Date().toISOString(),
});

export async function upsertTheatreStudentMemory(input: {
  profile: JsonObject;
  chatMessages?: unknown;
  currentApp?: unknown;
  deviceId?: unknown;
  voiceprint?: unknown;
}) {
  const nickname = normalizeTheatreNickname(input.profile.nickname);
  const normalizedNickname = theatreStudentKey(nickname);
  if (!nickname || !normalizedNickname) {
    const error = new Error('nickname required');
    (error as Error & { status?: number }).status = 400;
    throw error;
  }

  const profile = { ...input.profile, nickname };
  const now = new Date();
  const student = await prisma.theatreStudent.upsert({
    where: { normalizedNickname },
    create: { nickname, normalizedNickname, profile, lastSeenAt: now },
    update: { nickname, profile, lastSeenAt: now },
  });

  const voiceprint = safeJsonObject(input.voiceprint);
  const embedding = sanitizeEmbedding(voiceprint.embedding);
  if (embedding) {
    await prisma.theatreVoiceprint.upsert({
      where: { studentId: student.id },
      create: {
        studentId: student.id,
        embedding,
        sampleCount: Math.max(1, Number(voiceprint.sampleCount) || 1),
        model: String(voiceprint.model || 'aiya-browser-pcm-v1'),
      },
      update: {
        embedding,
        sampleCount: Math.max(1, Number(voiceprint.sampleCount) || 1),
        model: String(voiceprint.model || 'aiya-browser-pcm-v1'),
      },
    });
  }

  const deviceId = String(input.deviceId || 'browser-default').slice(0, 96);
  const chatMessages = safeJsonArray(input.chatMessages) as any;
  const currentApp = input.currentApp == null ? undefined : (input.currentApp as any);
  const session = await prisma.theatreSession.upsert({
    where: { studentId_deviceId: { studentId: student.id, deviceId } },
    create: {
      studentId: student.id,
      deviceId,
      chatMessages,
      currentApp,
      lastSeenAt: now,
      metadata: {},
    },
    update: {
      chatMessages,
      currentApp,
      lastSeenAt: now,
    },
  });

  const saved = await prisma.theatreStudent.findUnique({
    where: { id: student.id },
    include: { voiceprint: true },
  });

  return { student: saved || student, session };
}
