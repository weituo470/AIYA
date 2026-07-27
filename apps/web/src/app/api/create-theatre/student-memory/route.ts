import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@aiya/database';
import {
  serializeMemory,
  serializeStudent,
  theatreStudentKey,
  upsertTheatreStudentMemory,
} from '../_server';

export async function GET(request: NextRequest) {
  const nickname = request.nextUrl.searchParams.get('nickname') || '';
  const deviceId = String(request.nextUrl.searchParams.get('deviceId') || '').trim().slice(0, 96);

  if (deviceId) {
    const session = await prisma.theatreSession.findFirst({
      where: { deviceId },
      orderBy: { updatedAt: 'desc' },
      include: {
        student: {
          include: { voiceprint: true },
        },
      },
    });
    if (!session?.student) return NextResponse.json({ ok: true, student: null, memory: null });

    return NextResponse.json({
      ok: true,
      student: serializeStudent(session.student),
      memory: serializeMemory(session.student, session),
      loginMethod: 'android-device',
    });
  }

  const normalizedNickname = theatreStudentKey(nickname);
  if (!normalizedNickname) return NextResponse.json({ ok: false, error: 'nickname required' }, { status: 400 });

  const student = await prisma.theatreStudent.findUnique({
    where: { normalizedNickname },
    include: {
      voiceprint: true,
      sessions: { orderBy: { updatedAt: 'desc' }, take: 1 },
    },
  });
  if (!student) return NextResponse.json({ ok: true, student: null, memory: null });

  return NextResponse.json({
    ok: true,
    student: serializeStudent(student),
    memory: serializeMemory(student, student.sessions[0]),
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { student, session } = await upsertTheatreStudentMemory({
      profile: body.profile || {},
      chatMessages: body.chatMessages,
      currentApp: body.currentApp,
      deviceId: body.deviceId,
      voiceprint: body.voiceprint,
    });
    return NextResponse.json({
      ok: true,
      student: serializeStudent(student),
      memory: serializeMemory(student, session),
    });
  } catch (error) {
    const status = (error as Error & { status?: number }).status || 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'save failed' }, { status });
  }
}
