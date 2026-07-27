import { NextRequest, NextResponse } from 'next/server';
import {
  createDiagnosticId,
  errorToDiagnostic,
  writeDiagnosticEvent,
} from '../../../../../../lib/diagnostics';

const runnerBaseUrl = () => (process.env.AIYA_CREATE_RUNNER_BASE_URL || 'http://127.0.0.1:3334').replace(/\/+$/, '');

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;
  const diagnosticId = createDiagnosticId('create_job_events');
  const startedAt = Date.now();
  try {
    const response = await fetch(`${runnerBaseUrl()}/jobs/${encodeURIComponent(jobId)}/events`, { cache: 'no-store' });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({ error: 'create-runner event stream failed' }));
      await writeDiagnosticEvent({
        id: diagnosticId,
        scope: 'create-runner-proxy',
        status: 'failed',
        severity: response.status === 404 ? 'warn' : 'error',
        route: '/api/create/jobs/[jobId]/events',
        jobId,
        message: `create-runner event stream failed with HTTP ${response.status}`,
        durationMs: Date.now() - startedAt,
        data: { runnerStatus: response.status, runnerPayload: payload },
      }).catch(() => undefined);
      return NextResponse.json({ ...payload, diagnosticId }, { status: response.status });
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'create-runner unavailable';
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'create-runner-proxy',
      status: 'failed',
      severity: 'error',
      route: '/api/create/jobs/[jobId]/events',
      jobId,
      message: `AIYA Create Runner unavailable: ${message}`,
      durationMs: Date.now() - startedAt,
      data: { error: errorToDiagnostic(error) },
    }).catch(() => undefined);
    return NextResponse.json({ error: `AIYA Create Runner unavailable: ${message}`, diagnosticId }, { status: 503 });
  }
}
