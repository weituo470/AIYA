import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = process.argv[2] || 'src';
const output = process.argv[3] || 'dist';
const checker = resolve(import.meta.dirname, 'check-js-syntax.mjs');
const check = spawnSync(process.execPath, [checker, source], { stdio: 'inherit' });
if (check.status !== 0) process.exit(check.status || 1);

const outputPath = resolve(process.cwd(), output);
rmSync(outputPath, { recursive: true, force: true });
mkdirSync(outputPath, { recursive: true });
cpSync(resolve(process.cwd(), source), outputPath, { recursive: true });
writeFileSync(resolve(outputPath, '.build.json'), `${JSON.stringify({ builtAt: new Date().toISOString(), source })}\n`);
console.log(`Built ${source} into ${output}.`);
