import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { createInlinePreview, prepareBuildModeWorkspace, restoreRunnerOwnedFiles, validateProject } from './build-mode.js';

const job = {
  id: `smoke_${Date.now()}`,
  prompt: '创建一个简单计数器应用。',
  revision: '',
  currentApp: null,
};
const workspaceDir = path.join(config.workDir, job.id);
await fs.rm(workspaceDir, { recursive: true, force: true });
const prepared = await prepareBuildModeWorkspace({ job, workspaceDir, repoRoot: config.repoRoot });
await fs.writeFile(path.join(prepared.appDir, 'src', 'App.tsx'), `import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui' }}>
      <section style={{ textAlign: 'center' }}>
        <h1>计数器</h1>
        <p>当前数值：{count}</p>
        <button type="button" onClick={() => setCount((value) => value + 1)}>增加</button>
      </section>
    </main>
  );
}
`, 'utf8');
const protectedFiles = await restoreRunnerOwnedFiles({ appDir: prepared.appDir, templateDir: prepared.templateDir });
const report = await validateProject({ appDir: prepared.appDir, workspaceDir, attempt: 1, job, protectedFiles });
if (report.ok) await createInlinePreview({ appDir: prepared.appDir, workspaceDir });
console.log(JSON.stringify({
  id: job.id,
  status: report.ok ? 'succeeded' : 'failed',
  failures: report.failures,
  reportPath: report.artifacts.reportPath,
  screenshotPath: report.artifacts.screenshotPath,
}, null, 2));
if (!report.ok) process.exit(1);
