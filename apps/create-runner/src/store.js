import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const now = () => new Date().toISOString();

export class JobStore {
  constructor({ stateDir }) {
    this.stateDir = stateDir;
    this.jobsDir = path.join(stateDir, 'jobs');
    this.jobs = new Map();
    this.listeners = new Map();
    this.saveChains = new Map();
  }

  async init() {
    await fs.mkdir(this.jobsDir, { recursive: true });
    const entries = await fs.readdir(this.jobsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        const filePath = path.join(this.jobsDir, entry.name);
        const job = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (!job?.id) continue;
        if (['queued', 'running'].includes(job.status)) {
          job.status = 'failed';
          job.stage = 'failed';
          job.error = 'Runner restarted before this job completed.';
          job.updatedAt = now();
          job.events = Array.isArray(job.events) ? job.events : [];
          job.events.push({
            at: job.updatedAt,
            stage: 'failed',
            message: job.error,
            data: { recoveredFromDisk: true },
          });
          await this.save(job);
        }
        this.jobs.set(job.id, job);
      } catch {
        // Ignore corrupt job snapshots; the workspace artifacts remain on disk for manual inspection.
      }
    }
  }

  createJob(input) {
    const job = {
      id: `create_${Date.now()}_${randomUUID().slice(0, 8)}`,
      status: 'queued',
      stage: 'queued',
      prompt: input.prompt || '',
      revision: input.revision || '',
      currentApp: input.currentApp || null,
      mode: input.mode || 'auto',
      cliProvider: input.cliProvider || 'codex',
      cliModel: input.cliModel || 'claude-deepraxis-qwen3-7-max',
      modelProvider: input.modelProvider || 'direct-kimi-k2-7-code',
      modelFallbacks: Array.isArray(input.modelFallbacks) ? input.modelFallbacks : [],
      createdAt: now(),
      updatedAt: now(),
      attempts: 0,
      events: [],
      result: null,
      validationReport: null,
      error: null,
      artifacts: {},
    };
    this.jobs.set(job.id, job);
    this.addEvent(job.id, 'queued', 'Job queued');
    void this.save(job);
    return job;
  }

  get(jobId) {
    return this.jobs.get(jobId) || null;
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  update(jobId, patch) {
    const job = this.get(jobId);
    if (!job) return null;
    Object.assign(job, patch, { updatedAt: now() });
    void this.save(job);
    this.emit(jobId, { type: 'job', job: publicJob(job) });
    return job;
  }

  stage(jobId, stage, message, patch = {}) {
    const patchObject = patch && typeof patch === 'object' ? patch : {};
    const { status, ...eventData } = patchObject;
    const job = this.update(jobId, { stage, status: status || 'running' });
    this.addEvent(jobId, stage, message, eventData);
    return job;
  }

  addEvent(jobId, stage, message, data = {}) {
    const job = this.get(jobId);
    if (!job) return;
    const event = { at: now(), stage, message, data };
    job.events.push(event);
    job.updatedAt = event.at;
    void this.save(job);
    this.emit(jobId, { type: 'event', event, job: publicJob(job) });
  }

  subscribe(jobId, listener) {
    const set = this.listeners.get(jobId) || new Set();
    set.add(listener);
    this.listeners.set(jobId, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(jobId);
    };
  }

  emit(jobId, payload) {
    const set = this.listeners.get(jobId);
    if (!set) return;
    for (const listener of set) listener(payload);
  }

  async save(job) {
    const previous = this.saveChains.get(job.id) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => this.writeJobSnapshot(job));
    this.saveChains.set(job.id, next);
    try {
      await next;
    } finally {
      if (this.saveChains.get(job.id) === next) this.saveChains.delete(job.id);
    }
  }

  async writeJobSnapshot(job) {
    await fs.mkdir(this.jobsDir, { recursive: true });
    const filePath = path.join(this.jobsDir, `${job.id}.json`);
    const tempPath = path.join(this.jobsDir, `${job.id}.${process.pid}.${Date.now()}.tmp`);
    await fs.writeFile(tempPath, JSON.stringify(diskJob(job), null, 2), 'utf8');
    await fs.rename(tempPath, filePath);
  }
}

function diskJob(job) {
  const result = job.result
    ? {
        ...job.result,
        html: job.result.html ? undefined : job.result.html,
        htmlOmittedFromDisk: Boolean(job.result.html),
      }
    : job.result;
  const validationReport = job.validationReport
    ? {
        ...job.validationReport,
        commands: job.validationReport.commands?.map((command) => ({
          ...command,
          stdoutTail: truncateText(command.stdoutTail, 1200),
          stderrTail: truncateText(command.stderrTail, 1200),
        })),
      }
    : job.validationReport;
  return {
    ...job,
    events: Array.isArray(job.events) ? job.events.slice(-120).map((event) => ({
      ...event,
      message: truncateText(event.message, 900),
    })) : [],
    result,
    validationReport,
    error: truncateText(job.error, 1600),
  };
}

function truncateText(value, maxLength) {
  if (typeof value !== 'string') return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

export function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    prompt: job.prompt,
    revision: job.revision,
    mode: job.mode || 'auto',
    cliProvider: job.cliProvider || 'codex',
    cliModel: job.cliModel || 'claude-deepraxis-qwen3-7-max',
    modelProvider: job.modelProvider || 'direct-kimi-k2-7-code',
    modelFallbacks: Array.isArray(job.modelFallbacks) ? job.modelFallbacks : [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    attempts: job.attempts,
    events: job.events.slice(-30),
    result: job.result,
    validationReport: job.validationReport,
    error: job.error,
    artifacts: job.artifacts,
  };
}
