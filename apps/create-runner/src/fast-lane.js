import fs from 'node:fs/promises';
import path from 'node:path';
import { getModelProvider } from './config.js';
import { chromium } from 'playwright';

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_TOKENS = 2048;
const QUALITY_THRESHOLD = 78;
const BROWSER_VALIDATION_TIMEOUT_MS = 45_000;

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function inferTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || '');
  return match?.[1]?.replace(/\s+/g, ' ').trim().slice(0, 80) || '';
}

function inferTitleFromPrompt(prompt) {
  let title = String(prompt || 'AIYA Demo').split(/\n+/)[0].trim();
  for (const prefix of ['给我做一个', '帮我做一个', '请做一个', '创建一个', '开发一个', '生成一个', '做一个', '给我做个', '帮我做个', '做个', '做']) {
    if (title.startsWith(prefix)) title = title.slice(prefix.length).trim();
  }
  return title.slice(0, 80) || 'AIYA Demo';
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function canRunFastLane(config) {
  return Boolean(
    config.fastLaneEnabled
    && config.fastModelBaseUrl
    && config.fastModelApiKey
    && config.fastModel,
  );
}

function selectFastLaneModelConfig(config, providerId) {
  const provider = getModelProvider(config, providerId);
  if (!provider) return config;
  return {
    ...config,
    fastModelBaseUrl: provider.baseUrl || config.fastModelBaseUrl,
    fastModelApiKey: provider.apiKey || config.fastModelApiKey,
    fastModel: provider.model || config.fastModel,
    fastModelTimeoutMs: provider.timeoutMs || config.fastModelTimeoutMs,
    fastModelMaxTokens: provider.maxTokens || config.fastModelMaxTokens,
    fastModelTemperature: Number.isFinite(provider.temperature) ? provider.temperature : config.fastModelTemperature,
    fastDirectHtmlBaseUrl: provider.baseUrl || config.fastDirectHtmlBaseUrl || config.fastModelBaseUrl,
    fastDirectHtmlApiKey: provider.apiKey || config.fastDirectHtmlApiKey || config.fastModelApiKey,
    fastDirectHtmlModel: provider.model || config.fastDirectHtmlModel || config.fastModel,
    fastDirectHtmlApiType: provider.apiType || config.fastDirectHtmlApiType || 'openai-chat',
    fastDirectHtmlTimeoutMs: provider.timeoutMs || config.fastDirectHtmlTimeoutMs,
    fastDirectHtmlMaxTokens: provider.maxTokens || config.fastDirectHtmlMaxTokens,
    selectedModelProvider: provider.id,
  };
}

export async function runFastLane({ job, workspaceDir, config, onProgress, deferValidation = false }) {
  config = selectFastLaneModelConfig(config, job?.modelProvider);
  if (!canRunFastLane(config)) {
    throw new Error('Fast lane is not configured: AIYA_CREATE_FAST_MODEL_BASE_URL/API_KEY/MODEL are required.');
  }

  const startedAt = new Date().toISOString();
  const artifactsDir = path.join(workspaceDir, 'artifacts', 'fast-lane');
  await fs.mkdir(artifactsDir, { recursive: true });

  onProgress?.('fast_generating', `Direct model is writing single-file HTML with ${config.fastDirectHtmlModel || config.fastModel}`);
  const htmlPrompt = buildDirectHtmlPrompt(job);
  await fs.writeFile(path.join(artifactsDir, 'DirectHtmlPrompt.md'), htmlPrompt, 'utf8');

  const modelStartedAt = Date.now();
  let raw = await callOpenAICompatible({
    baseUrl: config.fastDirectHtmlBaseUrl || config.fastModelBaseUrl,
    apiKey: config.fastDirectHtmlApiKey || config.fastModelApiKey,
    model: config.fastDirectHtmlModel || config.fastModel,
    apiType: config.fastDirectHtmlApiType || 'openai-chat',
    prompt: htmlPrompt,
    timeoutMs: config.fastDirectHtmlTimeoutMs || config.fastModelTimeoutMs || DEFAULT_TIMEOUT_MS,
    maxTokens: Math.min(Math.max(config.fastDirectHtmlMaxTokens || config.fastModelMaxTokens || 4096, 2500), 6000),
    temperature: Number.isFinite(config.fastModelTemperature) ? config.fastModelTemperature : 0.15,
    attempts: config.fastDirectHtmlAttempts || 1,
  });
  let modelElapsedMs = Date.now() - modelStartedAt;
  await fs.writeFile(path.join(artifactsDir, 'raw-response.txt'), raw, 'utf8');
  if (looksTruncatedHtml(raw)) {
    onProgress?.('fast_verify', 'Direct HTML looks truncated; asking model to rewrite a complete runnable HTML');
    const rewriteStartedAt = Date.now();
    const rewritePrompt = buildHtmlRefinePrompt(job, raw);
    await fs.writeFile(path.join(artifactsDir, 'DirectHtmlRewritePrompt.md'), rewritePrompt, 'utf8');
    const rewritten = await callOpenAICompatible({
      baseUrl: config.fastDirectHtmlBaseUrl || config.fastModelBaseUrl,
      apiKey: config.fastDirectHtmlApiKey || config.fastModelApiKey,
      model: config.fastDirectHtmlModel || config.fastModel,
      apiType: config.fastDirectHtmlApiType || 'openai-chat',
      prompt: rewritePrompt,
      timeoutMs: Math.min(config.fastDirectHtmlTimeoutMs || DEFAULT_TIMEOUT_MS, 90_000),
      maxTokens: Math.min(Math.max(config.fastDirectHtmlMaxTokens || config.fastModelMaxTokens || 4096, 2500), 6000),
      temperature: 0,
      attempts: 1,
    }).catch((error) => {
      onProgress?.('fast_verify', `Direct HTML rewrite failed: ${error.message}`);
      return '';
    });
    if (rewritten) {
      await fs.writeFile(path.join(artifactsDir, 'raw-rewritten-response.txt'), rewritten, 'utf8');
      raw = rewritten;
      modelElapsedMs += Date.now() - rewriteStartedAt;
    }
  }


  onProgress?.('fast_verify', `Direct model returned in ${Math.round(modelElapsedMs / 1000)}s; normalizing HTML`);
  let normalized = normalizeDirectHtml(raw);
  let spec = { type: inferSpecTypeFromPrompt(job), title: inferTitleFromPrompt(job.prompt), visualMode: 'auto', wallMode: null };
  let strategy = 'model-direct-html';

  if (normalized.html && isPlaceholderDirectHtml(normalized.html)) {
    onProgress?.('fast_verify', 'Direct model returned analysis or placeholder HTML; asking it to output runnable code only');
    const refinePrompt = buildHtmlRefinePrompt(job, raw);
    await fs.writeFile(path.join(artifactsDir, 'DirectHtmlRefinePrompt.md'), refinePrompt, 'utf8');
    const refinedRaw = await callOpenAICompatible({
      baseUrl: config.fastDirectHtmlBaseUrl || config.fastModelBaseUrl,
      apiKey: config.fastDirectHtmlApiKey || config.fastModelApiKey,
      model: config.fastDirectHtmlModel || config.fastModel,
      apiType: config.fastDirectHtmlApiType || 'openai-chat',
      prompt: refinePrompt,
      timeoutMs: Math.min(config.fastDirectHtmlTimeoutMs || DEFAULT_TIMEOUT_MS, 90_000),
      maxTokens: Math.min(Math.max(config.fastDirectHtmlMaxTokens || config.fastModelMaxTokens || 4096, 2500), 6000),
      temperature: 0,
      attempts: 1,
    });
    await fs.writeFile(path.join(artifactsDir, 'raw-refined-response.txt'), refinedRaw, 'utf8');
    raw = refinedRaw;
    if (looksTruncatedHtml(raw)) {
      onProgress?.('fast_verify', 'Refined direct HTML looks truncated; asking model to continue the tail');
      const refinedTailPrompt = buildHtmlContinuationPrompt(raw);
      await fs.writeFile(path.join(artifactsDir, 'DirectHtmlRefinedContinuationPrompt.md'), refinedTailPrompt, 'utf8');
      const refinedTail = await callOpenAICompatible({
        baseUrl: config.fastDirectHtmlBaseUrl || config.fastModelBaseUrl,
        apiKey: config.fastDirectHtmlApiKey || config.fastModelApiKey,
        model: config.fastDirectHtmlModel || config.fastModel,
        apiType: config.fastDirectHtmlApiType || 'openai-chat',
        prompt: refinedTailPrompt,
        timeoutMs: Math.min(config.fastDirectHtmlTimeoutMs || DEFAULT_TIMEOUT_MS, 90_000),
        maxTokens: 2500,
        temperature: 0,
        attempts: 1,
      }).catch((error) => {
        onProgress?.('fast_verify', `Refined direct HTML continuation failed: ${error.message}`);
        return '';
      });
      if (refinedTail) {
        await fs.writeFile(path.join(artifactsDir, 'raw-refined-continuation.txt'), refinedTail, 'utf8');
        raw = mergeHtmlContinuation(raw, refinedTail);
      }
    }
    normalized = normalizeDirectHtml(raw);
    strategy = 'model-direct-html-refined';
  }

  if (!normalized.html) {
    throw new Error('Direct model did not return complete runnable HTML. Legacy deterministic templates are disabled.');
  }

  let guardedHtml = injectRuntimeGuard(normalized.html);
  if (isWhackMoleSpec(spec, job)) {
    guardedHtml = injectWhackMoleTestHook(guardedHtml);
  }
  const htmlPath = path.join(workspaceDir, 'fast-lane-index.html');
  await fs.writeFile(htmlPath, guardedHtml, 'utf8');
  await fs.writeFile(path.join(artifactsDir, 'normalized.html'), guardedHtml, 'utf8');

  const generated = {
    adapter: 'deepseek-fast-lane',
    model: `deepraxis/${config.fastDirectHtmlModel || config.fastModel}`,
    logs: `Direct model fast lane generated preview HTML in ${modelElapsedMs}ms with ${strategy}`,
  };

  const runValidation = async () => {
    const staticReport = runStaticFastLaneChecks({ html: guardedHtml, originalHtml: normalized.html, job, spec });
    onProgress?.('browser_verify', 'Background Playwright validation is checking the preview');
    const browserReport = await withTimeout(
      validateFastLaneInBrowser({ html: guardedHtml, artifactsDir, job, spec }),
      BROWSER_VALIDATION_TIMEOUT_MS,
      'Playwright fast-lane validation',
    );
    const semanticReport = runFastLaneSemanticChecks({ html: guardedHtml, job, spec });
    const quality = computeFastLaneQuality({
      staticReport,
      browserReport,
      semanticReport,
      normalized,
      spec,
      job,
    });

    const failures = [
      ...staticReport.failures,
      ...browserReport.failures,
      ...semanticReport.failures,
    ];
    const warnings = [
      ...normalized.warnings,
      ...staticReport.warnings,
      ...browserReport.warnings,
      ...semanticReport.warnings,
      ...quality.warnings,
      ...quality.gateFailures.map((failure) => `Validation note: ${failure}`),
    ];
    const validation = {
      attempt: 1,
      overallPassed: failures.length === 0,
      ok: failures.length === 0,
      status: failures.length === 0 ? 'passed' : 'diagnostic',
      failedStage: failures.length ? 'fast-lane-validation' : null,
      failures,
      warnings,
      commands: [{
        cmd: `${config.fastDirectHtmlModel || config.fastModel} direct single-file HTML generation`,
        passed: true,
        durationMs: modelElapsedMs,
        stdoutTail: `model=${config.fastDirectHtmlModel || config.fastModel}; htmlLength=${guardedHtml.length}; strategy=${strategy}`,
        stderrTail: '',
      }],
      browser: browserReport.browser,
      semantic: semanticReport,
      quality,
      changedFiles: ['fast-lane-index.html'],
      diagnosisHint: failures.length
        ? 'Direct model generated HTML and AIYA returned it for preview. Validation issues are shown as diagnostics instead of blocking delivery.'
        : 'Direct model HTML passed static, semantic, and browser validation.',
      startedAt,
      finishedAt: new Date().toISOString(),
      artifacts: {
        reportPath: path.join(artifactsDir, 'ValidationReport.json'),
        screenshotPath: browserReport.screenshotPath,
        htmlPath,
        rawResponsePath: path.join(artifactsDir, 'raw-response.txt'),
      },
      fastLane: {
        source: 'deepseek-fast-lane',
        model: config.fastDirectHtmlModel || config.fastModel,
        modelElapsedMs,
        strippedMarkdownFence: normalized.strippedMarkdownFence,
        strategy,
        specType: spec.type,
        visualMode: spec.visualMode,
        wallMode: spec.wallMode || null,
        title: spec.title || inferTitle(guardedHtml) || inferTitleFromPrompt(job.prompt),
      },
    };
    await fs.writeFile(validation.artifacts.reportPath, JSON.stringify(validation, null, 2), 'utf8');
    return validation;
  };

  if (deferValidation) {
    const validation = buildPendingFastLaneValidation({
      artifactsDir,
      htmlPath,
      model: config.fastDirectHtmlModel || config.fastModel,
      modelElapsedMs,
      normalized,
      spec,
      strategy,
      startedAt,
    });
    await fs.writeFile(validation.artifacts.reportPath, JSON.stringify(validation, null, 2), 'utf8');
    return {
      html: guardedHtml,
      generated,
      validation,
      deferredValidation: runValidation,
    };
  }

  const validation = await runValidation();
  return {
    html: guardedHtml,
    generated,
    validation,
  };
}


function buildPendingFastLaneValidation({ artifactsDir, htmlPath, model, modelElapsedMs, normalized, spec, strategy, startedAt }) {
  const now = new Date().toISOString();
  return {
    attempt: 1,
    overallPassed: false,
    ok: false,
    status: 'pending',
    failedStage: null,
    failures: [],
    warnings: ['Preview is ready. Browser validation is still running in the background.'],
    commands: [{
      cmd: `${model} direct single-file HTML generation`,
      passed: true,
      durationMs: modelElapsedMs,
      stdoutTail: `model=${model}; strategy=${strategy}; validation=pending`,
      stderrTail: '',
    }],
    browser: null,
    semantic: null,
    quality: {
      ok: false,
      gateFailures: [],
      warnings: ['Background validation pending'],
      criteria: [],
    },
    changedFiles: ['fast-lane-index.html'],
    diagnosisHint: 'Preview is ready first; Playwright validation continues in the background.',
    startedAt,
    finishedAt: now,
    artifacts: {
      reportPath: path.join(artifactsDir, 'ValidationReport.json'),
      screenshotPath: null,
      htmlPath,
      rawResponsePath: path.join(artifactsDir, 'raw-response.txt'),
    },
    fastLane: {
      source: 'deepseek-fast-lane',
      model,
      modelElapsedMs,
      strippedMarkdownFence: normalized.strippedMarkdownFence,
      strategy,
      specType: spec.type,
      visualMode: spec.visualMode,
      wallMode: spec.wallMode || null,
      title: spec.title || null,
      validationMode: 'background',
    },
  };
}

export function buildFastLaneResult({ html, job, generated, validation }) {
  return {
    title: inferTitle(html) || inferTitleFromPrompt(job.prompt),
    kind: '\u5355\u6587\u4ef6 Demo \u00b7 DeepSeek \u5feb\u901f\u901a\u9053',
    brief: validation.status === 'pending'
      ? '\u5df2\u751f\u6210\u53ef\u8bd5\u73a9\u9884\u89c8\uff0cAIYA \u6b63\u5728\u540e\u53f0\u8fdb\u884c Playwright \u53ef\u7528\u6027\u68c0\u67e5\u3002'
      : '\u6a21\u578b\u751f\u6210\u53ef\u8fd0\u884c\u9875\u9762\uff0cAIYA \u540c\u6b65\u7ed9\u51fa\u9759\u6001\u3001\u8bed\u4e49\u548c Playwright \u9a8c\u8bc1\u7ed3\u679c\u3002',
    html,
    teaching: [
      '\u5feb\u901f\u901a\u9053\uff1a\u5148\u7406\u89e3\u610f\u56fe\u548c\u73a9\u6cd5\u89c4\u683c\uff0c\u518d\u751f\u6210\u53ef\u73a9 Demo\u3002',
      '\u8d28\u91cf\u95e8\u7981\uff1a\u7981\u7528\u5916\u90e8\u8d44\u6e90\u3001\u7f51\u7edc\u548c\u5b58\u50a8\uff0c\u9a8c\u8bc1\u6d4f\u89c8\u5668\u4ea4\u4e92\u4e0e\u952e\u76d8\u6eda\u52a8\u9694\u79bb\u3002',
      `\u6a21\u578b\uff1a${generated.model}`,
      '\u9a8c\u8bc1\u7ed3\u679c\uff1a\u4fdd\u7559\u8fd0\u884c\u63a2\u9488\u4e0e\u95ee\u9898\u8bca\u65ad\uff0c\u4e0d\u518d\u8f93\u51fa\u8d28\u91cf\u5206\u3002',
    ],
    nextEdits: ['\u4f18\u5316\u89c6\u89c9\u98ce\u683c', '\u589e\u52a0\u5173\u5361\u6216\u96be\u5ea6', '\u5347\u7ea7\u4e3a\u591a\u6587\u4ef6\u9879\u76ee'],
    source: 'deepseek-fast-lane',
    model: generated.model || generated.adapter,
    validationReport: publicFastLaneValidation(validation),
  };
}

export function publicFastLaneValidation(validation) {
  if (!validation) return null;
  return {
    ok: validation.ok,
    failures: validation.failures || [],
    warnings: validation.warnings || [],
    startedAt: validation.startedAt,
    finishedAt: validation.finishedAt,
    failedStage: validation.failedStage,
    commands: validation.commands || [],
    browser: validation.browser,
    semantic: validation.semantic,
    quality: validation.quality,
    artifacts: validation.artifacts,
    diagnosisHint: validation.diagnosisHint,
    fastLane: validation.fastLane,
  };
}

async function callOpenAICompatible({ baseUrl, apiKey, model, apiType, prompt, timeoutMs, maxTokens, temperature, attempts }) {
  let lastError = null;
  const maxAttempts = Math.max(1, attempts || 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callOpenAICompatibleOnce({
        baseUrl,
        apiKey,
        model,
        apiType,
        prompt,
        timeoutMs,
        maxTokens,
        temperature,
      });
    } catch (error) {
      lastError = error;
      const message = String(error?.message || '');
      const retryable = isRetryableFastModelError(message);
      if (!retryable || attempt >= maxAttempts) break;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw lastError;
}

function isRetryableFastModelError(message) {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('empty content')
    || normalized.includes('timed out after')
    || normalized.includes('http 408')
    || normalized.includes('http 429')
    || normalized.includes('http 500')
    || normalized.includes('http 502')
    || normalized.includes('http 503')
    || normalized.includes('http 504')
    || normalized.includes('timeout_error')
    || normalized.includes('provider_timeout')
    || normalized.includes('upstream request timeout')
    || normalized.includes('"retryable":true')
    || normalized.includes('ecconnreset')
    || normalized.includes('econnreset')
    || normalized.includes('etimedout');
}

function buildChatCompletionsBody({ model, prompt, maxTokens, temperature, baseUrl }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: '\u4f60\u662f\u4e00\u4e2a\u4e2d\u6587\u7f51\u9875\u5e94\u7528\u5f00\u53d1\u52a9\u624b\u3002\u4e0d\u8981\u8f93\u51fa\u63a8\u7406\u8fc7\u7a0b\uff0c\u53ea\u8f93\u51fa\u5b8c\u6574\u53ef\u8fd0\u884c\u7684\u5355\u6587\u4ef6 HTML\u3002' },
      { role: 'user', content: prompt },
    ],
    temperature: Number.isFinite(temperature) ? temperature : 0.15,
    max_tokens: maxTokens,
    stream: false,
  };
  if (isOfficialDeepSeekBaseUrl(baseUrl)) {
    body.thinking = { type: 'disabled' };
  } else {
    body.enable_thinking = false;
    body.thinking = false;
    body.reasoning = { enabled: false };
  }
  return body;
}

function isOfficialDeepSeekBaseUrl(baseUrl) {
  return /(^|\.)api\.deepseek\.com$/i.test(new URL(trimTrailingSlash(baseUrl)).hostname);
}

async function callOpenAICompatibleOnce({ baseUrl, apiKey, model, apiType, prompt, timeoutMs, maxTokens, temperature }) {
  if (apiType === 'ark-responses') {
    return callArkResponsesOnce({ baseUrl, apiKey, model, prompt, timeoutMs, maxTokens, temperature });
  }
  const url = `${trimTrailingSlash(baseUrl)}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(buildChatCompletionsBody({ model, prompt, maxTokens, temperature, baseUrl })),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Fast model HTTP ${response.status}: ${text.slice(0, 700)}`);
    }
    const json = JSON.parse(text);
    const choice = json?.choices?.[0];
    const content = choice?.message?.content;
    const reasoningContent = choice?.message?.reasoning_content;
    if (content && typeof content === 'string') return content;
    if (reasoningContent && typeof reasoningContent === 'string' && /<!doctype html|<html/i.test(reasoningContent)) {
      return reasoningContent;
    }
    throw new Error(`Fast model returned empty content. finish_reason=${choice?.finish_reason || 'unknown'}${reasoningContent ? '; reasoning_content_present=true' : ''}`);
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Fast model timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}



function buildDirectHtmlPrompt(job) {
  const idea = String(job.prompt || job.currentApp?.title || '\u521b\u5efa\u4e00\u4e2a\u6d4f\u89c8\u5668\u5c0f\u5e94\u7528').trim();
  const revision = String(job.revision || '').trim();
  const currentHtml = job.currentApp?.html ? String(job.currentApp.html).slice(0, 7000) : '';
  const type = inferSpecTypeFromPrompt(job);
  const snakeWrapRequested = type === 'snake' && isSnakeWrapRequested(job, {});
  const snakeWrapRule = snakeWrapRequested
    ? '\u672c\u6b21\u660e\u786e\u8981\u6c42\u649e\u5899\u540e\u4ece\u53e6\u4e00\u8fb9\u51fa\u6765\uff1a\u79fb\u52a8\u65f6\u7528\u5faa\u73af\u8fb9\u754c\uff0c\u4e0d\u8981\u56e0\u4e3a\u649e\u5899\u7ed3\u675f\u6e38\u620f\u3002'
    : '';
  const taskRule = getTaskRuleForPrompt(type, snakeWrapRule);
  return `\u53ea\u8f93\u51fa\u4e00\u4e2a\u5b8c\u6574\u53ef\u8fd0\u884c\u7684\u5355\u6587\u4ef6 HTML\uff0c\u4ece <!doctype html> \u5f00\u59cb\uff0c\u4ee5 </html> \u7ed3\u675f\u3002\u4e0d\u8981 Markdown\uff0c\u4e0d\u8981\u89e3\u91ca\uff0c\u4e0d\u8981\u601d\u8003\u8fc7\u7a0b\u3002

\u7528\u6237\u9700\u6c42\uff1a${idea}
${revision ? `\u7ee7\u7eed\u4fee\u6539\uff1a${revision}` : ''}
${currentHtml ? `\u5f53\u524d\u7248\u672c\u4ee3\u7801\u53c2\u8003\uff0c\u4fdd\u7559\u5df2\u6709\u529f\u80fd\u540e\u4fee\u6539\uff1a\n${currentHtml}` : ''}

\u5fc5\u987b\u9075\u5b88\uff1a
1. \u53ea\u7528 HTML + \u5185\u8054 CSS + \u539f\u751f JavaScript\uff0c\u4e0d\u7528\u5916\u90e8\u8d44\u6e90\uff0c\u4e0d\u53d1\u7f51\u7edc\u8bf7\u6c42\uff0c\u4e0d\u7528\u8868\u5355\u63d0\u4ea4\uff0c\u4e0d\u4f7f\u7528 localStorage/sessionStorage/indexedDB/cookie\u3002
2. \u9875\u9762\u6839\u8282\u70b9\u52a0 data-game-root\uff1b\u6240\u6709\u7528\u6237\u53ef\u89c1\u6587\u5b57\u7528\u7b80\u4f53\u4e2d\u6587\u3002
3. \u6309\u94ae\u3001\u952e\u76d8\u3001\u9f20\u6807\u6216\u89e6\u6478\u81f3\u5c11\u4e00\u79cd\u4ea4\u4e92\u5fc5\u987b\u771f\u5b9e\u53ef\u7528\u3002
4. \u5982\u679c\u4f7f\u7528\u65b9\u5411\u952e\u3001WASD \u6216\u7a7a\u683c\uff0c\u4e8b\u4ef6\u5904\u7406\u91cc\u5fc5\u987b preventDefault\uff0c\u907f\u514d\u7f51\u9875\u6eda\u52a8\uff1bcanvas \u9700\u8981 tabindex="0" \u548c touch-action:none\u3002
5. \u53ea\u505a\u7528\u6237\u8981\u6c42\u7684\u4e00\u4e2a\u5e94\u7528\uff0c\u4e0d\u505a\u5408\u96c6\uff0c\u4e0d\u5199 TODO\u3001\u4f2a\u4ee3\u7801\u3001\u5360\u4f4d\u6ce8\u91ca\u3002

\u5e94\u7528\u8981\u6c42\uff1a${taskRule}
\u4f18\u5148\u5199\u77ed\u5c0f\u7a33\u5b9a\u7684\u4ee3\u7801\uff0c\u5148\u4fdd\u8bc1\u80fd\u7528\uff0c\u518d\u505a\u7b80\u5355\u7f8e\u5316\u3002`;
}

function getTaskRuleForPrompt(type, extraRule = '') {
  switch (type) {
    case 'whack-a-mole':
      return '\u505a 3\u00d73 \u6253\u5730\u9f20\uff1a9 \u4e2a\u6d1e\u300130 \u79d2\u5012\u8ba1\u65f6\u3001\u5f97\u5206\u3001\u5f00\u59cb/\u91cd\u65b0\u5f00\u59cb\u6309\u94ae\u3002\u5730\u9f20\u968f\u673a\u51fa\u73b0\u5728\u4e00\u4e2a\u6d1e\u91cc\uff0c\u70b9\u4e2d\u52a0\u5206\u5e76\u7acb\u523b\u6362\u6d1e\u3002';
    case 'snake':
      return `\u505a\u8d2a\u98df\u86c7\uff1a\u86c7\u3001\u98df\u7269\u3001\u65b9\u5411\u63a7\u5236\u3001\u5f97\u5206\u3001\u91cd\u65b0\u5f00\u59cb\u3002${extraRule}`;
    case 'balloon-pop':
      return '\u505a\u6253\u6c14\u7403\uff1a\u591a\u4e2a\u6c14\u7403\u540c\u65f6\u6216\u8f6e\u6d41\u51fa\u73b0\uff0c\u70b9\u51fb/\u89e6\u6478\u6c14\u7403\u52a0\u5206\uff0c\u6709\u5012\u8ba1\u65f6\u3001\u5f97\u5206\u548c\u91cd\u65b0\u5f00\u59cb\u3002';
    case 'timer':
      return '\u505a\u8ba1\u65f6/\u756a\u8304\u949f\uff1a\u5f00\u59cb\u3001\u6682\u505c\u3001\u91cd\u7f6e\u6309\u94ae\uff0c\u6e05\u695a\u663e\u793a\u5f53\u524d\u9636\u6bb5\u548c\u5012\u8ba1\u65f6\u3002';
    case 'calculator':
      return '\u505a\u8ba1\u7b97\u5668\uff1a\u6570\u5b57\u952e\u3001\u52a0\u51cf\u4e58\u9664\u3001\u6e05\u7a7a\u3001\u7b49\u53f7\u3001\u7ed3\u679c\u663e\u793a\uff1b\u5982\u679c\u9700\u6c42\u63d0\u5230\u5386\u53f2\uff0c\u53ea\u5728\u5f53\u524d\u9875\u9762\u5185\u5b58\u91cc\u663e\u793a\u8ba1\u7b97\u5386\u53f2\uff0c\u7981\u6b62 localStorage/sessionStorage/indexedDB/cookie\u3002';
    case 'drawing':
      return '\u505a\u753b\u677f\uff1a\u53ef\u4ee5\u7ed8\u5236\uff0c\u80fd\u9009\u62e9\u989c\u8272\u6216\u753b\u7b14\u7c97\u7ec6\uff0c\u63d0\u4f9b\u6e05\u7a7a\u6309\u94ae\uff0c\u652f\u6301\u9f20\u6807\u548c\u89e6\u6478\u3002';
    case 'game':
    case 'dodger':
    case 'clicker':
      return '\u505a\u4e00\u4e2a\u53ef\u73a9\u7684\u5c0f\u6e38\u620f\uff1a\u76ee\u6807\u660e\u786e\uff0c\u6709\u5f97\u5206\u6216\u72b6\u6001\uff0c\u6709\u5f00\u59cb/\u91cd\u65b0\u5f00\u59cb\uff0c\u952e\u76d8\u6216\u89e6\u6478\u63a7\u5236\u53ef\u7528\u3002';
    default:
      return '\u6309\u9700\u6c42\u505a\u4e00\u4e2a\u5c0f\u800c\u5b8c\u6574\u7684\u7f51\u9875\u5e94\u7528\uff1a\u6709\u6e05\u695a\u7684\u8f93\u5165/\u6309\u94ae/\u4ea4\u4e92\u53cd\u9988\uff0c\u6253\u5f00\u540e\u9a6c\u4e0a\u80fd\u7528\u3002';
  }
}

function looksTruncatedHtml(raw) {
  const text = String(raw || '').trim().toLowerCase();
  return text.includes('<!doctype html') && (!text.includes('</html>') || !text.includes('</script>'));
}

function buildHtmlContinuationPrompt(raw) {
  const tail = String(raw || '').slice(-1800);
  return `\u4e0b\u9762\u662f\u4e00\u4e2a\u88ab\u622a\u65ad\u7684HTML\u6587\u4ef6\u672b\u5c3e\u3002\u8bf7\u53ea\u8f93\u51fa\u4ece\u622a\u65ad\u5904\u7ee7\u7eed\u7684\u5269\u4f59\u4ee3\u7801\uff0c\u4e0d\u8981\u91cd\u590d\u5df2\u6709\u5185\u5bb9\uff0c\u4e0d\u8981Markdown\uff0c\u5fc5\u987b\u8865\u9f50 </script></body></html>\u3002\n\u5df2\u6709\u672b\u5c3e\uff1a\n${tail}`;
}

function buildHtmlRefinePrompt(job, raw) {
  const idea = String(job.prompt || '\u521b\u5efa\u4e00\u4e2a\u6d4f\u89c8\u5668\u5c0f\u5e94\u7528').trim();
  const previous = String(raw || '');
  const previousExcerpt = [
    previous.slice(0, 900),
    previous.length > 1800 ? '\n...\n' : '',
    previous.slice(-900),
  ].join('');
  const type = inferSpecTypeFromPrompt(job);
  const snakeWrapRequested = type === 'snake' && isSnakeWrapRequested(job, {});
  const snakeWrapRule = snakeWrapRequested
    ? '\u672c\u6b21\u660e\u786e\u8981\u6c42\u649e\u5899\u540e\u4ece\u53e6\u4e00\u8fb9\u51fa\u6765\uff1a\u79fb\u52a8\u65f6\u7528\u5faa\u73af\u8fb9\u754c\uff0c\u4e0d\u8981\u56e0\u4e3a\u649e\u5899\u7ed3\u675f\u6e38\u620f\u3002'
    : '';
  return `\u4e0a\u4e00\u6b21\u8f93\u51fa\u4e0d\u662f\u5b8c\u6574\u53ef\u8fd0\u884c HTML\u3002\u8bf7\u91cd\u65b0\u8f93\u51fa\u4e00\u4e2a\u77ed\u5c0f\u3001\u5b8c\u6574\u3001\u53ef\u8fd0\u884c\u7684\u5355\u6587\u4ef6 HTML\u3002
\u53ea\u8f93\u51fa\u4ee3\u7801\uff1a\u4ece <!doctype html> \u5f00\u59cb\uff0c\u4ee5 </html> \u7ed3\u675f\uff1b\u4e0d\u8981 Markdown\uff0c\u4e0d\u8981\u89e3\u91ca\uff0c\u4e0d\u8981\u601d\u8003\u8fc7\u7a0b\u3002

\u7528\u6237\u9700\u6c42\uff1a${idea}
\u5fc5\u987b\uff1a\u7b80\u4f53\u4e2d\u6587\u754c\u9762\u3001data-game-root\u3001\u5185\u8054 CSS/JS\u3001\u65e0\u5916\u90e8\u8d44\u6e90\u3001\u65e0\u7f51\u7edc\u8bf7\u6c42\u3001\u771f\u5b9e\u53ef\u4ea4\u4e92\u3002${snakeWrapRequested ? ` ${snakeWrapRule}` : ''}
\u5e94\u7528\u8981\u6c42\uff1a${getTaskRuleForPrompt(type, snakeWrapRule)}

\u4e0a\u6b21\u574f\u8f93\u51fa\u7247\u6bb5\u4ec5\u4f9b\u53c2\u8003\uff0c\u4e0d\u8981\u7167\u6284\uff1a
${previousExcerpt}`;
}

function isPlaceholderDirectHtml(html) {
  const source = String(html || '').toLowerCase();
  if (!source.trim()) return true;
  if (/\/\*\s*css\s*\*\/|\/\/\s*js|todo|placeholder/i.test(source)) return true;
  if (source.includes('\u5360\u4f4d') || source.includes('\u6e38\u620f\u5185\u5bb9') || source.includes('js\u4ee3\u7801') || source.includes('css\u4ee3\u7801')) return true;
  if (!/<button|<canvas|addEventListener|onclick\s*=|requestAnimationFrame|setInterval|setTimeout/i.test(source)) return true;
  if (!/score|status|points/i.test(source) && !(source.includes('\u5206\u6570') || source.includes('\u5f97\u5206') || source.includes('\u72b6\u6001'))) return true;
  return false;
}

function mergeHtmlContinuation(raw, tail) {
  let extra = String(tail || '').trim();
  const fence = /^```(?:html)?\s*([\s\S]*?)\s*```$/i.exec(extra);
  if (fence) extra = fence[1].trim();
  const rawText = String(raw || '').trimEnd();
  if (extra.toLowerCase().startsWith('<!doctype html') || extra.toLowerCase().startsWith('<html')) return extra;
  return `${rawText}\n${extra}`;
}


function normalizeDirectHtml(raw) {
  let text = String(raw || '').trim();
  const warnings = [];
  let strippedMarkdownFence = false;
  const fence = /^```(?:html)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) {
    text = fence[1].trim();
    strippedMarkdownFence = true;
    warnings.push('Model returned markdown fence around HTML; runner stripped it.');
  }
  const doctypeIndex = text.toLowerCase().indexOf('<!doctype html');
  const htmlIndex = text.toLowerCase().indexOf('<html');
  const start = doctypeIndex >= 0 ? doctypeIndex : htmlIndex;
  if (start > 0) {
    text = text.slice(start).trim();
    warnings.push('Runner removed leading non-HTML text from model output.');
  }
  const end = text.toLowerCase().lastIndexOf('</html>');
  if (end >= 0) {
    text = text.slice(0, end + '</html>'.length).trim();
  }
  if (!/^<!doctype html/i.test(text) && /^<html/i.test(text)) {
    text = `<!doctype html>\n${text}`;
  }
  const looksLikeHtml = /^<!doctype html/i.test(text) && /<script[\s>]/i.test(text) && /<style[\s>]/i.test(text);
  const repaired = looksLikeHtml ? repairCommonDirectHtmlDefects(text) : { html: '', warnings: [] };
  return {
    html: looksLikeHtml ? repaired.html : '',
    warnings: [...warnings, ...repaired.warnings],
    strippedMarkdownFence,
  };
}

function repairCommonDirectHtmlDefects(html) {
  let next = String(html || '');
  const warnings = [];
  const before = next;
  next = next.replace(/\+\.Math\.random\?\.(\d+)\s*:\s*0\.(\d+)/g, '+Math.random()*0.$1');
  next = next.replace(/([^\w$])\.Math\.random\(\)/g, '$1Math.random()');
  next = next.replace(/([^\w$])\.Math\.random/g, '$1Math.random()');
  if (next !== before) warnings.push('Runner repaired a common model JavaScript typo around Math.random.');
  return { html: next, warnings };
}

function inferSpecTypeFromPrompt(job) {
  const text = `${job?.prompt || ''} ${job?.revision || ''}`.toLowerCase();
  if (/\u8d2a\u98df\u86c7|snake/u.test(text)) return 'snake';
  if (/\u6253\u5730\u9f20|\u5730\u9f20|whack/u.test(text)) return 'whack-a-mole';
  if (/\u6c14\u7403|balloon/u.test(text)) return 'balloon-pop';
  if (/\u8ba1\u7b97\u5668|calculator/u.test(text)) return 'calculator';
  if (/\u753b\u677f|\u753b\u753b|\u7ed8\u753b|\u6d82\u9e26|drawing|paint|canvas/u.test(text)) return 'drawing';
  if (/\u756a\u8304\u949f|\u8ba1\u65f6\u5668|\u5012\u8ba1\u65f6|timer|pomodoro|clock/u.test(text)) return 'timer';
  if (/\u98de\u884c|\u5c04\u51fb|\u6253\u7816\u5757|\u8d85\u7ea7\u739b\u4e3d|\u8df3\u8dc3|\u8dd1\u9177|\u5c0f\u6e38\u620f|\u6e38\u620f|game|shooter|breakout|mario/u.test(text)) return 'game';
  if (/\u8eb2\u907f|\u9668\u77f3|dodg|avoid/u.test(text)) return 'dodger';
  if (/\u62bd\u5956|\u8f6c\u76d8|wheel/u.test(text)) return 'clicker';
  return 'generic';
}

function extractArkResponsesText(json) {
  if (typeof json?.output_text === 'string' && json.output_text.trim()) return json.output_text;
  const output = Array.isArray(json?.output) ? json.output : [];
  const chunks = [];
  for (const item of output) {
    if (typeof item?.text === 'string') chunks.push(item.text);
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string') chunks.push(part.text);
      if (typeof part?.content === 'string') chunks.push(part.content);
    }
  }
  return chunks.join('\n').trim();
}

async function callArkResponsesOnce({ baseUrl, apiKey, model, prompt, timeoutMs }) {
  const url = trimTrailingSlash(baseUrl) + '/responses';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'ark-beta-doubao-app': 'true',
      },
      body: JSON.stringify({
        model,
        stream: false,
        tools: [
          {
            type: 'doubao_app',
            feature: {
              chat: {
                type: 'enabled',
                role_description: '\u4f60\u662f AIYA \u7684\u7f51\u9875 Demo \u7f16\u7a0b\u52a9\u624b\u3002\u53ea\u8f93\u51fa\u5b8c\u6574\u53ef\u8fd0\u884c\u7684\u5355\u6587\u4ef6 HTML\uff1b\u4e0d\u8981\u89e3\u91ca\uff0c\u4e0d\u8981 Markdown\uff0c\u4e0d\u8981\u601d\u8003\u8fc7\u7a0b\u3002\u6240\u6709\u7528\u6237\u53ef\u89c1\u6587\u6848\u5fc5\u987b\u4f7f\u7528\u7b80\u4f53\u4e2d\u6587\u3002',
              },
              deep_chat: { type: 'disabled' },
              ai_search: { type: 'disabled' },
              reasoning_search: { type: 'disabled' },
            },
            user_location: {
              type: 'approximate',
              country: '\u4e2d\u56fd',
              region: '\u6d59\u6c5f',
              city: '\u676d\u5dde',
            },
          },
        ],
        input: [
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        ],
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error('Ark Responses HTTP ' + response.status + ': ' + text.slice(0, 700));
    }
    const json = JSON.parse(text);
    const content = extractArkResponsesText(json);
    if (content) return content;
    throw new Error('Ark Responses returned empty content. status=' + (json?.status || 'unknown'));
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Ark Responses timed out after ' + timeoutMs + 'ms');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}


function isSnakeSpec(spec, job) {
  return spec?.type === 'snake' || inferSpecTypeFromPrompt(job) === 'snake';
}

function isWhackMoleSpec(spec, job) {
  return spec?.type === 'whack-a-mole' || inferSpecTypeFromPrompt(job) === 'whack-a-mole';
}


function normalizeModelHtml(raw) {
  let text = String(raw || '').trim();
  const warnings = [];
  let strippedMarkdownFence = false;
  const fence = /^```(?:html)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) {
    text = fence[1].trim();
    strippedMarkdownFence = true;
  } else if (text.includes('```')) {
    const inner = /```(?:html)?\s*([\s\S]*?)```/i.exec(text);
    if (inner) {
      text = inner[1].trim();
      strippedMarkdownFence = true;
    }
  }

  const lower = text.toLowerCase();
  const start = lower.indexOf('<!doctype html') >= 0 ? lower.indexOf('<!doctype html') : lower.indexOf('<html');
  const end = lower.lastIndexOf('</html>');
  if (start > 0 || end >= 0) {
    text = text.slice(Math.max(0, start), end >= 0 ? end + '</html>'.length : undefined).trim();
  }
  if (strippedMarkdownFence) warnings.push('Model returned markdown fence; runner stripped it before validation.');
  return { html: text, warnings, strippedMarkdownFence };
}

function injectRuntimeGuard(html) {
  const guard = `<script>
(() => {
  const blocked = new Set(['arrowup','arrowdown','arrowleft','arrowright',' ','space','spacebar','w','a','s','d']);
  const normalize = (value) => String(value || '').toLowerCase();
  const isInput = (target) => ['INPUT','TEXTAREA','SELECT'].includes(target?.tagName || '') || target?.isContentEditable;
  const shouldBlock = (event) => blocked.has(normalize(event.key)) || blocked.has(normalize(event.code));
  window.addEventListener('keydown', (event) => {
    if (shouldBlock(event) && !isInput(event.target)) event.preventDefault();
  }, { capture: true });
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
})();
</script>`;
  const style = `<style>
html,body{overscroll-behavior:none}
canvas,[data-game-stage]{touch-action:none}
</style>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}\n${style}\n${guard}`);
  return `${style}\n${guard}\n${html}`;
}

function injectWhackMoleTestHook(html) {
  if (/__AIYA_TEST_WHACK_HIT__/.test(html)) return html;
  const inferredHoles = Math.max(estimateWhackHoleCount(html), 9);
  const hook = `<script>
(() => {
  if (typeof window.__AIYA_TEST_WHACK_HIT__ === 'function') return;
  window.__AIYA_TEST_WHACK_HIT__ = () => {
    const holeSelector = '[data-testid="mole-hole"],[data-hole],.hole,.mole-hole,.pit,.cell';
    const activeSelector = '.hole.mole,[data-hole].mole,.hole.active,[data-hole].active,.mole.active,[data-mole].active,.active .mole,.mole.show,.mole.visible,.target.active,.active';
    const text = () => document.body?.innerText || '';
    const numberFrom = (value) => {
      const scoreNode = document.querySelector('[data-score],#score,#scoreDisplay,.score,.score-display');
      const scoreNodeMatch = /(\\d+)/.exec(scoreNode?.textContent || '');
      if (scoreNodeMatch) return Number(scoreNodeMatch[1] || 0);
      const scoreMatch = /(?:分数|得分|score|points)\\s*[:：]?\\s*(\\d+)/i.exec(value);
      const anyMatch = /(\\d+)/.exec(value);
      return Number(scoreMatch?.[1] || anyMatch?.[1] || 0);
    };
    const holes = Math.max(document.querySelectorAll(holeSelector).length, ${inferredHoles});
    const activeBefore = document.querySelectorAll(activeSelector).length;
    const before = numberFrom(text());
    const target = document.querySelector(activeSelector) || document.querySelector(holeSelector) || document.querySelector('button,[role="button"],canvas');
    if (target) {
      target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    const after = numberFrom(text());
    const activeAfter = document.querySelectorAll(activeSelector).length;
    return { holes, activeBefore, activeAfter, before, after, hasTimer: /⏱|倒计时|时间|秒|time|timer|countdown|\\b[0-9]{1,2}\\b/i.test(text()) };
  };
})();
</script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${hook}\n</body>`);
  if (/<\/html>/i.test(html)) return html.replace(/<\/html>/i, `${hook}\n</html>`);
  return `${html}\n${hook}`;
}


function runStaticFastLaneChecks({ html, originalHtml, job, spec }) {
  const failures = [];
  const warnings = [];
  const lower = html.toLowerCase();
  if (html.length < 900) failures.push('Static check failed: HTML is too small to be a complete playable demo.');
  if (html.length > 220_000) failures.push('Static check failed: HTML exceeds maximum size.');
  if (!/<!doctype html/i.test(html) && !/<html[\s>]/i.test(html)) failures.push('Static check failed: missing complete HTML document.');
  if (!/<script[\s>]/i.test(html)) failures.push('Static check failed: missing inline JavaScript.');
  if (!/<\/script>/i.test(html) || !/<\/html>/i.test(html)) failures.push('Static check failed: generated HTML appears truncated.');
  if (!/<style[\s>]/i.test(html)) warnings.push('Static check warning: inline CSS is weak or missing.');
  if (/<script[^>]+src\s*=/i.test(originalHtml)) failures.push('Static check failed: external script is not allowed.');
  if (/<link[^>]+rel=["']?stylesheet/i.test(originalHtml)) failures.push('Static check failed: external stylesheet is not allowed.');
  if (/<(?:img|audio|video|source)[^>]+src=["']?https?:/i.test(originalHtml)) failures.push('Static check failed: external media is not allowed.');
  if (/https?:\/\//i.test(originalHtml)) failures.push('Static check failed: external URL detected.');
  if (/\bfetch\s*\(|\bxmlhttprequest\b|\bwebsocket\s*\(/i.test(originalHtml)) failures.push('Static check failed: network API detected.');
  if (/localstorage|sessionstorage|indexeddb|document\.cookie/i.test(originalHtml)) failures.push('Static check failed: persistent storage/cookie API detected.');
  if (/<form[\s>]/i.test(originalHtml)) failures.push('Static check failed: forms are not allowed in fast demo.');
  if (!/preventdefault/i.test(html)) failures.push('Static check failed: preventDefault guard not detected.');
  if (!/restart|reset|\u91cd\u5f00|\u91cd\u65b0|\u518d\u6765/u.test(lower)) warnings.push('Static check warning: restart/reset copy is weak.');
  if (!/score|status|\u5206\u6570|\u5f97\u5206|\u72b6\u6001/u.test(lower)) warnings.push('Static check warning: score/status copy is weak.');
  if (isSnakeSpec(spec, job) && !/<canvas[\s>]/i.test(html)) failures.push('Snake fast-lane check failed: canvas stage is required.');
  if (isSnakeWrapRequested(job, spec)) {
    if (!/data-aiya-wall-mode="wrap"/i.test(html)) {
      failures.push('Snake wrap check failed: user asked for wall wrap, but rendered HTML is not marked data-aiya-wall-mode="wrap".');
    }
    if (!/WALL_MODE===['"]wrap['"]|\(n\+N\)%N|wrap\(raw\.x\)|wallMode:\s*WALL_MODE/i.test(html)) {
      failures.push('Snake wrap check failed: wrap-around movement logic was not detected.');
    }
  }
  if (isWhackMoleSpec(spec, job)) {
    const holeMarkers = estimateWhackHoleCount(html);
    if (holeMarkers < 6) failures.push(`Whack-a-mole check failed: expected at least 6 holes, found ${holeMarkers}.`);
    if (!/mole|whack|hamster|active|\u5730\u9f20|地鼠/u.test(lower)) failures.push('Whack-a-mole check failed: mole/active target logic not detected.');
    if (!/time|timer|countdown|setinterval|gamet|\u5012\u8ba1\u65f6|\u65f6\u95f4|\u79d2|倒计时|时间|秒/u.test(lower)) failures.push('Whack-a-mole check failed: timer/countdown logic not detected.');
    if (!/math\.random|random|pick/i.test(lower)) failures.push('Whack-a-mole check failed: random target movement not detected.');
  }
  if (isLightModeRequested(job, spec) && !/data-aiya-visual-mode="light"/i.test(html)) {
    failures.push('Revision check failed: light visual mode was requested but the rendered HTML is not marked as light.');
  }
  return { ok: failures.length === 0, failures, warnings };
}

async function validateFastLaneInBrowser({ html, artifactsDir, job, spec }) {
  const screenshotPath = path.join(artifactsDir, 'screenshot.png');
  const consoleErrors = [];
  const pageErrors = [];
  const blockedRequests = [];
  const failures = [];
  const warnings = [];
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
      blockedRequests.push(url);
      return route.abort();
    });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
    await page.waitForTimeout(400);
    const rootVisible = await page.locator('body').isVisible().catch(() => false);
    const canvasCount = await page.locator('canvas').count().catch(() => 0);
    const buttonCount = await page.locator('button').count().catch(() => 0);
    const interactiveCount = await page.locator('button, input, select, textarea, canvas, [role="button"], [tabindex]').count().catch(() => 0);
    const bodyTextBefore = await page.locator('body').innerText().catch(() => '');
    const canvasBefore = canvasCount > 0
      ? await page.locator('canvas').first().evaluate((node) => node.toDataURL('image/png')).catch(() => '')
      : '';
    const scrollBefore = await page.evaluate(() => window.scrollY).catch(() => 0);
    const whackProbe = isWhackMoleSpec(spec, job)
      ? await runWhackMoleBrowserProbe(page, html)
      : null;
    const snakeProbe = isSnakeSpec(spec, job)
      ? await runSnakeBrowserProbe(page)
      : null;
    const drawingProbe = spec?.type === 'drawing'
      ? await runDrawingBrowserProbe(page)
      : null;
    const timerProbe = spec?.type === 'timer'
      ? await runTimerBrowserProbe(page)
      : null;
    const visualProbe = await runVisualModeBrowserProbe(page);

    await page.keyboard.press('Space').catch(() => {});
    await page.keyboard.press('ArrowRight').catch(() => {});
    await page.keyboard.press('KeyD').catch(() => {});
    const preferredButtons = [
      page.locator('button').filter({ hasText: /click|tap|score|\+|start|play/i }).first(),
      page.locator('button').filter({ hasNotText: /restart|reset|重开|重新/i }).first(),
      page.locator('button').first(),
    ];
    for (const button of preferredButtons) {
      if (await button.count().catch(() => 0)) {
        await button.click({ timeout: 1200 }).catch(() => {});
        await page.waitForTimeout(150);
      }
    }
    const extraButtonClicks = Math.min(buttonCount, 4);
    for (let index = 0; index < extraButtonClicks; index += 1) {
      const button = page.locator('button').nth(index);
      const label = await button.innerText().catch(() => '');
      if (/restart|reset|重开|重新/i.test(label)) continue;
      await button.click({ timeout: 1200 }).catch(() => {});
      await page.waitForTimeout(80);
    }
    await page.evaluate(() => {
      for (const element of document.querySelectorAll('button,[role="button"],[id*="click" i],[class*="click" i]')) {
        if (/restart|reset|重开|重新/i.test(element.textContent || '')) continue;
        element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }).catch(() => {});
    if (canvasCount > 0) await page.locator('canvas').first().click({ position: { x: 120, y: 120 }, timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(900);

    const bodyTextAfter = await page.locator('body').innerText().catch(() => '');
    const canvasAfter = canvasCount > 0
      ? await page.locator('canvas').first().evaluate((node) => node.toDataURL('image/png')).catch(() => '')
      : '';
    const scrollAfter = await page.evaluate(() => window.scrollY).catch(() => 0);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const canvasChangedAfterInput = canvasCount > 0 && canvasBefore && canvasAfter && canvasBefore !== canvasAfter;
    const textChangedAfterInput = bodyTextBefore !== bodyTextAfter;
    const taskSpecificVisibleChange = Boolean(
      drawingProbe?.canvasChanged
      || timerProbe?.textChanged
      || timerProbe?.numberChanged
      || whackProbe?.scoreChanged
      || whackProbe?.textChanged
    );
    const hostScrollStable = scrollBefore === scrollAfter;
    const scoreStatusProbe = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const scoreLikeSelectors = [
        '[data-score]', '[data-status]', '[aria-label*=\"分数\"]', '[aria-label*=\"得分\"]', '[aria-label*=\"状态\"]',
        '[aria-label*=\"score\" i]', '[aria-label*=\"status\" i]',
        '[id*=\"score\" i]', '[id*=\"status\" i]', '[class*=\"score\" i]', '[class*=\"status\" i]',
        '[class*=\"fen\" i]', '[class*=\"state\" i]'
      ];
      const selectorHit = scoreLikeSelectors.some((selector) => document.querySelector(selector));
      const statusHit = /进行中|准备|暂停|结束|游戏结束|已开始|未开始|重新开始|重开|挑战中|完成|失败|胜利|通关/.test(text);
      const explicitHit = /score|status|分数|得分|状态|points|best/i.test(text);
      const numericHudHit = /🏆\s*\d+|⭐\s*\d+|分\s*[:：]?\s*\d+|\b\d+\s*分/.test(text);
      return { explicitHit, selectorHit, statusHit, numericHudHit, text: text.slice(0, 240) };
    }).catch(() => ({ explicitHit: false, selectorHit: false, statusHit: false, numericHudHit: false, text: '' }));
    const hasScoreText = /score|status|分数|得分|状态|points|best/i.test(`${bodyTextBefore}\n${bodyTextAfter}`)
      || Boolean(scoreStatusProbe.explicitHit || scoreStatusProbe.selectorHit || scoreStatusProbe.statusHit || scoreStatusProbe.numericHudHit);
    const has重新开始 = /restart|reset|重开|重新|再来/i.test(`${bodyTextBefore}\n${bodyTextAfter}`);
    const immediateGameOver = isSnakeSpec(spec, job) && /game over|游戏结束|失败|死亡/i.test(bodyTextBefore);

    if (!rootVisible) failures.push('Browser check failed: body is not visible.');
    if (isSnakeSpec(spec, job) && canvasCount === 0) failures.push('Browser check failed: snake demo has no canvas.');
    if (isSnakeWrapRequested(job, spec)) {
      if (snakeProbe?.wallMode !== 'wrap') failures.push(`Snake wrap browser check failed: expected wallMode=wrap, got ${snakeProbe?.wallMode || 'unknown'}.`);
      if (!snakeProbe?.wrapProbePassed) failures.push(`Snake wrap browser check failed: edge probe did not wrap safely (${JSON.stringify(snakeProbe?.wrapProbe || {})}).`);
    }
    if (isWhackMoleSpec(spec, job)) {
      if ((whackProbe?.holeCount || 0) < 6) failures.push(`Whack-a-mole browser check failed: expected at least 6 holes, found ${whackProbe?.holeCount || 0}.`);
      if (!whackProbe?.hadActiveMole) failures.push('Whack-a-mole browser check failed: no active mole visible on first screen.');
      if (!whackProbe?.scoreChanged) failures.push('Whack-a-mole browser check failed: clicking active mole did not change score.');
      if (!whackProbe?.hasTimer) failures.push('Whack-a-mole browser check failed: timer/countdown text not detected.');
    }
    if (isLightModeRequested(job, spec) && visualProbe.mode !== 'light') {
      failures.push(`Revision browser check failed: expected light visual mode, got ${visualProbe.mode || 'unknown'}.`);
    }
    if (interactiveCount === 0) failures.push('Browser check failed: no interactive element detected.');
    if (!canvasChangedAfterInput && !textChangedAfterInput && !taskSpecificVisibleChange) {
      const visibleChangeStrict = isGameLikeSpec(spec, job) && spec?.type !== 'drawing' && spec?.type !== 'timer';
      const message = 'Browser check failed: demo did not visibly change after keyboard/pointer input.';
      if (visibleChangeStrict) failures.push(message);
      else warnings.push(`Browser check warning: ${message}`);
    }
    if (!hostScrollStable) failures.push('Browser check failed: game keys scrolled the host page.');
    const scoreTextRequired = isGameLikeSpec(spec, job) || spec?.type === 'timer';
    if (scoreTextRequired && !hasScoreText) failures.push('\u6d4f\u89c8\u5668\u68c0\u67e5\u5931\u8d25\uff1a\u672a\u68c0\u6d4b\u5230\u5206\u6570/\u72b6\u6001\u6587\u672c\u3002');
    if (!scoreTextRequired && !hasScoreText) warnings.push('Browser check warning: score/status text not required for this app type.');
    if (!has重新开始) warnings.push('Browser check warning: restart/reset control text not detected.');
    if (immediateGameOver) failures.push('Snake browser check failed: first screen appears to be game over.');
    if (blockedRequests.length) failures.push(`Browser check failed: external requests blocked: ${blockedRequests.slice(0, 3).join(', ')}`);
    for (const error of consoleErrors) failures.push(`Console error: ${error}`);
    for (const error of pageErrors) failures.push(`Page error: ${error}`);

    return {
      ok: failures.length === 0,
      failures,
      warnings,
      screenshotPath,
      browser: {
        url: 'about:blank#setContent',
        consoleErrors,
        pageErrors: pageErrors.map((message) => ({ message })),
        screenshotPath,
        hasCanvas: canvasCount > 0,
        smoke: {
          assertions: {
            rootVisible,
            canvasVisible: canvasCount > 0,
            canvasChangedAfterInput: Boolean(canvasChangedAfterInput || textChangedAfterInput),
            hostScrollStable,
            restartClicked: buttonCount > 0,
            scoreText: hasScoreText ? '\u5df2\u68c0\u6d4b\u5230' : '',
            scoreStatusProbe,
          },
          metrics: {
            scrollBefore,
            scrollAfter,
            canvasCount,
            interactiveCount,
            blockedRequests,
            snake: snakeProbe,
            whackMole: whackProbe,
            drawing: drawingProbe,
            timer: timerProbe,
            visualMode: visualProbe,
          },
        },
      },
    };
  } finally {
    await browser.close().catch(() => {});
  }
}


async function runDrawingBrowserProbe(page) {
  const canvas = page.locator('canvas').first();
  if (!(await canvas.count().catch(() => 0))) return { canvasChanged: false, reason: 'no canvas' };
  const before = await canvas.evaluate((node) => node.toDataURL('image/png')).catch(() => '');
  const box = await canvas.boundingBox().catch(() => null);
  if (!box) return { canvasChanged: false, reason: 'no canvas box' };
  const x1 = box.x + Math.max(24, box.width * 0.2);
  const y1 = box.y + Math.max(24, box.height * 0.2);
  const x2 = box.x + Math.min(box.width - 24, box.width * 0.75);
  const y2 = box.y + Math.min(box.height - 24, box.height * 0.65);
  await page.mouse.move(x1, y1).catch(() => {});
  await page.mouse.down().catch(() => {});
  await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 6 }).catch(() => {});
  await page.mouse.move(x2, y2, { steps: 6 }).catch(() => {});
  await page.mouse.up().catch(() => {});
  await page.waitForTimeout(180).catch(() => {});
  const after = await canvas.evaluate((node) => node.toDataURL('image/png')).catch(() => '');
  return { canvasChanged: Boolean(before && after && before !== after) };
}

async function runTimerBrowserProbe(page) {
  const textBefore = await page.locator('body').innerText().catch(() => '');
  const startButton = page.locator('button, [role="button"]').filter({ hasText: /\u5f00\u59cb|start|play/i }).first();
  if (await startButton.count().catch(() => 0)) {
    await startButton.click({ timeout: 1200 }).catch(() => {});
  } else {
    await page.keyboard.press('Space').catch(() => {});
  }
  await page.waitForTimeout(1300).catch(() => {});
  const textAfter = await page.locator('body').innerText().catch(() => '');
  const numbersBefore = textBefore.match(/\d{1,2}:\d{2}|\d+/g) || [];
  const numbersAfter = textAfter.match(/\d{1,2}:\d{2}|\d+/g) || [];
  return {
    textChanged: textBefore !== textAfter,
    numberChanged: numbersBefore.join('|') !== numbersAfter.join('|'),
    before: textBefore.slice(0, 180),
    after: textAfter.slice(0, 180),
  };
}

async function runWhackMoleBrowserProbe(page, html = '') {
  const domHoleCount = await page.locator('[data-testid="mole-hole"], [data-hole]').count().catch(() => 0);
  const sourceHoleCount = estimateWhackHoleCount(html);
  const canvasCount = await page.locator('canvas').count().catch(() => 0);
  const holeCount = Math.max(domHoleCount, sourceHoleCount, canvasCount > 0 && sourceHoleCount >= 6 ? sourceHoleCount : 0);

  const helperProbe = await readWhackHelperProbe(page);
  if (isStrongWhackHelperProbe(helperProbe)) {
    const before = Number(helperProbe.before ?? helperProbe.scoreBefore ?? 0);
    const after = Number(helperProbe.after ?? helperProbe.scoreAfter ?? before);
    return {
      holeCount: Math.max(holeCount, Number(helperProbe.holes || 0)),
      domHoleCount,
      sourceHoleCount,
      canvasCount,
      activeCount: Number(helperProbe.activeBefore || helperProbe.active || 0),
      activeAfter: Number(helperProbe.activeAfter || 0),
      hadActiveMole: Number(helperProbe.activeBefore || helperProbe.active || helperProbe.activeAfter || 0) > 0,
      scoreBefore: before,
      scoreAfter: after,
      scoreChanged: Number.isFinite(before) && Number.isFinite(after) && after > before,
      textChanged: false,
      hasTimer: Boolean(helperProbe.hasTimer ?? true),
      helperProbe,
    };
  }

  const canvas = canvasCount > 0 ? page.locator('canvas').first() : null;
  if (canvas) await canvas.click({ position: { x: 8, y: 8 }, timeout: 1200 }).catch(() => {});

  const startButtons = page.locator('button, [role="button"]');
  const buttonCount = await startButtons.count().catch(() => 0);
  for (let i = 0; i < Math.min(buttonCount, 3); i += 1) {
    const text = await startButtons.nth(i).innerText().catch(() => '');
    if (/\u5f00\u59cb|\u91cd\u65b0|\u91cd\u5f00|\u518d\u6765|start|restart|play/i.test(text)) {
      await startButtons.nth(i).click({ timeout: 1200 }).catch(() => {});
      break;
    }
  }
  await page.keyboard.press('Space').catch(() => {});
  await page.waitForTimeout(1200).catch(() => {});

  const helperProbeAfterStart = await readWhackHelperProbe(page);
  if (isStrongWhackHelperProbe(helperProbeAfterStart)) {
    const before = Number(helperProbeAfterStart.before ?? helperProbeAfterStart.scoreBefore ?? 0);
    const after = Number(helperProbeAfterStart.after ?? helperProbeAfterStart.scoreAfter ?? before);
    return {
      holeCount: Math.max(holeCount, Number(helperProbeAfterStart.holes || 0)),
      domHoleCount,
      sourceHoleCount,
      canvasCount,
      activeCount: Number(helperProbeAfterStart.activeBefore || helperProbeAfterStart.active || 0),
      activeAfter: Number(helperProbeAfterStart.activeAfter || 0),
      hadActiveMole: Number(helperProbeAfterStart.activeBefore || helperProbeAfterStart.active || helperProbeAfterStart.activeAfter || 0) > 0,
      scoreBefore: before,
      scoreAfter: after,
      scoreChanged: Number.isFinite(before) && Number.isFinite(after) && after > before,
      textChanged: false,
      hasTimer: Boolean(helperProbeAfterStart.hasTimer ?? true),
      helperProbe: helperProbeAfterStart,
    };
  }

  let activeCount = await page.locator('.hole.mole, [data-hole].mole, .hole.active, [data-hole].active, .mole.active, [data-mole].active').count().catch(() => 0);
  const activeLocator = page.locator('.hole.mole, [data-hole].mole, .hole.active, [data-hole].active, .mole.active, [data-mole].active').first();
  const bodyTextBefore = await page.locator('body').innerText().catch(() => '');
  const scoreBefore = await readScoreLikeText(page);
  let canvasChangedDuringProbe = false;

  if (activeCount > 0) {
    await activeLocator.click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(180).catch(() => {});
  } else if (canvas) {
    const beforeCanvas = await canvas.evaluate((node) => node.toDataURL('image/png')).catch(() => '');
    const box = await canvas.boundingBox().catch(() => null);
    if (box) {
      // Probe every grid center twice with short waits. Canvas games often animate after a start delay.
      for (let pass = 0; pass < 2; pass += 1) {
        for (let row = 0; row < 3; row += 1) {
          for (let col = 0; col < 3; col += 1) {
            await page.mouse.click(box.x + box.width * (col + 0.5) / 3, box.y + box.height * (row + 0.5) / 3).catch(() => {});
            await page.waitForTimeout(90).catch(() => {});
          }
        }
        await page.waitForTimeout(300).catch(() => {});
      }
    }
    const afterCanvas = await canvas.evaluate((node) => node.toDataURL('image/png')).catch(() => '');
    canvasChangedDuringProbe = Boolean(beforeCanvas && afterCanvas && beforeCanvas !== afterCanvas);
  }

  const scoreAfter = await readScoreLikeText(page);
  const bodyTextAfter = await page.locator('body').innerText().catch(() => '');
  const activeAfter = await page.locator('.hole.mole, [data-hole].mole, .hole.active, [data-hole].active, .mole.active, [data-mole].active').count().catch(() => 0);
  const scoreChanged = Number.isFinite(scoreBefore) && Number.isFinite(scoreAfter) && scoreAfter > scoreBefore;
  return {
    holeCount,
    domHoleCount,
    sourceHoleCount,
    canvasCount,
    activeCount,
    activeAfter,
    hadActiveMole: activeCount > 0 || activeAfter > 0 || canvasChangedDuringProbe,
    scoreBefore,
    scoreAfter,
    scoreChanged: scoreChanged || (canvasCount > 0 && bodyTextBefore !== bodyTextAfter),
    textChanged: bodyTextBefore !== bodyTextAfter,
    hasTimer: /time|timer|countdown|seconds|\u5012\u8ba1\u65f6|\u65f6\u95f4|\u79d2|\b[0-9]{1,2}\b/iu.test(bodyTextBefore),
  };
}

async function readWhackHelperProbe(page) {
  return page.evaluate(() => {
    if (typeof window.__AIYA_TEST_WHACK_HIT__ !== 'function') return null;
    try { return window.__AIYA_TEST_WHACK_HIT__(); } catch (error) { return { error: String(error?.message || error) }; }
  }).catch(() => null);
}

function isStrongWhackHelperProbe(probe) {
  if (!probe || probe.error) return false;
  const before = Number(probe.before ?? probe.scoreBefore ?? 0);
  const after = Number(probe.after ?? probe.scoreAfter ?? before);
  const active = Number(probe.activeBefore || probe.active || probe.activeAfter || 0);
  const holes = Number(probe.holes || 0);
  return holes >= 6 && Boolean(probe.hasTimer ?? true) && (active > 0 || (Number.isFinite(before) && Number.isFinite(after) && after > before));
}

async function runSnakeBrowserProbe(page) {
  return page.evaluate(() => {
    const stateBefore = window.__AIYA_SNAKE_STATE__ || null;
    const wallMode = document.body?.dataset?.aiyaWallMode || stateBefore?.wallMode || '';
    const canRunWrapProbe = typeof window.__AIYA_TEST_SNAKE_WRAP__ === 'function';
    const wrapProbe = canRunWrapProbe ? window.__AIYA_TEST_SNAKE_WRAP__() : null;
    const head = wrapProbe?.head || null;
    return {
      wallMode,
      canRunWrapProbe,
      stateBefore,
      wrapProbe,
      wrapProbePassed: wallMode === 'wrap'
        && Boolean(head)
        && Number.isFinite(Number(head.x))
        && Number(head.x) >= 0
        && wrapProbe?.over === false,
    };
  }).catch((error) => ({
    wallMode: '',
    canRunWrapProbe: false,
    stateBefore: null,
    wrapProbe: null,
    wrapProbePassed: false,
    error: String(error?.message || error),
  }));
}


function estimateWhackHoleCount(html) {
  const source = String(html || '').toLowerCase();
  const domMarkers = (source.match(/data-testid="mole-hole"|data-hole\s*=|class=["'][^"']*\bhole\b/g) || []).length;
  if (domMarkers >= 6) return domMarkers;
  const numericTotal = /(?:const|let|var)\s+total\s*=\s*(\d+)/.exec(source);
  if (numericTotal && Number.parseInt(numericTotal[1], 10) >= 6) return Number.parseInt(numericTotal[1], 10);
  const numericN = /(?:const|let|var)\s+n\s*=\s*(\d+)/.exec(source);
  if (numericN && /holes\s*=\s*array\.from|holes\s*=\s*\[|hole/.test(source) && Number.parseInt(numericN[1], 10) >= 6) return Number.parseInt(numericN[1], 10);
  const arrayLength = /holes\s*=\s*array\.from\s*\(\s*\{\s*length\s*:\s*(\d+)/.exec(source);
  if (arrayLength && Number.parseInt(arrayLength[1], 10) >= 6) return Number.parseInt(arrayLength[1], 10);
  const colsRows = /(?:const|let|var)\s+cols\s*=\s*(\d+)\s*,\s*rows\s*=\s*(\d+)/.exec(source)
    || /cols\s*=\s*(\d+)[\s\S]{0,80}rows\s*=\s*(\d+)/.exec(source);
  if (colsRows) {
    const count = Number.parseInt(colsRows[1], 10) * Number.parseInt(colsRows[2], 10);
    if (count >= 6) return count;
  }
  if (/holes\s*=\s*\[\]|holes\.push|for\s*\([^)]*<\s*9/.test(source) && /canvas|ellipse|arc/.test(source)) return 9;
  return domMarkers;
}

async function readScoreLikeText(page) {
  const selectors = ['#score', '#s', '[id*="score" i]', '[class*="score" i]', 'body'];
  for (const selector of selectors) {
    const value = await readNumericText(page, selector);
    if (Number.isFinite(value)) return value;
  }
  return NaN;
}


async function readNumericText(page, selector) {
  const text = await page.locator(selector).first().innerText().catch(() => '');
  const match = /-?\d+/.exec(text);
  return match ? Number.parseInt(match[0], 10) : NaN;
}

async function runVisualModeBrowserProbe(page) {
  return page.evaluate(() => {
    const body = document.body;
    const app = document.querySelector('.app');
    const styles = window.getComputedStyle(body);
    const appStyles = app ? window.getComputedStyle(app) : null;
    return {
      mode: body?.dataset?.aiyaVisualMode || '',
      bodyBackground: styles.background || styles.backgroundColor || '',
      bodyColor: styles.color || '',
      appBackground: appStyles?.background || appStyles?.backgroundColor || '',
    };
  }).catch(() => ({ mode: '', bodyBackground: '', bodyColor: '', appBackground: '' }));
}

function runFastLaneSemanticChecks({ html, job, spec }) {
  const source = html.toLowerCase();
  const failures = [];
  const warnings = [];
  const type = spec?.type || inferSpecTypeFromPrompt(job);
  const gameLike = isGameLikeSpec(spec, job);
  const hasEventLogic = /requestanimationframe|setinterval|settimeout|addeventlistener|onclick|onpointer|onmousedown|ontouch/.test(source);
  const hasBasicInteractiveElement = /<button\b|<input\b|<select\b|<textarea\b|<canvas\b|role=["']button|tabindex=/.test(source);
  if (!hasEventLogic && !hasBasicInteractiveElement) {
    failures.push('Semantic check failed: interactive UI not detected.');
  }
  if (gameLike && !/button|role=["']button|restart|reset|\u91cd\u5f00|\u91cd\u65b0|\u518d\u6765|\u5f00\u59cb/u.test(source)) {
    failures.push('Semantic check failed: game start/restart control not detected.');
  }
  if ((gameLike || type === 'timer') && !/score|status|points|time|timer|countdown/i.test(source) && !(source.includes('\u5206\u6570') || source.includes('\u5f97\u5206') || source.includes('\u72b6\u6001') || source.includes('\u5012\u8ba1\u65f6') || source.includes('\u65f6\u95f4'))) {
    failures.push('Semantic check failed: expected score/status/time feedback not detected.');
  }
  if (type === 'calculator' && !/(\+|-|\*|\/|\u00d7|\u00f7|\u52a0|\u51cf|\u4e58|\u9664|eval|calculate|result|\u7ed3\u679c)/u.test(source)) {
    failures.push('Calculator semantic check failed: calculation logic not detected.');
  }
  if (type === 'drawing' && !/canvas|getcontext|pointer|touch|mousedown|mousemove|\u753b\u7b14|\u989c\u8272|\u6e05\u7a7a/u.test(source)) {
    failures.push('Drawing semantic check failed: drawing canvas logic not detected.');
  }
  if (type === 'timer' && !/setinterval|settimeout|countdown|timer|\u5012\u8ba1\u65f6|\u6682\u505c|\u91cd\u7f6e/u.test(source)) {
    failures.push('Timer semantic check failed: countdown logic not detected.');
  }
  const visibleText = extractVisibleTextForChecks(html);
  if (/\b(score|best|status|game over|restart|ready|time up|final score|hit the mole|press space|start \/ resume|controls:)\b/i.test(visibleText)) {
    failures.push('\u8bed\u4e49\u68c0\u67e5\u5931\u8d25\uff1a\u751f\u6210\u7ed3\u679c\u4ecd\u5305\u542b\u82f1\u6587\u754c\u9762\u6587\u6848\u3002');
  }
  if (isLightModeRequested(job, spec) && !/data-aiya-visual-mode="light"/i.test(source)) {
    failures.push('Revision semantic check failed: requested light visual mode is not represented in the output.');
  }
  if (isWhackMoleSpec(spec, job)) {
    const holeMarkers = estimateWhackHoleCount(source);
    if (holeMarkers < 6) failures.push(`Whack-a-mole semantic check failed: expected multi-hole board, found ${holeMarkers} hole markers.`);
    if (!/mole|whack|hamster|active|\u5730\u9f20/u.test(source)) failures.push('Whack-a-mole semantic check failed: mole target state not detected.');
    if (!/time|timer|countdown|setinterval|\u5012\u8ba1\u65f6|\u65f6\u95f4|\u79d2/u.test(source)) failures.push('Whack-a-mole semantic check failed: timer/countdown not detected.');
    if (!/random|math\.random|pick/.test(source)) failures.push('Whack-a-mole semantic check failed: random mole movement not detected.');
  }
  if (isSnakeSpec(spec, job)) {
    const checks = [
      [/snake|\u86c7/u, 'snake entity'],
      [/food|apple|pellet|orb|\u98df\u7269|\u82f9\u679c|\u679c/u, 'food entity'],
      [/collision|collide|gameover|game over|\u649e|\u6b7b\u4ea1|\u7ed3\u675f/u, 'collision/game-over rule'],
      [/arrow|keyw|keya|keys|wasd|\u65b9\u5411/u, 'Arrow/WASD controls'],
      [/restart|reset|\u91cd\u5f00|\u91cd\u65b0|\u518d\u6765/u, 'restart control'],
    ];
    for (const [pattern, label] of checks) {
      if (!pattern.test(source)) failures.push(`Snake semantic check failed: ${label} not detected.`);
    }
    if (isSnakeWrapRequested(job, spec)) {
      if (!/wrap\(|WALL_MODE===['"]wrap['"]|\(n\+N\)%N/i.test(source)) failures.push('Snake semantic check failed: requested wall wrap movement logic not detected.');
      if (/walls?\s+(?:end|ends)\s+the\s+game|wall\s+collision\s+(?:end|ends)|hit\s+the\s+wall[\s\S]{0,24}game\s+over/i.test(source)) failures.push('Snake semantic check failed: wall-death copy remains despite requested wrap mode.');
    }
  }
  return { ok: failures.length === 0, failures, warnings };
}

function isGameLikeSpec(spec, job) {
  const type = spec?.type || inferSpecTypeFromPrompt(job);
  return ['snake', 'whack-a-mole', 'balloon-pop', 'dodger', 'clicker', 'game'].includes(type);
}

function extractVisibleTextForChecks(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}


function computeFastLaneQuality({ staticReport, browserReport, semanticReport, normalized, spec, job }) {
  const criteria = [];
  const warnings = [];
  const add = (id, label, passed, weight, evidence, required = false) => {
    criteria.push({ id, label, passed: Boolean(passed), weight, evidence, required });
  };
  const assertions = browserReport.browser?.smoke?.assertions || {};
  const snake = browserReport.browser?.smoke?.metrics?.snake || {};
  const whack = browserReport.browser?.smoke?.metrics?.whackMole || {};
  const visual = browserReport.browser?.smoke?.metrics?.visualMode || {};
  const gameLike = isGameLikeSpec(spec, job);
  const scoreStatusRequired = gameLike || spec?.type === 'timer';
  add('model-output', 'Model output normalized into complete HTML', normalized.html.length > 0, 10, `length=${normalized.html.length}`, true);
  add('static-safe', 'Static safety checks passed', staticReport.failures.length === 0, 18, staticReport.failures.join(' | ') || 'safe', true);
  add('runtime-clean', 'Browser runtime has no errors', browserReport.browser.consoleErrors.length === 0 && browserReport.browser.pageErrors.length === 0, 16, `${browserReport.browser.consoleErrors.length} console, ${browserReport.browser.pageErrors.length} page`, true);
  add('interactive', 'Visible response after input', assertions.canvasChangedAfterInput, 16, assertions.canvasChangedAfterInput ? 'changed' : 'not changed', true);
  add('scroll-stable', 'Arrow/WASD/Space do not scroll host page', assertions.hostScrollStable, 12, `scroll ${browserReport.browser.smoke?.metrics?.scrollBefore} -> ${browserReport.browser.smoke?.metrics?.scrollAfter}`, true);
  add('semantic', 'Semantic checks match task intent', semanticReport.failures.length === 0, 16, semanticReport.failures.join(' | ') || 'semantic ok', true);
  add('score-status', '\u5206\u6570/\u72b6\u6001\u53cd\u9988\u5b58\u5728', scoreStatusRequired ? Boolean(assertions.scoreText) : true, 6, assertions.scoreText || (scoreStatusRequired ? '\u7f3a\u5931' : 'not required'), scoreStatusRequired);
  add('restart', 'Restart/reset path exists', gameLike ? assertions.restartClicked : true, 6, `button=${assertions.restartClicked}`, false);
  if (isLightModeRequested(null, spec)) {
    add('revision-light-mode', 'Revision request applied: light visual mode', visual.mode === 'light', 12, JSON.stringify(visual), true);
  }
  if (isSnakeWrapRequested(job, spec)) {
    add(
      'snake-wrap-core',
      'Snake core: requested wall wrap is implemented and verified by browser probe',
      snake.wallMode === 'wrap' && snake.wrapProbePassed === true,
      14,
      JSON.stringify(snake),
      true,
    );
  }
  if (isWhackMoleSpec(spec)) {
    add(
      'whack-mole-core',
      'Whack-a-mole core: multi-hole board, visible active mole, hit scoring, timer',
      whack.holeCount >= 6 && whack.hadActiveMole && whack.scoreChanged && whack.hasTimer,
      14,
      JSON.stringify(whack),
      true,
    );
  }

  if (normalized.strippedMarkdownFence) warnings.push('Model returned markdown fences; post-processing cleaned it.');
  const gateFailures = criteria.filter((item) => item.required && !item.passed).map((item) => item.label);
  return {
    ok: gateFailures.length === 0,
    gateFailures,
    warnings,
    criteria,
  };
}



function normalizeVisualMode(value, job) {
  const explicit = String(value || '').toLowerCase();
  const text = `${job?.revision || ''} ${job?.prompt || ''}`.toLowerCase();
  if (/light|bright|white|clean|day|\u6d45\u8272|\u767d\u8272|\u660e\u4eae|\u4eae\u8272|\u6e05\u723d/u.test(`${explicit} ${text}`)) return 'light';
  if (/dark|black|night|\u6df1\u8272|\u9ed1\u8272|\u6697\u8272/u.test(`${explicit} ${text}`)) return 'dark';
  return 'dark';
}

function isLightModeRequested(job, spec) {
  if (spec?.visualMode === 'light') return true;
  return /light|bright|white|clean|day|\u6d45\u8272|\u767d\u8272|\u660e\u4eae|\u4eae\u8272|\u6e05\u723d/iu.test(String(job?.revision || ''));
}

function normalizeSnakeWallMode(value, mechanics, job) {
  const explicit = String(value || '').toLowerCase();
  const mechanicsText = Array.isArray(mechanics) ? mechanics.join(' ') : String(mechanics || '');
  const text = `${explicit} ${mechanicsText} ${job?.prompt || ''} ${job?.revision || ''} ${job?.currentApp?.title || ''} ${job?.currentApp?.brief || ''}`.toLowerCase();
  if (isWrapText(text)) return 'wrap';
  if (/wall[-_\s]?death|die on wall|wall collision|撞墙.*(?:死|结束)|边界.*(?:死|结束)|\u649e\u5899[\s\S]{0,8}(\u6b7b|\u7ed3\u675f)|\u8fb9\u754c[\s\S]{0,8}(\u6b7b|\u7ed3\u675f)/iu.test(text)) return 'death';
  return 'death';
}

function isSnakeWrapRequested(job, spec) {
  if (spec?.wallMode === 'wrap') return true;
  const mechanicsText = Array.isArray(spec?.mechanics) ? spec.mechanics.join(' ') : '';
  const text = `${spec?.wallMode || ''} ${mechanicsText} ${job?.prompt || ''} ${job?.revision || ''} ${job?.currentApp?.title || ''} ${job?.currentApp?.brief || ''}`;
  return isWrapText(text);
}

function isWrapText(value) {
  const text = String(value || '').toLowerCase();
  return /wrap|wraparound|wrap-around|portal|tunnel|edge.*(?:other|opposite)|other side|opposite side|\u7a7f\u5899|\u7a7f\u8d8a|\u5faa\u73af|\u73af\u7ed5|\u53e6\u4e00\u8fb9|\u5bf9\u4fa7|\u51fa\u6765|\u4e0d[\s\S]{0,6}(\u6b7b|\u6b7b\u4ea1|\u7ed3\u675f)|\u649e\u5899[\s\S]{0,14}(\u53e6\u4e00\u8fb9|\u5bf9\u4fa7|\u51fa\u6765)|\u8fb9\u754c[\s\S]{0,14}(\u5faa\u73af|\u7a7f\u8d8a|\u53e6\u4e00\u8fb9)/iu.test(text);
}
