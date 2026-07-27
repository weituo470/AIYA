import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { applyCliModelProfile, getCliModelProfile, getCliProvider } from './config.js';

const COMMAND_TIMEOUT_MS = 180_000;
const WORKSPACE_KIND = 'blank-vite-react';
const VALIDATION_COMMANDS = [
  'pnpm install --ignore-workspace --prefer-offline',
  'pnpm typecheck',
  'pnpm lint',
  'pnpm test -- --run',
  'pnpm build',
  'pnpm smoke',
];
const RUNNER_OWNED_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'eslint.config.js',
  'playwright.config.ts',
  'tests/smoke.spec.ts',
  'tests/generated-source.test.ts',
];

export async function prepareBuildModeWorkspace({ job, workspaceDir, repoRoot }) {
  const appDir = path.join(workspaceDir, 'app');
  const marker = path.join(appDir, 'package.json');
  try {
    await fs.access(marker);
  } catch {
    await fs.rm(appDir, { recursive: true, force: true });
    await fs.mkdir(workspaceDir, { recursive: true });
    await writeBlankViteWorkspace(appDir);
  }
  const spec = buildProductSpec(job);
  await fs.writeFile(path.join(appDir, 'ProductSpec.md'), spec, 'utf8');
  return {
    appDir,
    templateDir: null,
    templateName: WORKSPACE_KIND,
    productSpec: spec,
  };
}

export async function runCodexBuildMode({ job, appDir, config, validationReport, attempt, onProgress }) {
  const baseProvider = getCliProvider(config, job?.cliProvider || 'codex');
  const modelProfile = getCliModelProfile(config, baseProvider?.id, job?.cliModel);
  const provider = applyCliModelProfile(baseProvider, modelProfile);
  if (!provider?.command) {
    throw new Error(`AIYA Create CLI provider is not configured: ${job?.cliProvider || 'codex'}. Set the provider command env var first.`);
  }
  if (provider.id === 'codex' && config.codexMode === 'mock') {
    throw new Error('AIYA Create mock mode is disabled. Set AIYA_CREATE_CODEX_MODE=auto and configure a real CLI command.');
  }
  const prompt = attempt === 1
    ? buildImplementationPrompt(job)
    : buildRepairPrompt(job, validationReport);
  await ensureCliRuntimeConfig(provider);
  await fs.writeFile(path.join(appDir, attempt === 1 ? 'CodexBuildPrompt.md' : `CodexRepairPrompt-${attempt - 1}.md`), prompt, 'utf8');
  const safeProviderId = String(provider.id || 'cli').replace(/[^a-z0-9_-]/gi, '-');
  const logPath = path.join(appDir, `${safeProviderId}-Run-${attempt}.log`);
  const rawArgs = attempt === 1
    ? (provider.argsInitial?.length ? provider.argsInitial : provider.args)
    : (provider.argsRepair?.length ? provider.argsRepair : provider.args);
  const { args, stdin } = materializeCliInvocation(rawArgs || [], prompt);
  const timeoutMs = attempt === 1
    ? (provider.timeoutMsInitial || provider.timeoutMs || config.jobTimeoutMs)
    : (provider.timeoutMsRepair || provider.timeoutMs || config.jobTimeoutMs);
  const modelLabel = attempt === 1
    ? (provider.modelLabelInitial || provider.modelLabel)
    : (provider.modelLabelRepair || provider.modelLabel);
  let commandResult;
  let recoveredFromTimeout = false;
  try {
    commandResult = await runCommand(provider.command, args, {
      cwd: appDir,
      input: stdin,
      timeoutMs,
      logPath,
      env: {
        AIYA_CREATE_BUILDER: 'codex-build-mode',
        AIYA_CREATE_CLI_PROVIDER: provider.id,
        AIYA_CREATE_CLI_TITLE: provider.title,
        ...(provider.env || {}),
      },
      onProgress: (event) => {
        const stage = attempt === 1 ? 'codex_generating' : 'repairing';
        onProgress?.(
          stage,
          `${provider.title} is still writing code · ${formatDuration(Math.round(event.elapsedMs / 1000))}`,
          {
            elapsedMs: event.elapsedMs,
            outputBytes: event.outputBytes,
            logPath,
            cliProvider: provider.id,
            cliTitle: provider.title,
            cliModel: modelProfile?.id || '',
            cliModelTitle: modelProfile?.title || modelLabel || '',
            streamLines: mergeStreamLines(event.streamLines, event.workspaceLines),
            workspaceLines: event.workspaceLines,
          },
        );
      },
    });
  } catch (error) {
    const workspaceSignals = await collectCliWorkspaceSignals(appDir);
    if (!isRecoverableCliTimeout(error, workspaceSignals)) throw error;
    recoveredFromTimeout = true;
    commandResult = {
      code: 124,
      output: error instanceof Error ? error.message : String(error || `${provider.title} timed out after writing files`),
    };
    onProgress?.(
      attempt === 1 ? 'codex_generating' : 'repairing',
      `${provider.title} timed out, but source changes were detected; continuing to validation`,
      {
        logPath,
        cliProvider: provider.id,
        cliTitle: provider.title,
        cliModel: modelProfile?.id || '',
        cliModelTitle: modelProfile?.title || modelLabel || '',
        workspaceSignals,
        knownCliIssues: diagnoseCliOutput(commandResult.output),
      },
    );
  }
  const workspaceSignals = await collectCliWorkspaceSignals(appDir);
  onProgress?.(
    attempt === 1 ? 'codex_generating' : 'repairing',
    workspaceSignals.placeholderPresent
      ? `${provider.title} finished, but src/App.tsx is still the blank placeholder`
      : `${provider.title} finished and workspace changes were detected`,
    {
      logPath,
      cliProvider: provider.id,
      cliTitle: provider.title,
      cliModel: modelProfile?.id || '',
      cliModelTitle: modelProfile?.title || modelLabel || '',
      workspaceSignals,
      knownCliIssues: diagnoseCliOutput(commandResult.output),
    },
  );
  return {
    adapter: `${provider.id}-build-mode`,
    model: modelLabel || inferCodexModel(commandResult.output) || provider.title || 'cli-command',
    logs: commandResult.output.slice(-6000),
    logPath,
    cliProvider: provider.id,
    cliModel: modelProfile?.id || '',
    workspaceSignals,
    knownCliIssues: diagnoseCliOutput(commandResult.output),
    recoveredFromTimeout,
  };
}

async function collectCliWorkspaceSignals(appDir) {
  const files = [
    'src/App.tsx',
    'src/App.jsx',
    'src/styles.css',
    'src/main.tsx',
    'src/main.jsx',
  ];
  const signals = {
    sourceFiles: [],
    appFile: '',
    appBytes: 0,
    placeholderPresent: false,
    generatedMarkerPresent: false,
  };
  for (const relative of files) {
    const filePath = path.join(appDir, relative);
    if (!fsSync.existsSync(filePath)) continue;
    const text = await fs.readFile(filePath, 'utf8').catch(() => '');
    signals.sourceFiles.push({ path: relative, bytes: Buffer.byteLength(text, 'utf8') });
    if (!signals.appFile && /src\/App\.(t|j)sx$/i.test(relative)) {
      signals.appFile = relative;
      signals.appBytes = Buffer.byteLength(text, 'utf8');
      signals.placeholderPresent = text.includes('AIYA_BLANK_PLACEHOLDER');
      signals.generatedMarkerPresent = /data-aiya-generated-app|canvas|snake|贪食蛇|贪吃蛇|地鼠|画板|计算器/i.test(text);
    }
  }
  return signals;
}

function diagnoseCliOutput(output) {
  const text = String(output || '');
  const issues = [];
  if (/--tools\s+""|tools":\[\]/i.test(text)) {
    issues.push('CLI tools were empty; the coding agent could not read or edit files.');
  }
  if (/Missing file specification after redirection operator|The '<' operator is reserved for future use|python\s+-\s+<<'?PY'?/i.test(text)) {
    issues.push('The coding agent used Bash heredoc syntax inside Windows PowerShell. Use PowerShell here-strings or node -e instead.');
  }
  if (/timed out after \d+ms|Process tree will be killed/i.test(text)) {
    issues.push('The coding agent exceeded the job timeout before returning control to the runner.');
  }
  if (/AIYA_BLANK_PLACEHOLDER/i.test(text)) {
    issues.push('Generated source still contains the blank placeholder marker.');
  }
  return issues;
}

function isRecoverableCliTimeout(error, workspaceSignals) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!/timed out after \d+ms|Process tree will be killed/i.test(message)) return false;
  return hasSubstantialWorkspaceChanges(workspaceSignals);
}

function hasSubstantialWorkspaceChanges(signals) {
  if (!signals || signals.placeholderPresent) return false;
  if (!signals.appFile || signals.appBytes < 600) return false;
  return Array.isArray(signals.sourceFiles) && signals.sourceFiles.length >= 2;
}


function materializeCliInvocation(args, prompt) {
  const text = String(prompt || '');
  const hasPlaceholder = args.some((arg) => String(arg).includes('{prompt}'));
  return {
    args: args.map((arg) => String(arg).replaceAll('{prompt}', text)),
    stdin: hasPlaceholder ? '' : text,
  };
}

async function ensureCliRuntimeConfig(provider) {
  if (provider?.id !== 'codex') return;
  const env = provider.env || {};
  if (!env.CODEX_HOME || !env.AIYA_CODEX_DEEPPRAXIS_BASE_URL || !env.AIYA_CODEX_DEEPPRAXIS_MODEL) return;
  await fs.mkdir(env.CODEX_HOME, { recursive: true });
  const configText = [
    `model = "${env.AIYA_CODEX_DEEPPRAXIS_MODEL}"`,
    'model_provider = "deepraxis_openai"',
    'model_reasoning_effort = "none"',
    '',
    '[model_providers.deepraxis_openai]',
    'name = "DeepPraxis Responses"',
    `base_url = "${env.AIYA_CODEX_DEEPPRAXIS_BASE_URL}"`,
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    '',
  ].join('\n');
  await fs.writeFile(path.join(env.CODEX_HOME, 'config.toml'), configText, 'utf8');
}

async function writeBlankViteWorkspace(appDir, options = {}) {
  const runnerOwnedOnly = Boolean(options.runnerOwnedOnly);
  const restored = [];
  const writeFile = async (relative, content, runnerOwned = false) => {
    if (runnerOwnedOnly && !runnerOwned) return;
    const filePath = path.join(appDir, relative);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    restored.push(relative);
  };

  await writeFile('package.json', JSON.stringify({
    name: 'aiya-create-blank-workspace',
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite --host 127.0.0.1',
      typecheck: 'tsc --noEmit',
      lint: 'eslint .',
      test: 'vitest',
      build: 'tsc -b && vite build',
      smoke: 'playwright test tests/smoke.spec.ts',
    },
    dependencies: {
      '@vitejs/plugin-react': '6.0.3',
      vite: '8.1.0',
      typescript: '6.0.3',
      react: '19.2.7',
      'react-dom': '19.2.7',
    },
    devDependencies: {
      '@eslint/js': '10.0.1',
      '@playwright/test': '1.61.1',
      '@types/node': '26.0.1',
      '@types/react': '19.2.17',
      '@types/react-dom': '19.2.3',
      eslint: '10.6.0',
      globals: '17.7.0',
      'typescript-eslint': '8.62.0',
      vitest: '4.1.9',
    },
  }, null, 2), true);
  await writeFile('tsconfig.json', JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      useDefineForClassFields: true,
      lib: ['DOM', 'DOM.Iterable', 'ES2022'],
      allowJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      types: ['vitest/globals', 'node'],
    },
    include: ['src', 'tests'],
    references: [],
  }, null, 2), true);
  await writeFile('vite.config.ts', `import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
`, true);
  await writeFile('vitest.config.ts', `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.spec.ts', 'node_modules', 'dist'],
  },
});
`, true);
  await writeFile('eslint.config.js', `import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    ignores: ['dist', 'node_modules', 'artifacts'],
  },
);
`, true);
  await writeFile('playwright.config.ts', `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
});
`, true);
  await writeFile('tests/generated-source.test.ts', `import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

describe('generated app source', () => {
  it('contains a generated React application instead of the blank placeholder', () => {
    const app = fs.existsSync('src/App.tsx') ? fs.readFileSync('src/App.tsx', 'utf8') : '';
    expect(app.length).toBeGreaterThan(120);
    expect(app).not.toContain('AIYA_BLANK_PLACEHOLDER');
  });
});
`, true);
  await writeFile('tests/smoke.spec.ts', `import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';

type SmokeReport = {
  url: string;
  consoleErrors: string[];
  pageErrors: string[];
  assertions: {
    rootVisible: boolean;
    hasVisibleContent: boolean;
    hostScrollStable: boolean;
    interactiveProbeRan: boolean;
  };
  metrics: {
    scrollBefore: number;
    scrollAfter: number;
    visibleTextLength: number;
    interactiveCount: number;
    canvasCount: number;
  };
  screenshotPath: string;
  failure?: string;
};

test('generated app boots without runtime errors', async ({ page }) => {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const report: SmokeReport = {
    url: '',
    consoleErrors: errors,
    pageErrors,
    assertions: {
      rootVisible: false,
      hasVisibleContent: false,
      hostScrollStable: false,
      interactiveProbeRan: false,
    },
    metrics: {
      scrollBefore: 0,
      scrollAfter: 0,
      visibleTextLength: 0,
      interactiveCount: 0,
      canvasCount: 0,
    },
    screenshotPath: 'artifacts/smoke/latest.png',
  };

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await page.goto('/');
    const root = page.locator('#root');
    await expect(root).toBeVisible();
    report.url = page.url();
    report.assertions.rootVisible = true;

    const bodyText = await page.locator('body').innerText().catch(() => '');
    report.metrics.visibleTextLength = bodyText.trim().length;
    report.assertions.hasVisibleContent = report.metrics.visibleTextLength > 0 || await page.locator('canvas, svg, img, button, input, textarea, select').count() > 0;

    report.metrics.interactiveCount = await page.locator('button, input, select, textarea, canvas, [role="button"], [tabindex]').count().catch(() => 0);
    report.metrics.canvasCount = await page.locator('canvas').count().catch(() => 0);
    report.metrics.scrollBefore = await page.evaluate(() => window.scrollY);

    await page.keyboard.press('Space').catch(() => {});
    await page.keyboard.press('ArrowRight').catch(() => {});
    if (report.metrics.interactiveCount > 0) {
      await page.locator('button, input, select, textarea, canvas, [role="button"], [tabindex]').first().click({ force: true, position: { x: 8, y: 8 } }).catch(() => {});
      report.assertions.interactiveProbeRan = true;
    }
    await page.waitForTimeout(300);
    report.metrics.scrollAfter = await page.evaluate(() => window.scrollY);
    report.assertions.hostScrollStable = report.metrics.scrollBefore === report.metrics.scrollAfter;

    await page.screenshot({ path: report.screenshotPath, fullPage: true });
    expect(errors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(report.assertions.hasVisibleContent).toBe(true);
  } catch (error) {
    report.failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    await fs.mkdir('artifacts/smoke', { recursive: true });
    await fs.writeFile('artifacts/smoke/report.json', JSON.stringify(report, null, 2), 'utf8');
  }
});
`, true);

  if (!runnerOwnedOnly) {
    await writeFile('index.html', `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AIYA Create</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`);
    await writeFile('src/main.tsx', `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
`);
    await writeFile('src/App.tsx', `export default function App() {
  return (
    <main className="blank" data-aiya-generated-app>
      <p>AIYA_BLANK_PLACEHOLDER</p>
    </main>
  );
}
`);
    await writeFile('src/styles.css', `:root {
  color: #111827;
  background: #ffffff;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-height: 100%;
  margin: 0;
}

body {
  min-height: 100vh;
}

button,
input,
textarea,
select {
  font: inherit;
}

.blank {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}
`);
    await writeFile('src/vite-env.d.ts', '/// <reference types="vite/client" />\n');
  }

  return restored;
}

export async function restoreRunnerOwnedFiles({ appDir, templateDir }) {
  if (!templateDir) {
    const restored = await writeBlankViteWorkspace(appDir, { runnerOwnedOnly: true });
    return {
      protectedFiles: RUNNER_OWNED_FILES,
      restored,
    };
  }
  const restored = [];
  for (const relative of RUNNER_OWNED_FILES) {
    const templatePath = path.join(templateDir, relative);
    const appPath = path.join(appDir, relative);
    try {
      const [templateContent, appContent] = await Promise.all([
        fs.readFile(templatePath),
        fs.readFile(appPath).catch(() => null),
      ]);
      if (!appContent || !templateContent.equals(appContent)) {
        await fs.mkdir(path.dirname(appPath), { recursive: true });
        await fs.copyFile(templatePath, appPath);
        restored.push(relative);
      }
    } catch {
      // If the template no longer has a protected file, skip rather than block unrelated jobs.
    }
  }
  return {
    protectedFiles: RUNNER_OWNED_FILES,
    restored,
  };
}

export async function validateProject({ appDir, workspaceDir, attempt, job, onProgress, protectedFiles }) {
  const startedAt = new Date().toISOString();
  const artifactsDir = path.join(workspaceDir, 'artifacts', `attempt-${attempt}`);
  await fs.mkdir(artifactsDir, { recursive: true });
  await ensureIntentTestFiles(appDir, job);
  const commands = [];
  let failedStage = null;

  for (const command of VALIDATION_COMMANDS) {
    const commandStage = command === 'pnpm smoke' ? 'browser_verify' : 'static_check';
    onProgress?.(commandStage, `Running ${command}`);
    const started = Date.now();
    const result = await runShell(command, {
      cwd: appDir,
      timeoutMs: command.startsWith('pnpm install') ? 240_000 : COMMAND_TIMEOUT_MS,
      env: {
        CI: '1',
        PLAYWRIGHT_HTML_OPEN: 'never',
      },
    });
    const record = {
      cmd: command,
      passed: result.code === 0,
      durationMs: Date.now() - started,
      stdoutTail: tail(result.stdout, 3000),
      stderrTail: tail(result.stderr || result.output, 3000),
    };
    commands.push(record);
    await fs.appendFile(path.join(artifactsDir, 'commands.log'), `\n$ ${command}\n${result.output}\n`, 'utf8');
    onProgress?.(
      commandStage,
      `${command} ${record.passed ? 'passed' : 'failed'} in ${Math.round(record.durationMs / 1000)}s`,
      { command: record.cmd, passed: record.passed, durationMs: record.durationMs },
    );
    if (!record.passed && command !== 'pnpm smoke') {
      failedStage = command;
      break;
    }
  }

  onProgress?.('browser_verify', 'Collecting browser artifacts and smoke evidence');
  const browser = await collectBrowserArtifacts(appDir, artifactsDir);
  const changedFiles = await listChangedFiles(appDir);
  const semantic = await runSemanticChecks({ appDir, job });
  const semanticHardFailures = intentSemanticMustPass(job) ? semantic.failures : [];
  onProgress?.('quality_review', 'Summarizing browser diagnostics');
  const quality = await computeQualityReport({
    appDir,
    job,
    commands,
    browser,
    semantic,
    changedFiles,
    failedStage,
    protectedFiles,
  });
  const hardPassed = !failedStage
    && browser.pageErrors.length === 0
    && browser.consoleErrors.length === 0
    && browser.hasVisibleContent
    && semanticHardFailures.length === 0;
  const failures = [];
  if (failedStage) failures.push(`Command failed: ${failedStage}`);
  for (const failure of semanticHardFailures) failures.push(failure);
  if (!browser.hasVisibleContent) failures.push('Browser smoke artifact check failed: visible generated content not detected');
  for (const error of browser.consoleErrors) failures.push(`Console error: ${error}`);
  for (const error of browser.pageErrors) failures.push(`Page error: ${error.message || error}`);
  const diagnosticWarnings = [
    ...semantic.failures.map((failure) => `语义提示：${failure}`),
    ...quality.gateFailures.map((failure) => `验证提示：${failure}`),
  ];

  const report = {
    attempt,
    overallPassed: hardPassed,
    ok: hardPassed,
    failedStage: failedStage || (semanticHardFailures.length ? 'semantic-check' : (hardPassed ? null : 'browser-artifact-check')),
    failures,
    warnings: [...semantic.warnings, ...quality.warnings, ...diagnosticWarnings],
    commands,
    browser,
    semantic,
    quality,
    protectedFiles,
    changedFiles,
    diagnosisHint: failures.length ? diagnosisHint(failures) : 'All validation stages passed.',
    startedAt,
    finishedAt: new Date().toISOString(),
    artifacts: {
      reportPath: path.join(artifactsDir, 'ValidationReport.json'),
      commandsLogPath: path.join(artifactsDir, 'commands.log'),
      screenshotPath: browser.screenshotPath,
      smokeReportPath: browser.smokeReportPath,
    },
  };
  await fs.writeFile(report.artifacts.reportPath, JSON.stringify(report, null, 2), 'utf8');
  return report;
}

export async function createInlinePreview({ appDir, workspaceDir }) {
  const distDir = path.join(appDir, 'dist');
  let html = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
  html = await inlineAssets(html, distDir);
  html = injectPreviewRuntimeGuard(html);
  const outputPath = path.join(workspaceDir, 'validated-index.html');
  await fs.writeFile(outputPath, html, 'utf8');
  return { html, outputPath };
}

export function buildResultFromProject({ html, job, generated, validation, templateName }) {
  const htmlTitle = inferTitle(html);
  const productTitle = !htmlTitle || /^AIYA Game Demo$/i.test(htmlTitle) ? inferTitleFromPrompt(job.prompt) : htmlTitle;
  const toolTask = isToolPrompt(job?.prompt);
  return {
    title: productTitle,
    kind: toolTask ? '工具应用 Demo · Build Mode' : '应用 Demo · Build Mode',
    brief: toolTask
      ? 'Server Codex 在空白 Vite/React 工程中按需求生成工具应用，并通过项目级命令链与 Playwright smoke 验证。'
      : 'Server Codex 在空白 Vite/React 工程中按需求生成应用，并通过项目级命令链与 Playwright smoke 验证。',
    html,
    teaching: [
      `工程：${templateName}`,
      '生成前写入 ProductSpec.md，CLI 编程工具从空白 React 工程开始实现，不再套用业务模板。',
      '验证包括 pnpm install/typecheck/lint/test/build/smoke、浏览器启动证据、诊断信息与截图 artifact；验证提示不再阻断预览。',
    ],
    nextEdits: ['强化视觉风格', '增加关卡或排行榜', '优化移动端触控'],
    source: 'codex-build-mode',
    model: generated.model || generated.adapter,
    validationReport: publicProjectValidation(validation),
  };
}

export function publicProjectValidation(validation) {
  if (!validation) return null;
  return {
    ok: validation.ok,
    failures: validation.failures || [],
    warnings: validation.warnings || [],
    startedAt: validation.startedAt,
    finishedAt: validation.finishedAt,
    failedStage: validation.failedStage,
    commands: validation.commands?.map((command) => ({
      cmd: command.cmd,
      passed: command.passed,
      durationMs: command.durationMs,
      stdoutTail: command.stdoutTail,
      stderrTail: command.stderrTail,
    })) || [],
    browser: validation.browser,
    semantic: validation.semantic,
    quality: validation.quality,
    artifacts: validation.artifacts,
    diagnosisHint: validation.diagnosisHint,
  };
}


async function ensureIntentTestFiles(_appDir, _job) {
  // Business-specific template tests are intentionally disabled.
  // The runner validates build/runtime health without forcing a game/tool shape.
}

function hasEnglishVisibleCopy(source) {
  const text = String(source || '');
  const visibleFragments = text.match(/(?:["'`][^"'`]{0,100}["'`]|>[^<>]{1,100}<)/g) || [];
  return visibleFragments.some((part) => /\b(game over|time up|final score|hit the mole|press space|start\s*\/\s*resume|controls:)\b/i.test(part));
}

function buildProductSpec(job) {
  const userIdea = String(job.prompt || job.currentApp?.title || 'Create a browser demo.').trim();
  const revision = String(job.revision || '').trim();
  const appName = inferTitleFromPrompt(userIdea);
  const tool = isToolPrompt(userIdea);
  const appType = tool ? 'browser-tool-demo' : 'browser-app-demo';
  const demoKind = tool ? 'browser tool/application demo' : 'browser app/game demo';
  const flow = `1. User opens the page and immediately sees a finished result for the request.
2. User can interact with the app using controls that fit the requested product.
3. The app gives visible feedback after meaningful input.
4. The result is readable on desktop and mobile.
5. All visible UI copy is Simplified Chinese unless the user asks otherwise.`;
  const functional = `- Replace the blank placeholder in src/App.tsx with a complete implementation.
- Match the exact user request; do not reuse an unrelated game/tool pattern.
- Use the Vite/React shell only as a packaging wrapper; implement with the mindset of a compact single-file HTML demo.
- Keep business logic concentrated in src/App.tsx and visual styling in src/styles.css. Do not create extra source modules unless the request is genuinely complex.
- Prefer direct Canvas/SVG/DOM logic over over-engineered React abstractions when it makes the demo shorter and clearer.
- No console errors or page errors.
- If keyboard controls use Arrow/WASD/Space, call preventDefault() so the host page does not scroll.
- Keep the app offline-only and self-contained.`;
  return `# ProductSpec.md

## User idea
${userIdea}

## Canonical intent
${englishIntent(job)}

## Revision
${revision || 'first version'}

## App type
${appType}

## Target workspace
${WORKSPACE_KIND}

## Target stack
- The preview is packaged by Vite/React/TypeScript, but the implementation should feel like a concise single HTML/CSS/JS demo.
- Use one App.tsx plus one styles.css for normal requests.
- Canvas 2D, SVG, DOM UI, or any browser-native approach that best fits the request.
- Vitest and Playwright are runner-owned validation tools; do not expand them.

## Demo goal
Build a polished, immediately usable ${demoKind} for: ${appName}.
The generated app must match the Canonical intent above and the exact user idea. Do not reuse an unrelated game/tool pattern.

## Language and copy requirements
- All user-visible text in the generated demo must be Simplified Chinese by default.
- Keep technical code identifiers in English if useful, but titles, buttons, labels, status messages, hints, and end-state copy must be Chinese.
- If the user explicitly asks for another language, follow the user.

## User flow
${flow}

## Controls
- Choose controls that fit the requested product.
- Pointer, touch, click, drag, typing, or canvas interaction should work where relevant.
- If keyboard controls use Arrow/WASD/Space, call preventDefault() so the host page does not scroll.

## Visual requirements
- First screen should look like a finished mini product, not a bare scaffold.
- Use readable typography, clear contrast, and responsive spacing.
- Include visible state/result feedback where relevant.
- Use Canvas/SVG/DOM freely; do not force a game canvas unless the app needs it.

## Functional requirements
${functional}
${drawingBoardAcceptance(userIdea)}${calculatorAcceptance(userIdea)}${snakeAcceptance(userIdea)}${whackMoleAcceptance(userIdea)}

## Non-goals
- No backend.
- No database.
- No authentication.
- No network, cookie, localStorage, sessionStorage, or form submission.
- No external image/audio assets unless the user explicitly asks and validation still passes.

## Success criteria
- The blank placeholder in src/App.tsx is fully replaced.
- Simple demos stay compact: usually under about 220 lines in App.tsx and 160 lines in styles.css.
- pnpm typecheck passes.
- pnpm lint passes.
- pnpm test -- --run passes.
- pnpm build passes.
- pnpm smoke passes.
- Playwright screenshot exists.
- Browser diagnostics are informational; runtime/build failures still block preview.
`;
}

function intentSemanticMustPass(_job) {
  return false;
}

function buildImplementationPrompt(job) {
  return `Implement ProductSpec.md inside the blank Vite/React workspace.

Important:
- Read ./ProductSpec.md first. It is the authoritative product request and contains the full UTF-8 user idea plus English acceptance criteria.
- Detected intent: ${englishIntent(job)}
- The workspace starts from a blank placeholder. Replace it with a real implementation for this request.

Hard constraints:
- Do not add backend, database, auth, external APIs, or external assets.
- Do not weaken package scripts, tests, or smoke checks.
- Do not call tool_search, browser tools, MCP tools, plugin discovery, or skill discovery; this is a small local workspace task.
- Do not spend time explaining. Only edit files in this workspace and finish.
- You are running on Windows PowerShell. Never use Bash heredoc syntax such as python - <<'PY'. For multi-line writes, use the CLI file edit tools, PowerShell here-strings with Set-Content -Encoding UTF8, or node -e with fs.writeFileSync.
- Mandatory first action: overwrite src/App.tsx with a real implementation. The final src/App.tsx must not contain AIYA_BLANK_PLACEHOLDER.
- Before final DONE, read or inspect src/App.tsx and confirm the placeholder is gone. If it is still present, edit again instead of saying DONE.
- Prefer the shortest complete implementation: one App.tsx and one styles.css. Treat this like writing a single self-contained HTML/CSS/JS file, just inside the React shell.
- Do not create extra source files, reducers, state machines, utility layers, or generalized engines for simple demos.
- For simple games, use direct variables/state, a compact loop, and straightforward drawing/DOM updates. Add only features the user asked for.
- For games, implement the requested mechanics directly; do not reuse unrelated runner/dodger/clicker patterns.
- Keep requestAnimationFrame and event listeners cleaned up if you use them.
- The app must be usable after validation.
- Code budget guideline for ordinary demos: App.tsx under about 220 lines, styles.css under about 160 lines. Exceed this only when the user asks for complexity.
- If the request is Snake, build a real grid-based Snake game, not a runner/avoid/collect game. Keep it compact; do not add pause/levels/speed systems unless asked.
- If the request is Whack-a-mole/???, build an actual multi-hole whack game. Do not turn it into a collect/dodge game.
- If the request is Drawing Board/??, build an actual drawing tool. Do not turn it into any game.
- If the request is Calculator/???, build an actual calculator/tool app. Do not turn it into any game.
- All visible app UI copy must be Simplified Chinese unless ProductSpec explicitly says otherwise.

Do not run pnpm install/typecheck/lint/test/build/smoke yourself. The server will run validation after you exit. Make the smallest complete file changes and exit immediately. Your final response must be exactly: DONE.
`;
}

function buildRepairPrompt(job, validationReport) {
  return `The demo failed validation. Fix the smallest possible issue inside the blank generated workspace.

Important:
- Read ./ProductSpec.md first.
- Detected intent: ${englishIntent(job)}

Rules:
- Do not redesign the app.
- Keep the fix compact; do not add architectural layers or extra files unless required.
- Do not remove features to pass tests.
- Do not weaken scripts, tests, or smoke checks.
- Preserve the Simplified Chinese UI requirement from ProductSpec.
- If ValidationReport says Snake semantic check failed, replace any runner/avoid/collect mechanics with a real grid Snake implementation and keep explicit snake/food identifiers in source.
- Do not call tool_search, browser tools, MCP tools, plugin discovery, or skill discovery; use the ValidationReport directly.
- Fix the root cause shown by ValidationReport. Do not run long validation commands yourself; the server will validate after you exit.
- Keep all changes within this workspace.
- Prefer one App.tsx plus one styles.css, with concise single-HTML-demo style code.
- You are running on Windows PowerShell. Never use Bash heredoc syntax such as python - <<'PY'. For multi-line writes, use the CLI file edit tools, PowerShell here-strings with Set-Content -Encoding UTF8, or node -e with fs.writeFileSync.
- Mandatory fix: src/App.tsx must be overwritten with a real implementation and must not contain AIYA_BLANK_PLACEHOLDER.
- Before final DONE, read or inspect src/App.tsx and confirm the placeholder is gone. If it is still present, edit again instead of saying DONE.
- Your final response must be exactly: DONE.

ValidationReport:
${JSON.stringify(publicProjectValidation(validationReport), null, 2)}
`;
}

function englishIntent(job) {
  const prompt = `${job?.prompt || ''} ${job?.revision || ''}`;
  if (isDrawingBoardPrompt(prompt)) return 'Build a polished usable drawing board application, not a game.';
  if (isCalculatorPrompt(prompt)) return 'Build a polished usable calculator application, not a game.';
  if (isSnakePrompt(prompt)) return 'Build a polished playable Snake game.';
  if (isWhackMolePrompt(prompt)) return 'Build a polished playable whack-a-mole game with a multi-hole board.';
  if (/asteroid|spaceship|space/i.test(prompt)) return 'Build a polished playable spaceship dodging asteroids game.';
  if (/shoot/i.test(prompt)) return 'Build a polished playable shooting game.';
  return 'Build the browser game described in ProductSpec.md.';
}

async function collectBrowserArtifacts(appDir, artifactsDir) {
  const smokeScreenshot = path.join(appDir, 'artifacts', 'smoke', 'latest.png');
  const smokeReportPath = path.join(appDir, 'artifacts', 'smoke', 'report.json');
  const screenshotPath = path.join(artifactsDir, 'screenshot.png');
  const smokeReportOutputPath = path.join(artifactsDir, 'smoke-report.json');
  try {
    await fs.copyFile(smokeScreenshot, screenshotPath);
  } catch {
    // keep missing screenshot visible in report
  }
  const smokeReport = await readJson(smokeReportPath);
  if (smokeReport) {
    await fs.writeFile(smokeReportOutputPath, JSON.stringify(smokeReport, null, 2), 'utf8').catch(() => {});
  }
  const distHtml = await safeRead(path.join(appDir, 'dist', 'index.html'));
  const hasVisibleContent = Boolean(smokeReport?.assertions?.hasVisibleContent)
    || /<body[\s\S]*<div id="root"/i.test(distHtml);
  const canvasCount = Number(smokeReport?.metrics?.canvasCount || 0);
  return {
    url: 'http://127.0.0.1:5173',
    consoleErrors: smokeReport?.consoleErrors || [],
    pageErrors: smokeReport?.pageErrors || [],
    screenshotPath,
    smokeReportPath: smokeReport ? smokeReportOutputPath : null,
    smoke: smokeReport || null,
    hasVisibleContent,
    hasCanvas: canvasCount > 0,
  };
}

async function computeQualityReport({ appDir, job, commands, browser, semantic, changedFiles, failedStage, protectedFiles }) {
  const sourceFiles = await readProjectSourceForQuality(appDir);
  const sourceText = sourceFiles.join('\n').toLowerCase();
  const smoke = browser.smoke || {};
  const assertions = smoke.assertions || {};
  const restoredRunnerFiles = protectedFiles?.restored || [];
  const criteria = [];
  const warnings = [];

  const add = (id, label, passed, weight, evidence, required = false) => {
    criteria.push({ id, label, passed: Boolean(passed), weight, evidence, required });
  };

  const allCommandsPassed = commands.length === VALIDATION_COMMANDS.length && commands.every((command) => command.passed);
  const hasExternalNetwork = /https?:\/\/|fetch\s*\(|xmlhttprequest|websocket\s*\(|localstorage|document\.cookie/i.test(sourceFiles.join('\n'));
  const hasResponsiveCss = /@media|clamp\(|minmax\(|svh|vw|vh|touch-action/i.test(sourceFiles.join('\n'));
  const hasGeneratedApp = !sourceText.includes('aiya_blank_placeholder') && sourceText.length > 300;
  const hasReadableProductChrome = /button|canvas|svg|input|textarea|select|role=|aria-|className|onClick|onPointer|onChange|onKey/.test(sourceFiles.join('\n'));
  const runnerValidationFilesLocked = Array.isArray(protectedFiles?.protectedFiles)
    && protectedFiles.protectedFiles.includes('tests/smoke.spec.ts')
    && protectedFiles.protectedFiles.includes('package.json');

  add('commands', '项目命令链全部通过', allCommandsPassed && !failedStage, 18, `${commands.filter((command) => command.passed).length}/${VALIDATION_COMMANDS.length} commands passed`, true);
  add('runtime', '浏览器运行无 console/page error', browser.consoleErrors.length === 0 && browser.pageErrors.length === 0, 14, `${browser.consoleErrors.length} console errors, ${browser.pageErrors.length} page errors`, true);
  add('visible-content', '生成页面有可见内容', browser.hasVisibleContent, 14, browser.hasVisibleContent ? 'visible content detected' : 'visible content missing', true);
  add('placeholder-replaced', '空白占位已被替换', hasGeneratedApp, 12, hasGeneratedApp ? 'placeholder removed' : 'blank placeholder remains', true);
  add('scroll-stable', '方向键/空格不滚动宿主页', assertions.hostScrollStable, 8, `scroll ${smoke.metrics?.scrollBefore ?? '?'} -> ${smoke.metrics?.scrollAfter ?? '?'}`);
  add('semantic', '语义检查匹配任务', semantic.failures.length === 0, 8, semantic.failures.length ? semantic.failures.join(' | ') : 'semantic checks passed');
  add('structure', '代码结构可维护', changedFiles.some((file) => file.startsWith('src/')), 6, changedFiles.filter((file) => file.startsWith('src/')).join(', ') || 'src changes missing');
  add('responsive', '移动端/响应式基础适配', hasResponsiveCss, 5, hasResponsiveCss ? 'responsive/touch CSS detected' : 'responsive CSS weak');
  add('product-chrome', '有基本界面和交互元素', hasReadableProductChrome, 5, hasReadableProductChrome ? 'UI/control terms detected' : 'UI/control terms weak');
  add(
    'runner-owned-validation',
    '验证脚本由 runner 锁定',
    runnerValidationFilesLocked,
    6,
    restoredRunnerFiles.length
      ? `restored protected files before validation: ${restoredRunnerFiles.join(', ')}`
      : 'protected validation files matched runner baseline',
    true,
  );

  if (restoredRunnerFiles.length) warnings.push(`Runner-owned validation files were restored before validation: ${restoredRunnerFiles.join(', ')}`);
  if (hasExternalNetwork) warnings.push('Source contains network/storage-sensitive API usage; generated demo should stay offline-only.');
  add('offline-safe', '不依赖外部资源或持久化副作用', !hasExternalNetwork, 10, hasExternalNetwork ? 'network/storage API detected' : 'offline-only source scan passed', true);

  const gateFailures = criteria
    .filter((item) => item.required && !item.passed)
    .map((item) => item.label);

  return {
    ok: gateFailures.length === 0,
    gateFailures,
    warnings,
    criteria,
  };
}

async function readProjectSourceForQuality(appDir) {
  const files = [
    'src/App.tsx',
    'src/styles.css',
    'src/components/GameCanvas.tsx',
    'src/game/constants.ts',
    'src/game/state.ts',
    'src/game/update.ts',
    'src/game/render.ts',
    'src/game/input.ts',
    'tests/smoke.spec.ts',
    'tests/game-state.test.ts',
    'tests/collision.test.ts',
  ];
  return Promise.all(files.map((file) => safeRead(path.join(appDir, file))));
}

async function runSemanticChecks({ appDir, job }) {
  const sourceFiles = [
    'src/App.tsx',
    'src/components/GameCanvas.tsx',
    'src/game/constants.ts',
    'src/game/state.ts',
    'src/game/update.ts',
    'src/game/render.ts',
    'src/game/input.ts',
    'tests/smoke.spec.ts',
    'tests/game-state.test.ts',
    'tests/collision.test.ts',
  ];
  const source = (await Promise.all(sourceFiles.map((file) => safeRead(path.join(appDir, file))))).join('\n').toLowerCase();
  const appSurfaceSource = (await Promise.all([
    'src/App.tsx',
    'src/components/GameCanvas.tsx',
    'src/styles.css',
  ].map((file) => safeRead(path.join(appDir, file))))).join('\n').toLowerCase();
  const failures = [];
  const warnings = [];

  if (isDrawingBoardPrompt(job?.prompt)) {
    const checks = [
      [/drawingboard|drawing|canvas|sketch|paint/, 'drawing board identity'],
      [/brush|brushsize|sizecontrol|range/, 'brush size control'],
      [/color|swatch|palette|colors/, 'color palette'],
      [/pointerdown|pointermove|onPointerDown|onPointerMove|drawStroke/i, 'pointer drawing interaction'],
      [/clearcanvas|reset|restart|clear/, 'clear/reset control'],
      [/download|export|todataurl|png/, 'download/export control'],
    ];
    for (const [pattern, label] of checks) {
      if (!pattern.test(appSurfaceSource)) failures.push(`Drawing board semantic check failed: ${label} not detected`);
    }
    if (/\brunner\b|asteroid|spaceship|meteor|flying|dodge|collecting/i.test(appSurfaceSource)) {
      failures.push('Drawing board semantic check failed: generated source still looks like a flying/game template');
    }
    if (hasEnglishVisibleCopy(appSurfaceSource)) {
      failures.push('Semantic check failed: generated result still contains English visible UI copy');
    }
    return { ok: failures.length === 0, failures, warnings };
  }
  if (isCalculatorPrompt(job?.prompt)) {
    const checks = [
      [/计算器|calculator/, 'calculator identity'],
      [/display|当前结果|结果/, 'result display'],
      [/清除|clear|退格|backspace|重新/, 'clear/backspace/reset controls'],
      [/[+×÷*/-]|operator|运算|四则/, 'arithmetic operators'],
      [/history|历史/, 'history or feedback'],
    ];
    for (const [pattern, label] of checks) {
      if (!pattern.test(source)) failures.push(`Calculator semantic check failed: ${label} not detected`);
    }
    if (/飞行|躲避|陨石|太空|runner|asteroid|spaceship|game over/i.test(source)) {
      failures.push('Calculator semantic check failed: generated source still looks like a flying/game template');
    }
    if (hasEnglishVisibleCopy(source)) {
      failures.push('语义检查失败：生成结果仍包含英文界面文案');
    }
    return { ok: failures.length === 0, failures, warnings };
  }
  if (!/requestanimationframe|setinterval|settimeout/.test(source)) {
    failures.push('Semantic check failed: game loop/timer logic not detected');
  }
  if (!/preventdefault/.test(source)) {
    failures.push('Semantic check failed: preventDefault for game controls not detected');
  }
  if (!/restart|reset|重开|重新/.test(source)) {
    failures.push('Semantic check failed: restart/reset path not detected');
  }
  if (!/score|分数/.test(source)) {
    failures.push('Semantic check failed: score/status feedback not detected');
  }
  if (hasEnglishVisibleCopy(source)) {
    failures.push('语义检查失败：生成结果仍包含英文界面文案');
  }
  if (isSnakePrompt(job?.prompt)) {
    const checks = [
      [/snake|蛇/, 'snake entity'],
      [/food|apple|pellet|orb|食物|苹果|豆/, 'food entity'],
      [/gameover|game over|collision|collide|撞|死亡|结束/, 'collision/game-over rule'],
      [/arrow|keyw|keya|keys|wasd|方向/, 'Arrow/WASD controls'],
      [/restart|reset|重开|重新/, 'restart control'],
    ];
    for (const [pattern, label] of checks) {
      if (!pattern.test(source)) failures.push(`Snake semantic check failed: ${label} not detected`);
    }
  }
  if (isWhackMolePrompt(job?.prompt)) {
    const checks = [
      [/地鼠|mole/i, 'mole entity'],
      [/洞|hole|holes/i, 'hole board'],
      [/hit|敲|打|点击|click|pointerdown|pointer/i, 'hit interaction'],
      [/time|timer|countdown|倒计时|时间|逃走|miss|missed|life|lives/i, 'timer or miss pressure'],
      [/score|分数|得分/i, 'score feedback'],
    ];
    for (const [pattern, label] of checks) {
      if (!pattern.test(source)) failures.push(`Whack-a-mole semantic check failed: ${label} not detected`);
    }
    if (!/(3\s*\*\s*3|3\s*x\s*3|hole_count\s*=\s*9|holes?\s*[:=]|array\.from\(\s*\{\s*length:\s*(?:9|hole_count)|HOLE_COUNT\s*=\s*9)/i.test(source)) {
      failures.push('Whack-a-mole semantic check failed: multi-hole board not clearly detected');
    }
  }
  return { ok: failures.length === 0, failures, warnings };
}

function isSnakePrompt(prompt) {
  return /snake|贪食蛇|贪吃蛇/i.test(String(prompt || ''));
}

function isWhackMolePrompt(prompt) {
  return /打地鼠|敲地鼠|whack[- ]?a[- ]?mole|mole/i.test(String(prompt || ''));
}

function isCalculatorPrompt(prompt) {
  return /计算器|calculator|计算工具/i.test(String(prompt || ''));
}

function isDrawingBoardPrompt(prompt) {
  const text = String(prompt || '').toLowerCase();
  return text.includes('\u753b\u677f')
    || text.includes('\u7ed8\u56fe')
    || text.includes('\u6d82\u9e26')
    || text.includes('\u767d\u677f')
    || /drawing\s*board|paint\s*board|sketchpad|canvas\s*draw/.test(text);
}

function isToolPrompt(prompt) {
  return isDrawingBoardPrompt(prompt) || isCalculatorPrompt(prompt);
}

function drawingBoardAcceptance(prompt) {
  if (!isDrawingBoardPrompt(prompt)) return '';
  return `

## Drawing-board-specific acceptance
- The demo must be a real drawing board/tool app, not a game.
- Show a clear drawing canvas, color palette, brush size control, clear/reset, and download/export.
- Pointer down/move/up on the canvas must draw visible strokes.
- Include visible Chinese labels for title, color, brush size, reset, and download.
- Do not include flying, asteroid, runner, dodge, game-over, player/enemy, or unrelated game mechanics.
`;
}

function calculatorAcceptance(prompt) {
  if (!isCalculatorPrompt(prompt)) return '';
  return `

## Calculator-specific acceptance
- The demo must be a real calculator/tool app, not a game.
- Show a clear numeric display, keypad, + - × ÷ operators, equals, clear, backspace/reset.
- Button clicks and keyboard number/operator input update the display.
- Include Chinese labels for 当前结果、清除、退格、重新开始 and optional 历史记录.
- Do not include flying, asteroid, runner, dodge, game-over, player/enemy, or unrelated game mechanics.
`;
}

function snakeAcceptance(prompt) {
  if (!isSnakePrompt(prompt)) return '';
  return `

## Snake-specific acceptance
- Visible snake body, visible food, and food respawns after eating.
- Score changes after eating food.
- Boundary/self collision produces a game-over state, but the first screen must not be game over.
- Arrow keys and WASD change direction; opposite-direction reversal should be guarded.
- Restart button resets snake, food, score, and game-over state.
- Tests or smoke checks should cover at least one state update/control path.
`;
}

function whackMoleAcceptance(prompt) {
  if (!isWhackMolePrompt(prompt)) return '';
  return `

## Whack-a-mole-specific acceptance
- The demo must be a real 打地鼠 game, not a collect/dodge/runner game.
- Show a clear multi-hole board: preferably 3 x 3, and at least 6 visible holes.
- Moles must appear from holes and disappear after a short time.
- Clicking/tapping the active mole or pressing a hit key must change score.
- Include countdown, timer, lives, or escaped-mole pressure.
- Include Chinese labels for 分数、时间/生命、状态、重新开始.
- Tests or smoke diagnostics should cover at least one hit/miss/update path.
`;
}

async function listChangedFiles(appDir) {
  const files = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', 'dist', 'artifacts', '.git'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(path.relative(appDir, full).replace(/\\/g, '/'));
    }
  }
  await walk(appDir);
  return files.sort();
}

async function inlineAssets(html, distDir) {
  let output = html;
  output = await replaceAsync(output, /<script type="module" crossorigin src="([^\"]+)"><\/script>/g, async (_match, src) => {
    const code = await fs.readFile(path.join(distDir, src.replace(/^\//, '')), 'utf8');
    return `<script type="module">\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;
  });
  output = await replaceAsync(output, /<link rel="stylesheet" crossorigin href="([^\"]+)">/g, async (_match, href) => {
    const css = await fs.readFile(path.join(distDir, href.replace(/^\//, '')), 'utf8');
    return `<style>\n${css}\n</style>`;
  });
  output = output.replace(/<script type="module" src="\/src\/main\.tsx"><\/script>/, '');
  return output;
}

function injectPreviewRuntimeGuard(html) {
  const style = `<style id="aiya-create-runtime-guard">
html,body{overscroll-behavior:none}
canvas,[data-game-root],[data-testid="game-canvas"]{touch-action:none}
</style>`;
  const script = `<script id="aiya-create-runtime-guard">
(() => {
  const blocked = new Set(['arrowup','arrowdown','arrowleft','arrowright',' ','space','spacebar','w','a','s','d']);
  const isInput = (target) => ['INPUT','TEXTAREA','SELECT'].includes(target?.tagName || '') || target?.isContentEditable;
  const normalize = (value) => String(value || '').toLowerCase();
  const shouldBlock = (event) => blocked.has(normalize(event.key)) || blocked.has(normalize(event.code));
  const block = (event) => {
    if (shouldBlock(event) && !isInput(event.target)) event.preventDefault();
  };
  window.addEventListener('keydown', block, { capture: true });
  document.addEventListener('keydown', block, { capture: true });
  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type !== 'AIYA_CREATE_KEYBOARD') return;
    const eventType = data.eventType === 'keyup' ? 'keyup' : 'keydown';
    const init = {
      key: data.key || '',
      code: data.code || '',
      bubbles: true,
      cancelable: true,
      repeat: Boolean(data.repeat),
      altKey: Boolean(data.altKey),
      ctrlKey: Boolean(data.ctrlKey),
      metaKey: Boolean(data.metaKey),
      shiftKey: Boolean(data.shiftKey),
    };
    window.dispatchEvent(new KeyboardEvent(eventType, init));
    document.dispatchEvent(new KeyboardEvent(eventType, init));
  });
  window.addEventListener('load', () => {
    document.querySelectorAll('canvas').forEach((canvas) => {
      canvas.tabIndex = 0;
      canvas.style.touchAction = 'none';
    });
    const target = document.querySelector('canvas,[data-game-root],[data-testid="game-canvas"],button');
    if (target) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '0');
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    }
  });
})();
</script>`;
  if (html.includes('id="aiya-create-runtime-guard"')) return html;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}\n${script}\n</head>`);
  }
  return `${style}\n${script}\n${html}`;
}

async function replaceAsync(value, regex, replacer) {
  const parts = [];
  let lastIndex = 0;
  for (const match of value.matchAll(regex)) {
    parts.push(value.slice(lastIndex, match.index));
    parts.push(await replacer(...match));
    lastIndex = match.index + match[0].length;
  }
  parts.push(value.slice(lastIndex));
  return parts.join('');
}

async function runCommand(command, args, options) {
  const logPath = options.logPath;
  if (logPath) {
    await fs.writeFile(
      logPath,
      [
        `cwd=${options.cwd}`,
        `command=${command} ${args.join(' ')}`,
        `timeoutMs=${options.timeoutMs}`,
        '',
      ].join('\n'),
      'utf8',
    );
  }
  const appendLog = (chunk) => {
    if (!logPath || !chunk) return;
    void fs.appendFile(logPath, chunk, 'utf8').catch(() => {});
  };
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let lastProgressAt = 0;
    const emitProgress = (force = false) => {
      if (typeof options.onProgress !== 'function') return;
      const now = Date.now();
      if (!force && now - lastProgressAt < 5_000) return;
      lastProgressAt = now;
      const outputLines = publicOutputLines(output);
      const workspaceLines = publicWorkspaceLines(options.cwd);
      options.onProgress({
        elapsedMs: now - startedAt,
        outputBytes: Buffer.byteLength(output, 'utf8'),
        rawStreamText: publicRawStreamText(output),
        streamLines: outputLines,
        workspaceLines,
      });
    };
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env || {}) },
    });
    let output = '';
    let settled = false;
    const progressTimer = setInterval(() => emitProgress(), 5_000);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearInterval(progressTimer);
      const timeoutText = `\n${command} timed out after ${options.timeoutMs}ms. Process tree will be killed.`;
      output += timeoutText;
      appendLog(timeoutText);
      const timeoutError = new Error(`${command} timed out after ${options.timeoutMs}ms. Log: ${logPath || 'not captured'}. Output tail: ${tail(output, 2000)}`);
      try { child.kill('SIGKILL'); } catch {}
      void killProcessTree(child.pid);
      reject(timeoutError);
    }, options.timeoutMs);
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      appendLog(text);
      emitProgress();
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      appendLog(text);
      emitProgress();
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(progressTimer);
      reject(error);
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(progressTimer);
      emitProgress(true);
      if (code === 0) resolve({ output, code });
      else reject(new Error(`${command} exited with ${code}: ${tail(output, 2000)}`));
    });
    child.stdin.write(options.input || '');
    child.stdin.end();
  });
}


function publicOutputLines(output) {
  const cleaned = stripAnsi(String(output || ''))
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => sanitizePublicLogLine(line))
    .filter(Boolean);
  const useful = cleaned.filter((line) => /\b(file|write|edit|patch|update|create|src\/|app\/|index\.|package\.|test|build|lint|typecheck|error|failed|passed|running|codex|npm|pnpm|vite)\b|\$|\+{3}|-{3}|@@/i.test(line));
  const source = useful.length >= 4 ? useful : cleaned;
  return dedupeTail(source, 16);
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}


function publicRawStreamText(output) {
  const raw = stripAnsi(String(output || ''))
    .replace(/\r(?!\n)/g, '\n')
    .split('\n')
    .map((line) => sanitizeRawLogLine(line))
    .join('\n')
    .trimEnd();
  return tail(raw, 12000);
}

function sanitizeRawLogLine(line) {
  const value = String(line || '');
  if (/api[_-]?key|authorization|bearer\s+|password|secret|token/i.test(value)) {
    return '[redacted sensitive log line]';
  }
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function sanitizePublicLogLine(line) {
  const compact = String(line || '').replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  if (/api[_-]?key|authorization|bearer\s+|password|secret|token/i.test(compact)) {
    return '[redacted sensitive log line]';
  }
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

function dedupeTail(lines, maxLines) {
  const result = [];
  for (const line of lines.slice(-maxLines * 3)) {
    if (result[result.length - 1] === line) continue;
    result.push(line);
  }
  return result.slice(-maxLines);
}


function mergeStreamLines(outputLines, workspaceLines) {
  const merged = [...(outputLines || []), ...(workspaceLines || [])].filter(Boolean);
  return dedupeTail(merged, 18);
}

function publicWorkspaceLines(cwd) {
  if (!cwd) return [];
  try {
    const files = collectWorkspaceFiles(cwd)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, 3);
    const lines = [];
    for (const file of files) {
      const rel = path.relative(cwd, file.path).replace(/\\/g, '/');
      lines.push(`[file] ${rel}`);
      const content = fsSync.readFileSync(file.path, 'utf8');
      const snippet = content
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.trim() && !/^\/\/\s*$/.test(line.trim()))
        .slice(-8)
        .map((line) => sanitizePublicLogLine(line));
      for (const line of snippet) lines.push(`  ${line}`);
    }
    return lines;
  } catch {
    return [];
  }
}

function collectWorkspaceFiles(root) {
  const results = [];
  const allowed = /\.(tsx?|jsx?|css|html|json)$/i;
  const skipDirs = new Set(['node_modules', 'dist', 'build', '.git', '.next', 'coverage', 'artifacts']);
  const skipFiles = /(^pnpm-lock\.yaml$|^package-lock\.json$|CodexRun-\d+\.log$)/i;
  const visit = (dir, depth) => {
    if (depth > 5 || results.length > 80) return;
    let entries = [];
    try {
      entries = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) visit(path.join(dir, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile() || skipFiles.test(entry.name) || !allowed.test(entry.name)) continue;
      const filePath = path.join(dir, entry.name);
      try {
        const stat = fsSync.statSync(filePath);
        if (stat.size > 180_000) continue;
        results.push({ path: filePath, mtimeMs: stat.mtimeMs });
      } catch {
        // ignore disappearing files
      }
    }
  };
  visit(root, 0);
  return results;
}

async function runShell(command, options) {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: options.cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...(options.env || {}) },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      stderr += `\nCommand timed out after ${options.timeoutMs}ms`;
      void killProcessTree(child.pid).finally(() => {
        setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve({ code: 1, stdout, stderr, output: `${stdout}\n${stderr}` });
        }, 1000);
      });
    }, options.timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, output: `${stdout}\n${stderr}` });
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}`, output: `${stdout}\n${stderr}\n${error.message}` });
    });
  });
}

async function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve) => {
      const script = [
        `$root=${Number(pid)};`,
        '$all=Get-CimInstance Win32_Process;',
        '$ids=New-Object System.Collections.Generic.HashSet[int];',
        '$queue=New-Object System.Collections.Generic.Queue[int];',
        '$queue.Enqueue($root);',
        'while($queue.Count -gt 0){',
        '  $current=$queue.Dequeue();',
        '  if($ids.Add($current)){',
        '    $all | Where-Object { $_.ParentProcessId -eq $current } | ForEach-Object { $queue.Enqueue([int]$_.ProcessId) }',
        '  }',
        '}',
        '$ordered=@($ids); [array]::Reverse($ordered);',
        'foreach($id in $ordered){ Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }',
      ].join(' ');
      const killer = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        stdio: 'ignore',
        shell: false,
      });
      const timer = setTimeout(() => {
        try { killer.kill('SIGKILL'); } catch {}
        resolve();
      }, 5_000);
      killer.on('exit', () => { clearTimeout(timer); resolve(); });
      killer.on('error', () => { clearTimeout(timer); resolve(); });
    });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

async function safeRead(filePath) {
  try { return await fs.readFile(filePath, 'utf8'); } catch { return ''; }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function inferCodexModel(output) {
  const match = /model:\s*([^\s\r\n]+)/i.exec(output || '');
  return match?.[1] ? `codex-cli/${match[1]}` : '';
}

function inferTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 80) || '';
}

function inferTitleFromPrompt(prompt) {
  let title = String(prompt || 'AIYA Game Demo').trim();
  for (const prefix of ['做一个', '生成一个', '帮我做一个']) {
    if (title.startsWith(prefix)) title = title.slice(prefix.length).trim();
  }
  return title.slice(0, 80) || 'AIYA Game Demo';
}

function diagnosisHint(failures) {
  const text = failures.join('\n').toLowerCase();
  if (text.includes('typecheck')) return 'Likely TypeScript or import error. Fix types and rerun typecheck.';
  if (text.includes('lint')) return 'Likely ESLint violation. Remove unused variables and avoid any.';
  if (text.includes('smoke')) return 'Likely browser runtime issue. Check canvas lifecycle, event listeners, and console errors.';
  if (text.includes('build')) return 'Likely Vite build/import path issue.';
  return 'Read the first failing command and patch the smallest root cause.';
}

function tail(value, maxLength) {
  const text = String(value || '');
  return text.length > maxLength ? text.slice(-maxLength) : text;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
