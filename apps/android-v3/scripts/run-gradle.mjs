import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const isWindows = platform() === 'win32';

const findOnPath = () => {
  const command = isWindows ? 'where.exe' : 'which';
  const result = spawnSync(command, ['gradle'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (result.status !== 0) return '';
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
};

const parseGradleVersion = (name) => {
  const match = /^gradle-(\d+(?:\.\d+){0,2})/.exec(name);
  if (!match) return [];
  return match[1].split('.').map((part) => Number.parseInt(part, 10));
};

const compareVersions = (a, b) => {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff) return diff;
  }
  return 0;
};

const findInWrapperCache = () => {
  const dists = join(homedir(), '.gradle', 'wrapper', 'dists');
  if (!existsSync(dists)) return '';
  const candidates = [];
  for (const dist of readdirSync(dists, { withFileTypes: true })) {
    if (!dist.isDirectory() || !dist.name.startsWith('gradle-')) continue;
    const distDir = join(dists, dist.name);
    for (const hashDir of readdirSync(distDir, { withFileTypes: true })) {
      if (!hashDir.isDirectory()) continue;
      const hashPath = join(distDir, hashDir.name);
      for (const versionDir of readdirSync(hashPath, { withFileTypes: true })) {
        if (!versionDir.isDirectory() || !versionDir.name.startsWith('gradle-')) continue;
        const executable = join(hashPath, versionDir.name, 'bin', isWindows ? 'gradle.bat' : 'gradle');
        if (existsSync(executable)) candidates.push({ executable, version: parseGradleVersion(versionDir.name) });
      }
    }
  }
  candidates.sort((a, b) => compareVersions(b.version, a.version));
  return candidates[0]?.executable || '';
};

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const wrapperExecutable = join(projectDir, isWindows ? 'gradlew.bat' : 'gradlew');
const gradleExecutable = process.env.GRADLE
  || (existsSync(wrapperExecutable) ? wrapperExecutable : '')
  || findOnPath()
  || findInWrapperCache();
if (!gradleExecutable) {
  console.error('Cannot find Gradle. Restore the Gradle wrapper or install Gradle first.');
  process.exit(1);
}

if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT && isWindows) {
  process.env.ANDROID_HOME = join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'Android', 'Sdk');
  process.env.ANDROID_SDK_ROOT = process.env.ANDROID_HOME;
}

const args = process.argv.slice(2);
const gradleArgs = args.length ? args : [':app:assembleDebug'];
const result = spawnSync(isWindows ? 'cmd.exe' : gradleExecutable, isWindows ? ['/d', '/s', '/c', gradleExecutable, ...gradleArgs] : gradleArgs, {
  cwd: projectDir,
  stdio: 'inherit',
  shell: false,
  env: process.env,
});
if (result.error) {
  console.error(result.error.message);
}
process.exit(result.status ?? 1);
