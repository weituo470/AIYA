import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

const isSafeJobId = (value: string) => /^apk_\d{10,}_[a-z0-9-]{6,16}$/i.test(value);

const safeFilename = (value: unknown) => String(value || 'aiya-work')
  .trim()
  .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
  .replace(/\s+/g, '-')
  .slice(0, 80) || 'aiya-work';

export async function GET(_request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;
  if (!isSafeJobId(jobId)) {
    return NextResponse.json({ ok: false, error: 'invalid job id' }, { status: 400 });
  }
  try {
    const { join, resolve } = await import('node:path');
    const repoRoot = resolve(process.cwd(), '../..');
    const dir = join(repoRoot, '.state', 'apk-jobs', jobId);
    const meta = JSON.parse(await readFile(join(dir, 'job.json'), 'utf8'));
    if (meta.status !== 'succeeded') {
      return NextResponse.json({ ok: false, error: 'APK 还没有构建完成。' }, { status: 409 });
    }
    const apk = await readFile(join(dir, 'app-debug.apk'));
    const filename = `${safeFilename(meta.title)}-${jobId}.apk`;
    return new NextResponse(apk, {
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': String(apk.byteLength),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'APK 文件不存在或已过期。' }, { status: 404 });
  }
}
