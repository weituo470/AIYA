import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createDiagnosticId, errorToDiagnostic, summarizeText, writeDiagnosticEvent } from '../../../../lib/diagnostics';
import { designAppIconWithHermes } from '../_hermes-app-icon';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repoRoot = resolve(process.cwd(), '../..');
const jobsRoot = resolve(repoRoot, '.state', 'apk-jobs');
const builderScript = resolve(repoRoot, 'apps', 'apk-builder', 'src', 'build-generated-apk.mjs');

const sanitizeTitle = (value: unknown) => {
  const title = String(value || '').trim().replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').slice(0, 48);
  return title || 'AIYA 作品';
};

const slugify = (value: string) => {
  const slug = value.normalize('NFKD').replace(/[^\p{Letter}\p{Number}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'aiya-work';
};

const normalizePackageSuffix = (value: string) => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]+/g, '').slice(0, 24);
  return /^[a-z_]/.test(normalized) ? normalized : `a${normalized || 'work'}`;
};

const buildJobId = () => `apk_${Date.now()}_${randomUUID().slice(0, 8)}`;

const sha256Text = (value: string) => createHash('sha256').update(value).digest('hex');

const safeInside = (root: string, target: string) => {
  const absolute = resolve(target);
  if (!absolute.toLowerCase().startsWith(resolve(root).toLowerCase())) {
    throw new Error(`Unsafe path outside ${root}: ${absolute}`);
  }
  return absolute;
};

const jobDir = (jobId: string) => safeInside(jobsRoot, join(jobsRoot, jobId));
const jobMetaPath = (jobId: string) => join(jobDir(jobId), 'job.json');

const readJobMeta = async (jobId: string) => JSON.parse(await readFile(jobMetaPath(jobId), 'utf8')) as Record<string, unknown>;

const writeJobMeta = async (jobId: string, data: Record<string, unknown>) => {
  await mkdir(jobDir(jobId), { recursive: true });
  await writeFile(jobMetaPath(jobId), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};

const runBuilder = async (configPath: string, cwd: string) => new Promise<{ stdout: string; stderr: string }>((resolvePromise, reject) => {
  const child = spawn(process.execPath, [builderScript, '--config', configPath], {
    cwd,
    env: process.env,
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolvePromise({ stdout, stderr });
    else reject(new Error(`apk-builder exited ${code}: ${stderr || stdout}`));
  });
});

export async function POST(request: NextRequest) {
  const diagnosticId = createDiagnosticId('apk_job');
  const startedAt = Date.now();
  const jobId = buildJobId();
  let title = 'AIYA 作品';
  try {
    const body = await request.json().catch(() => ({}));
    const html = typeof body.html === 'string' ? body.html : '';
    title = sanitizeTitle(body.title);
    const brief = String(body.brief || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (!html || html.length < 40) {
      return NextResponse.json({ ok: false, error: '当前作品 HTML 为空，先让老师生成作品后再下载 APK。', diagnosticId }, { status: 400 });
    }
    if (html.length > 800_000) {
      return NextResponse.json({ ok: false, error: '当前作品太大，暂时不能导出 APK。', diagnosticId }, { status: 413 });
    }

    const dir = jobDir(jobId);
    await mkdir(dir, { recursive: true });
    const outPath = join(dir, 'app-debug.apk');
    const workdir = join(dir, 'work');
    const packageSuffix = normalizePackageSuffix(`${slugify(title)}${sha256Text(html).slice(0, 6)}`);
    const applicationId = `cc.shenliu.aiya.generated.${packageSuffix}`;
    const icon = await designAppIconWithHermes({ title, brief, html });
    const iconVectorPath = join(dir, 'aiya-hermes-icon.xml');
    await writeFile(iconVectorPath, icon.vectorXml, 'utf8');
    const config = {
      html,
      title,
      applicationId,
      out: outPath,
      workdir,
      iconVectorPath,
    };
    const configPath = join(dir, 'config.json');
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await writeJobMeta(jobId, {
      id: jobId,
      status: 'running',
      title,
      applicationId,
      htmlSha256: sha256Text(html),
      icon: {
        source: icon.source,
        model: icon.model,
        modelMode: icon.modelMode,
        durationMs: icon.durationMs,
        design: icon.design,
        brand: icon.brand,
        failover: icon.failover,
        ...(icon.error ? { fallbackReason: icon.error } : {}),
      },
      createdAt: new Date(startedAt).toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = await runBuilder(configPath, repoRoot);
    const apkStat = await stat(outPath);
    const meta = {
      id: jobId,
      status: 'succeeded',
      title,
      applicationId,
      apkBytes: apkStat.size,
      downloadUrl: `/api/create-theatre/apk-jobs/${encodeURIComponent(jobId)}/download`,
      htmlSha256: sha256Text(html),
      icon: {
        source: icon.source,
        model: icon.model,
        modelMode: icon.modelMode,
        durationMs: icon.durationMs,
        design: icon.design,
        brand: icon.brand,
        failover: icon.failover,
        ...(icon.error ? { fallbackReason: icon.error } : {}),
      },
      createdAt: new Date(startedAt).toISOString(),
      updatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      builder: {
        stdoutTail: summarizeText(result.stdout, 2000),
        stderrTail: summarizeText(result.stderr, 2000),
      },
    };
    await writeJobMeta(jobId, meta);
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'create-theatre-apk',
      status: 'succeeded',
      severity: 'info',
      route: '/api/create-theatre/apk-jobs',
      jobId,
      message: `APK built for ${title}`,
      durationMs: Date.now() - startedAt,
      data: {
        title,
        applicationId,
        apkBytes: apkStat.size,
        iconSource: icon.source,
        iconModel: icon.model,
        iconSymbol: icon.design.symbol,
        iconPalette: icon.design.palette,
        iconBrand: icon.brand,
      },
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, job: meta });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'APK 构建失败';
    const failedMeta = {
      id: jobId,
      status: 'failed',
      title,
      error: message,
      updatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    };
    await writeJobMeta(jobId, failedMeta).catch(() => undefined);
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'create-theatre-apk',
      status: 'failed',
      severity: 'error',
      route: '/api/create-theatre/apk-jobs',
      jobId,
      message: `APK build failed: ${message}`,
      durationMs: Date.now() - startedAt,
      data: { title, error: errorToDiagnostic(error) },
    }).catch(() => undefined);
    return NextResponse.json({ ok: false, error: message, diagnosticId, job: failedMeta }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, message: 'create-theatre APK builder is ready when Android SDK and Gradle are installed.' });
}
