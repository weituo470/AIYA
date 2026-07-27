import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@aiya/database';
import {
  compareEmbedding,
  safeJsonArray,
  sanitizeEmbedding,
  serializeMemory,
  serializeStudent,
  voiceprintThreshold,
} from '../../_server';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const embedding = sanitizeEmbedding(body.embedding);
  if (!embedding) return NextResponse.json({ ok: false, error: 'valid embedding required' }, { status: 400 });

  const profiles = await prisma.theatreVoiceprint.findMany({
    include: {
      student: {
        include: { sessions: { orderBy: { updatedAt: 'desc' }, take: 1 }, voiceprint: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });

  let best: { score: number; item?: typeof profiles[number] } = { score: 0 };
  for (const item of profiles) {
    const score = compareEmbedding(embedding, item.embedding);
    if (score > best.score) best = { score, item };
  }

  if (!best.item || best.score < voiceprintThreshold) {
    return NextResponse.json({ ok: true, matched: false, score: best.score, threshold: voiceprintThreshold });
  }

  await prisma.theatreVoiceprint.update({
    where: { id: best.item.id },
    data: { lastScore: best.score },
  }).catch(() => null);

  const session = best.item.student.sessions[0];
  return NextResponse.json({
    ok: true,
    matched: true,
    score: best.score,
    threshold: voiceprintThreshold,
    student: serializeStudent(best.item.student),
    memory: {
      ...serializeMemory(best.item.student, session),
      chatMessages: safeJsonArray(session?.chatMessages),
    },
  });
}
