import { NextResponse } from 'next/server';

const runnerBaseUrl = () => (process.env.AIYA_CREATE_RUNNER_BASE_URL || 'http://127.0.0.1:3334').replace(/\/+$/, '');

export async function GET() {
  try {
    const response = await fetch(`${runnerBaseUrl()}/health`, { cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    return NextResponse.json(payload || { error: 'create-runner returned an empty response' }, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'create-runner unavailable';
    return NextResponse.json({ error: `AIYA Create Runner unavailable: ${message}` }, { status: 503 });
  }
}
