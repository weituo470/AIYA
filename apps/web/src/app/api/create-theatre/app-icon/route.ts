import { NextRequest, NextResponse } from 'next/server';
import { designAppIconWithHermes } from '../_hermes-app-icon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (value: unknown, max: number) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const title = clean(body.title, 80) || 'AIYA 作品';
    const brief = clean(body.brief, 1000);
    const html = typeof body.html === 'string' ? body.html.slice(0, 120_000) : '';
    const icon = await designAppIconWithHermes({ title, brief, html });
    return NextResponse.json({ ok: true, icon });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : '生成应用图标失败',
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Hermes APP 图标设计服务已就绪，生成结果会固定带有 AIYA 品牌标识。',
  });
}
