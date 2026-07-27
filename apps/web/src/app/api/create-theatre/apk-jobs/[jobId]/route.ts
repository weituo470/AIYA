import { readFile } from 'node:fs/promises';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

const isSafeJobId = (value: string) => /^apk_\d{10,}_[a-z0-9-]{6,16}$/i.test(value);

export async function GET(_request: NextRequest, context: RouteContext) {
  const { jobId } = await context.params;
  if (!isSafeJobId(jobId)) {
    return NextResponse.json({ ok: false, error: 'invalid job id' }, { status: 400 });
  }
  try {
    const { join, resolve } = await import('node:path');
    const repoRoot = resolve(process.cwd(), '../..');
    const metaPath = join(repoRoot, '.state', 'apk-jobs', jobId, 'job.json');
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    return NextResponse.json({ ok: true, job: meta });
  } catch {
    return NextResponse.json({ ok: false, error: 'APK 构建任务不存在或已过期。' }, { status: 404 });
  }
}
