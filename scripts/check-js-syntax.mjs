import { readdirSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('Usage: node scripts/check-js-syntax.mjs <file-or-directory> [...]');
  process.exit(2);
}

const ignored = new Set(['node_modules', '.next', '.turbo', 'dist', 'build']);
const files = [];
const visit = (entry) => {
  const absolute = resolve(process.cwd(), entry);
  const stat = statSync(absolute);
  if (stat.isFile()) {
    if (['.js', '.mjs', '.cjs'].includes(extname(absolute))) files.push(absolute);
    return;
  }
  for (const child of readdirSync(absolute, { withFileTypes: true })) {
    if (ignored.has(child.name)) continue;
    visit(resolve(absolute, child.name));
  }
};

roots.forEach(visit);
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

console.log(`Checked JavaScript syntax in ${files.length} files.`);
if (failed) process.exit(1);
