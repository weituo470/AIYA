import { NextRequest, NextResponse } from 'next/server';
import { createDiagnosticId, readDiagnosticEvents, summarizeText, writeDiagnosticEvent } from '../../../../lib/diagnostics';

export const runtime = 'nodejs';

const normalizeInteractionId = (value: unknown) => {
  const text = String(value || '').trim();
  return /^cti_\d{10,}_[a-z0-9]{6,16}$/i.test(text) ? text : createDiagnosticId('cti');
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const interactionId = normalizeInteractionId(body.interactionId);
  const phase = typeof body.phase === 'string' ? body.phase : 'unknown';
  const appRuntime = phase === 'app-runtime' || phase.startsWith('app-runtime:');

  await writeDiagnosticEvent({
    id: interactionId,
    scope: appRuntime ? 'create-theatre-app-runtime' : 'create-theatre-interaction',
    status: 'succeeded',
    severity: 'info',
    route: appRuntime ? '/create-theatre-v3/apk-webview' : '/create-theatre',
    message: summarizeText(body.message || `create-theatre interaction: ${phase}`, 1000),
    jobId: typeof body.jobId === 'string' ? body.jobId : undefined,
    data: {
      phase,
      studentNickname: summarizeText(body.studentNickname, 80),
      userText: summarizeText(body.userText, 1500),
      teacherReply: summarizeText(body.teacherReply, 1500),
      prompt: summarizeText(body.prompt, 1500),
      currentAppTitle: summarizeText(body.currentAppTitle, 160),
      decision: body.decision || null,
      routeState: body.routeState || null,
      detail: body.detail || null,
      userAgent: request.headers.get('user-agent') || '',
    },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, interactionId });
}

export async function GET(request: NextRequest) {
  const interactionId = normalizeInteractionId(
    request.nextUrl.searchParams.get('interactionId') || request.nextUrl.searchParams.get('id'),
  );
  const rawLimit = Number.parseInt(request.nextUrl.searchParams.get('limit') || '80', 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 80;
  const events = await readDiagnosticEvents({
    id: interactionId,
    limit,
  });
  return NextResponse.json({
    ok: true,
    interactionId,
    events: events.filter((event) =>
      event.scope === 'create-theatre-app-runtime' || event.scope === 'create-theatre-interaction',
    ),
  });
}
