import type { Metadata } from 'next';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import InvestorMemoClient, { type ApkManifest } from './InvestorMemoClient';

export const metadata: Metadata = {
  title: 'AIYA｜AI 编程教育项目',
  description: 'AIYA 把 AI 编程从专业技能变成普通人的创造入口。查看产品、商业验证计划并下载最新 V3 Android APK。',
};

async function readV3Manifest(): Promise<ApkManifest> {
  try {
    const raw = await readFile(join(process.cwd(), 'public', 'downloads', 'aiya-v3-latest.json'), 'utf8');
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as ApkManifest;
  } catch {
    return {
      versionCode: 66,
      versionName: '0.6.60',
      apkPath: '/downloads/aiya-v3-debug.apk',
      filename: 'aiya-v3-0.6.60.apk',
      apkBytes: 77187441,
    };
  }
}

export default async function AiyaInvestorMemoPage() {
  return <InvestorMemoClient apk={await readV3Manifest()} />;
}
