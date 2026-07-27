import { NextRequest, NextResponse } from 'next/server';
import { readDiagnosticEvents } from '../../../../lib/diagnostics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const readAdminToken = () =>
  process.env.AIYA_DIAGNOSTICS_TOKEN?.trim() ||
  process.env.AIYA_ADMIN_TOKEN?.trim() ||
  '';

const isAuthorized = (request: NextRequest) => {
  const token = readAdminToken();
  if (!token) return process.env.NODE_ENV !== 'production';
  return request.headers.get('x-aiya-admin-token') === token || request.nextUrl.searchParams.get('token') === token;
};

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: readAdminToken()
          ? 'Unauthorized diagnostics access.'
          : 'Diagnostics token is not configured in production.',
      },
      { status: 401 },
    );
  }

  const search = request.nextUrl.searchParams;
  const events = await readDiagnosticEvents({
    id: search.get('id') || undefined,
    scope: search.get('scope') || undefined,
    status: (search.get('status') || undefined) as never,
    severity: (search.get('severity') || undefined) as never,
    limit: Number.parseInt(search.get('limit') || '100', 10),
  });

  return NextResponse.json({
    ok: true,
    count: events.length,
    items: events,
  });
}
