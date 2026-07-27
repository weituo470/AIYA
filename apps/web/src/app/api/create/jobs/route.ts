import { NextRequest, NextResponse } from 'next/server';
import {
  createDiagnosticId,
  errorToDiagnostic,
  summarizeText,
  writeDiagnosticEvent,
} from '../../../../lib/diagnostics';

const runnerBaseUrl = () => (process.env.AIYA_CREATE_RUNNER_BASE_URL || 'http://127.0.0.1:3334').replace(/\/+$/, '');

export async function POST(request: NextRequest) {
  const diagnosticId = createDiagnosticId('create_job');
  const startedAt = Date.now();
  let body: Record<string, unknown> = {};
  try {
    const raw = await request.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(raw);
    body = text ? JSON.parse(text) : {};
    const response = await fetch(`${runnerBaseUrl()}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      await writeDiagnosticEvent({
        id: diagnosticId,
        scope: 'create-runner-proxy',
        status: 'failed',
        severity: 'error',
        route: '/api/create/jobs',
        message: `create-runner POST /jobs returned HTTP ${response.status}`,
        durationMs: Date.now() - startedAt,
        data: {
          prompt: summarizeText(body.prompt),
          revision: summarizeText(body.revision),
          mode: body.mode,
          runnerStatus: response.status,
          runnerPayload: payload,
        },
      }).catch(() => undefined);
    }
    return NextResponse.json(payload || { error: 'create-runner returned an empty response', diagnosticId }, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'create-runner unavailable';
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'create-runner-proxy',
      status: 'failed',
      severity: 'error',
      route: '/api/create/jobs',
      message: `AIYA Create Runner unavailable: ${message}`,
      durationMs: Date.now() - startedAt,
      data: {
        prompt: summarizeText(body.prompt),
        revision: summarizeText(body.revision),
        error: errorToDiagnostic(error),
      },
    }).catch(() => undefined);
    return NextResponse.json({ error: `AIYA Create Runner unavailable: ${message}`, diagnosticId }, { status: 503 });
  }
}

export async function GET() {
  const diagnosticId = createDiagnosticId('create_jobs_list');
  const startedAt = Date.now();
  try {
    const response = await fetch(`${runnerBaseUrl()}/jobs`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      await writeDiagnosticEvent({
        id: diagnosticId,
        scope: 'create-runner-proxy',
        status: 'failed',
        severity: 'warn',
        route: '/api/create/jobs',
        message: `create-runner GET /jobs returned HTTP ${response.status}`,
        durationMs: Date.now() - startedAt,
        data: { runnerStatus: response.status, runnerPayload: payload },
      }).catch(() => undefined);
    }
    return NextResponse.json(payload || { items: [] }, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'create-runner unavailable';
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'create-runner-proxy',
      status: 'failed',
      severity: 'error',
      route: '/api/create/jobs',
      message: `AIYA Create Runner unavailable: ${message}`,
      durationMs: Date.now() - startedAt,
      data: { error: errorToDiagnostic(error) },
    }).catch(() => undefined);
    return NextResponse.json({ error: `AIYA Create Runner unavailable: ${message}`, diagnosticId }, { status: 503 });
  }
}
