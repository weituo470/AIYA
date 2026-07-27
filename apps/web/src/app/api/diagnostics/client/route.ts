import { NextRequest, NextResponse } from 'next/server';
import { createDiagnosticId, summarizeText, writeDiagnosticEvent } from '../../../../lib/diagnostics';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const diagnosticId = createDiagnosticId('client');
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  await writeDiagnosticEvent({
    id: diagnosticId,
    scope: 'client-report',
    status: 'failed',
    severity: 'error',
    route: typeof body.route === 'string' ? body.route : '/client',
    message: summarizeText(body.message || 'client reported failure', 800),
    data: {
      jobId: typeof body.jobId === 'string' ? body.jobId : '',
      prompt: summarizeText(body.prompt, 800),
      stage: typeof body.stage === 'string' ? body.stage : '',
      userAgent: request.headers.get('user-agent') || '',
      detail: body.detail || null,
    },
  }).catch(() => undefined);

  return NextResponse.json({ ok: true, diagnosticId });
}
