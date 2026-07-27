import { NextResponse } from 'next/server';
import { listTheatreShowcaseWorks } from '../_showcase';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const works = await listTheatreShowcaseWorks();
    return NextResponse.json({
      ok: true,
      works,
      generatedAt: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30' },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : '优秀作品加载失败。',
    }, { status: 500 });
  }
}
