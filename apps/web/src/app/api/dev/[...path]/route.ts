import { NextRequest, NextResponse } from 'next/server';

const runnerBaseUrl = () => (process.env.AIYA_DEV_RUNNER_BASE_URL || 'http://127.0.0.1:3335').replace(/\/+$/, '');

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

async function proxy(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  const target = `${runnerBaseUrl()}/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search || ''}`;
  try {
    const init: RequestInit = {
      method: request.method,
      headers: { 'Content-Type': request.headers.get('content-type') || 'application/json' },
      cache: 'no-store',
    };
    if (!['GET', 'HEAD'].includes(request.method)) init.body = await request.text();
    const response = await fetch(target, init);
    if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
      return new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      return new Response(await response.text(), { status: response.status, headers: { 'Content-Type': contentType } });
    }
    const payload = await response.json().catch(async () => ({ text: await response.text().catch(() => '') }));
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'dev-runner unavailable';
    return NextResponse.json({ error: `AIYA Dev Runner unavailable: ${message}` }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
