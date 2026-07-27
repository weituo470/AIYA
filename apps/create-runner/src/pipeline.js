import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildResultFromProject,
  createInlinePreview,
  prepareBuildModeWorkspace,
  publicProjectValidation,
  restoreRunnerOwnedFiles,
  runCodexBuildMode,
  validateProject,
} from './build-mode.js';
import {
  buildFastLaneResult,
  canRunFastLane,
  publicFastLaneValidation,
  runFastLane,
} from './fast-lane.js';

export class CreatePipeline {
  constructor({ store, config }) {
    this.store = store;
    this.config = config;
    this.queue = [];
    this.activeJobs = 0;
    this.maxParallelJobs = Math.max(1, Number.parseInt(config.maxParallelJobs || 1, 10));
    this.repoRoot = path.resolve(config.repoRoot || path.join(process.cwd(), '../..'));
  }

  enqueue(job) {
    this.queue.push(job.id);
    void this.pump();
  }

  stats() {
    return {
      maxParallelJobs: this.maxParallelJobs,
      activeJobs: this.activeJobs,
      queuedJobs: this.queue.length,
    };
  }

  pump() {
    while (this.activeJobs < this.maxParallelJobs && this.queue.length) {
      const jobId = this.queue.shift();
      const job = this.store.get(jobId);
      if (!job || job.status !== 'queued') continue;
      this.activeJobs += 1;
      void this.process(job)
        .catch((error) => {
          const message = summarizeError(error);
          this.store.update(job.id, {
            status: 'failed',
            stage: 'failed',
            error: message,
            validationReport: job.validationReport || { ok: false, failures: [message], warnings: [] },
          });
          this.store.addEvent(job.id, 'failed', message);
        })
        .finally(() => {
          this.activeJobs -= 1;
          this.pump();
        });
    }
  }

  async process(job) {
    const workspaceDir = path.join(this.config.workDir, job.id);
    await fs.mkdir(workspaceDir, { recursive: true });
    const mode = normalizeJobMode(job.mode);
    this.store.stage(job.id, 'preparing', `Create workspace is being prepared (${mode})`, { status: 'running' });

    let fastLaneResult = null;
    if (mode !== 'codex') {
      fastLaneResult = await this.tryFastLane({ job, workspaceDir });
      if (fastLaneResult?.html) {
        const previewResult = buildFastLaneResult({
          html: fastLaneResult.html,
          job,
          generated: fastLaneResult.generated,
          validation: fastLaneResult.validation,
        });
        this.store.update(job.id, {
          status: 'running',
          stage: 'preview_ready',
          attempts: 1,
          result: previewResult,
          validationReport: publicFastLaneValidation(fastLaneResult.validation),
          artifacts: fastLaneResult.validation?.artifacts || {},
          error: null,
        });
        this.store.addEvent(
          job.id,
          'preview_ready',
          'Direct model preview is ready; Playwright validation continues in the background',
          { failures: fastLaneResult.validation?.failures || [], warnings: fastLaneResult.validation?.warnings || [] },
        );

        if (typeof fastLaneResult.deferredValidation === 'function') {
          let finalValidation;
          try {
            finalValidation = await fastLaneResult.deferredValidation();
          } catch (error) {
            finalValidation = fastLaneFailureValidation({
              message: summarizeError(error),
              modelProvider: job.modelProvider,
            });
            finalValidation.status = 'diagnostic';
          }

          const finalResult = buildFastLaneResult({
            html: fastLaneResult.html,
            job,
            generated: fastLaneResult.generated,
            validation: finalValidation,
          });
          this.store.update(job.id, {
            status: 'succeeded',
            stage: 'succeeded',
            attempts: 1,
            result: finalResult,
            validationReport: publicFastLaneValidation(finalValidation),
            artifacts: finalValidation.artifacts || fastLaneResult.validation?.artifacts || {},
            error: finalValidation.ok ? null : 'Preview is ready; background validation reported diagnostics.',
          });
          this.store.addEvent(
            job.id,
            'succeeded',
            finalValidation.ok
              ? 'Direct model preview passed background validation'
              : 'Direct model preview is kept; background validation reported diagnostics',
            { failures: finalValidation.failures || [], warnings: finalValidation.warnings || [] },
          );
          return;
        }

        this.store.update(job.id, {
          status: 'succeeded',
          stage: 'succeeded',
        });
        this.store.addEvent(job.id, 'succeeded', 'Direct model preview artifact is ready');
        return;
      }

      if (mode === 'model') {
        const validation = fastLaneResult?.validation || fastLaneFailureValidation({
          message: canRunFastLane(this.config)
            ? 'Direct model did not return usable HTML.'
            : 'Direct model config is missing.',
        });
        this.store.update(job.id, {
          status: 'failed',
          stage: 'failed',
          error: validation.failures?.join('; ') || 'Direct model did not return usable HTML',
          validationReport: publicFastLaneValidation(validation),
          artifacts: validation.artifacts || {},
        });
        this.store.addEvent(job.id, 'failed', 'Direct model did not return usable HTML; there is no preview artifact to show', {
          failures: validation.failures || [],
        });
        return;
      }

      if (fastLaneResult?.validation && !this.config.codexFallbackOnFastLaneFail) {
        this.store.update(job.id, {
          status: 'failed',
          stage: 'failed',
          error: fastLaneResult.validation.failures?.join('; ') || 'Fast lane validation failed',
          validationReport: publicFastLaneValidation(fastLaneResult.validation),
          artifacts: fastLaneResult.validation.artifacts || {},
        });
        this.store.addEvent(job.id, 'failed', 'Fast lane failed and Codex fallback is disabled', { failures: fastLaneResult.validation.failures || [] });
        return;
      }

      if (fastLaneResult?.validation) {
        this.store.addEvent(job.id, 'repairing', 'Fast lane diagnostics found issues; falling back to Codex Build Mode', {
          failures: fastLaneResult.validation.failures || [],
        });
      } else if (!canRunFastLane(this.config)) {
        this.store.addEvent(job.id, 'preparing', 'Fast lane skipped because model config is missing; using Codex Build Mode');
      }
    } else {
      this.store.addEvent(job.id, 'preparing', 'Codex mode selected; direct model fast lane is skipped');
    }

    const prepared = await prepareBuildModeWorkspace({ job, workspaceDir, repoRoot: this.repoRoot });
    this.store.addEvent(job.id, 'preparing', `Blank workspace created: ${prepared.templateName}`);
    this.store.addEvent(job.id, 'preparing', 'ProductSpec.md written');

    let lastValidation = null;
    let lastGenerated = null;
    const maxAttempts = Math.max(1, this.config.repairAttempts + 1);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.store.update(job.id, { attempts: attempt });
      this.store.stage(
        job.id,
        attempt === 1 ? 'codex_generating' : 'repairing',
        attempt === 1 ? 'Server Codex is implementing ProductSpec from a blank workspace' : `Repair attempt ${attempt - 1} is using ValidationReport`,
      );

      try {
        lastGenerated = await runCodexBuildMode({
          job,
          appDir: prepared.appDir,
          config: this.config,
          validationReport: lastValidation,
          attempt,
          onProgress: (stage, message, data) => {
            this.store.stage(job.id, stage, message, data);
          },
        });
      } catch (error) {
        const message = summarizeError(error);
        this.store.addEvent(
          job.id,
          attempt === 1 ? 'codex_generating' : 'repairing',
          `Codex generation failed: ${message}`,
          { attempt },
        );
        lastValidation = generationFailureValidation({ attempt, message });
        this.store.update(job.id, {
          validationReport: publicProjectValidation(lastValidation),
          error: message,
        });
        if (attempt < maxAttempts) continue;
        throw error;
      }
      this.store.addEvent(job.id, 'codex_generating', `Generation adapter: ${lastGenerated.adapter}`, {
        logPath: lastGenerated.logPath,
        cliProvider: lastGenerated.cliProvider,
        cliModel: lastGenerated.cliModel,
        workspaceSignals: lastGenerated.workspaceSignals,
        knownCliIssues: lastGenerated.knownCliIssues || [],
      });

      const protectedFiles = await restoreRunnerOwnedFiles({
        appDir: prepared.appDir,
        templateDir: prepared.templateDir,
      });
      if (protectedFiles.restored.length) {
        this.store.addEvent(
          job.id,
          'static_check',
          `Runner-owned validation files restored: ${protectedFiles.restored.join(', ')}`,
          { restored: protectedFiles.restored },
        );
      }

      this.store.stage(job.id, 'static_check', 'Running project command validation');
      lastValidation = await validateProject({
        appDir: prepared.appDir,
        workspaceDir,
        attempt,
        job,
        protectedFiles,
        onProgress: (stage, message, data) => {
          this.store.stage(job.id, stage, message, data);
        },
      });
      this.store.update(job.id, {
        validationReport: publicProjectValidation(lastValidation),
        artifacts: lastValidation.artifacts,
      });

      if (lastValidation.ok) {
        const preview = await createInlinePreview({ appDir: prepared.appDir, workspaceDir });
        const result = buildResultFromProject({
          html: preview.html,
          job,
          generated: lastGenerated,
          validation: lastValidation,
          templateName: prepared.templateName,
        });
        this.store.update(job.id, {
          status: 'succeeded',
          stage: 'succeeded',
          result,
          validationReport: publicProjectValidation(lastValidation),
          artifacts: { ...lastValidation.artifacts, previewPath: preview.outputPath },
          error: null,
        });
        this.store.addEvent(job.id, 'succeeded', 'Build Mode demo validated and preview artifact is ready');
        return;
      }

      this.store.addEvent(job.id, 'browser_verify', 'Validation failed', { failures: lastValidation.failures });
    }

    this.store.update(job.id, {
      status: 'failed',
      stage: 'failed',
      error: lastValidation?.failures?.join('; ') || 'Validation failed',
      validationReport: publicProjectValidation(lastValidation),
      artifacts: lastValidation?.artifacts || {},
    });
    this.store.addEvent(job.id, 'failed', 'Validation failed after repair attempts', { failures: lastValidation?.failures || [] });
  }

  async tryFastLane({ job, workspaceDir }) {
    if (!canRunFastLane(this.config)) return null;
    const candidates = fastLaneModelCandidates(this.config, job.modelProvider, job.modelFallbacks);
    let lastValidation = null;
    let lastError = null;
    for (const modelProvider of candidates) {
      const trialJob = { ...job, modelProvider };
      this.store.stage(job.id, 'fast_generating', `Direct model is trying ${modelProvider}`);
      try {
        const result = await runFastLane({
          job: trialJob,
          workspaceDir,
          config: this.config,
          deferValidation: true,
          onProgress: (stage, message, data) => {
            this.store.stage(job.id, stage, message, { ...(data || {}), modelProvider });
          },
        });
        lastValidation = result.validation;
        this.store.update(job.id, {
          validationReport: publicFastLaneValidation(result.validation),
          artifacts: result.validation.artifacts,
          error: result.validation.ok ? null : result.validation.failures?.join('; '),
        });
        if (result.html) {
          return result;
        }
        this.store.addEvent(job.id, 'fast_verify', `Direct model ${modelProvider} did not return usable HTML; trying next candidate`, {
          failures: result.validation?.failures || [],
        });
      } catch (error) {
        const message = summarizeError(error);
        lastError = message;
        this.store.addEvent(job.id, 'fast_verify', `Direct model ${modelProvider} failed: ${message}`);
        lastValidation = fastLaneFailureValidation({ message, modelProvider });
        this.store.update(job.id, {
          validationReport: publicFastLaneValidation(lastValidation),
          error: message,
        });
      }
    }
    const validation = lastValidation || fastLaneFailureValidation({ message: lastError || 'Direct model did not return usable HTML.' });
    if (!this.config.codexFallbackOnFastLaneFail) throw new Error(lastError || validation.failures?.join('; ') || 'Direct model failed');
    return { validation };
  }
}


function fastLaneModelCandidates(config, requestedModelProvider, requestedFallbacks = []) {
  const configured = (config.modelProviders || [])
    .filter((provider) => provider?.id && provider.baseUrl && provider.apiKey && provider.model)
    .map((provider) => provider.id);

  const fallbackList = Array.isArray(requestedFallbacks)
    ? requestedFallbacks.filter((id) => configured.includes(id))
    : [];
  if (fallbackList.length) {
    return [...new Set(fallbackList)];
  }

  if (requestedModelProvider) {
    return configured.includes(requestedModelProvider) ? [requestedModelProvider] : [];
  }

  const preferred = [
    config.defaultModelProvider,
    'direct-kimi-k2-7-code',
    'direct-deepseek-v4-pro',
    'direct-deepseek-v4-flash',
    'direct-glm-5-2',
    'direct-minimax-m2-7',
  ].filter(Boolean);
  return [...new Set([...preferred, ...configured])].filter((id) => configured.includes(id));
}

function fastLaneFailureValidation({ message, modelProvider }) {
  return {
    attempt: 1,
    overallPassed: false,
    ok: false,
    failedStage: 'fast-lane-generation',
    failures: [`Fast lane failed: ${message}`],
    warnings: [],
    commands: [],
    browser: { consoleErrors: [], pageErrors: [], hasCanvas: false },
    semantic: { ok: false, failures: [], warnings: [] },
    quality: {
      ok: false,
      gateFailures: ['Fast lane generation failed'],
      warnings: [],
      criteria: [],
    },
    changedFiles: [],
    diagnosisHint: 'DeepSeek fast lane did not complete. Runner can fall back to Codex Build Mode.',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    artifacts: {},
    fastLane: { source: 'deepseek-fast-lane', modelProvider },
  };
}

function generationFailureValidation({ attempt, message }) {
  return {
    attempt,
    overallPassed: false,
    ok: false,
    failedStage: 'codex-generation',
    failures: [`Codex generation failed: ${message}`],
    warnings: [],
    commands: [],
    browser: { consoleErrors: [], pageErrors: [], hasCanvas: false },
    semantic: { ok: false, failures: [], warnings: [] },
    quality: {
      ok: false,
      gateFailures: ['Codex generation failed'],
      warnings: [],
      criteria: [],
    },
    changedFiles: [],
    diagnosisHint: 'Codex did not complete this generation attempt. The next attempt can use the repair/stronger model profile.',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    artifacts: {},
  };
}

function normalizeJobMode(value) {
  return ['codex', 'cli', 'model', 'auto'].includes(value) ? (value === 'cli' ? 'codex' : value) : 'auto';
}

function summarizeError(error) {
  const raw = error instanceof Error ? error.message : String(error || 'Unknown create-runner error');
  if (raw.includes('read-only sandbox')) {
    return 'Codex file write was blocked by nested sandbox. Runner configuration needs approvals/sandbox bypass in the isolated job workspace.';
  }
  if (raw.includes('property_name_above_max_length') || raw.includes('Invalid property name')) {
    return 'Codex CLI failed with an internal tool-call schema error. Full details are in the job CodexRun log.';
  }
  if (raw.includes('timed out after')) {
    return raw.slice(0, 500);
  }
  return raw.length > 900 ? `${raw.slice(0, 900)}...` : raw;
}
