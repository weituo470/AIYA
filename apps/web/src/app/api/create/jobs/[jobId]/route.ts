import { NextRequest, NextResponse } from 'next/server';
import {
  createDiagnosticId,
  errorToDiagnostic,
  writeDiagnosticEvent,
} from '../../../../../lib/diagnostics';

const runnerBaseUrl = () => (process.env.AIYA_CREATE_RUNNER_BASE_URL || 'http://127.0.0.1:3334').replace(/\/+$/, '');

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;
  const diagnosticId = createDiagnosticId('create_job_get');
  const startedAt = Date.now();
  try {
    const response = await fetch(`${runnerBaseUrl()}/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      await writeDiagnosticEvent({
        id: diagnosticId,
        scope: 'create-runner-proxy',
        status: 'failed',
        severity: response.status === 404 ? 'warn' : 'error',
        route: '/api/create/jobs/[jobId]',
        jobId,
        message: `create-runner GET /jobs/${jobId} returned HTTP ${response.status}`,
        durationMs: Date.now() - startedAt,
        data: { runnerStatus: response.status, runnerPayload: payload },
      }).catch(() => undefined);
    }
    return NextResponse.json(payload || { error: 'create-runner returned an empty response' }, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'create-runner unavailable';
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'create-runner-proxy',
      status: 'failed',
      severity: 'error',
      route: '/api/create/jobs/[jobId]',
      jobId,
      message: `AIYA Create Runner unavailable: ${message}`,
      durationMs: Date.now() - startedAt,
      data: { error: errorToDiagnostic(error) },
    }).catch(() => undefined);
    return NextResponse.json({ error: `AIYA Create Runner unavailable: ${message}`, diagnosticId }, { status: 503 });
  }
}
