import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ApkUpdateManifest = {
  schemaVersion?: number;
  appId?: string;
  channel?: string;
  versionCode?: number;
  versionName?: string;
  apkUrl?: string;
  apkPath?: string;
  filename?: string;
  apkSha256?: string;
  apkBytes?: number;
  required?: boolean;
  autoDownload?: boolean;
  installPrompt?: boolean;
  minSupportedVersionCode?: number;
  message?: string;
  releaseNotes?: string[];
  publishedAt?: string;
};

const manifestFilenameForApp = (appId: string) => {
  if (appId === 'cc.shenliu.aiya.v3') return 'aiya-v3-latest.json';
  return 'aiya-v2-latest.json';
};

const jsonResponse = (data: unknown, init?: { status?: number }) => new NextResponse(JSON.stringify(data), {
  status: init?.status || 200,
  headers: {
    'Cache-Control': 'no-store, max-age=0',
    'Content-Type': 'application/json; charset=utf-8',
  },
});

const parseVersionCode = (value: string | null) => {
  const parsed = Number.parseInt(String(value || '0'), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export async function GET(request: NextRequest) {
  try {
    const currentVersionCode = parseVersionCode(request.nextUrl.searchParams.get('currentVersionCode'));
    const currentAppId = request.nextUrl.searchParams.get('appId') || 'cc.shenliu.aiya.v2';
    const raw = await readFile(join(process.cwd(), 'public', 'downloads', manifestFilenameForApp(currentAppId)), 'utf8');
    const manifest = JSON.parse(raw.replace(/^﻿/, '')) as ApkUpdateManifest;
    const latestVersionCode = Number(manifest.versionCode || 0);
    const sameApp = !manifest.appId || manifest.appId === currentAppId;
    const available = sameApp && latestVersionCode > currentVersionCode;

    return jsonResponse({
      ok: true,
      current: {
        appId: currentAppId,
        versionCode: currentVersionCode,
      },
      update: {
        available,
        required: Boolean(manifest.required || (manifest.minSupportedVersionCode && currentVersionCode > 0 && currentVersionCode < manifest.minSupportedVersionCode)),
      },
      manifest,
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error instanceof Error ? error.message : 'APK 更新清单不可用',
    }, { status: 500 });
  }
}
