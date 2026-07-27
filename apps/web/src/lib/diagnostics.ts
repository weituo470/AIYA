import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export type DiagnosticStatus = 'started' | 'succeeded' | 'failed';
export type DiagnosticSeverity = 'info' | 'warn' | 'error';

export type DiagnosticEntry = {
  id: string;
  at: string;
  scope: string;
  status: DiagnosticStatus;
  severity: DiagnosticSeverity;
  message: string;
  route?: string;
  requestId?: string;
  jobId?: string;
  durationMs?: number;
  model?: string;
  provider?: string;
  apiType?: string;
  data?: unknown;
};

const MAX_STRING_LENGTH = 60_000;
const MAX_ARRAY_LENGTH = 80;
const SENSITIVE_KEY_PATTERN = /(api[-_ ]?key|access[-_ ]?key|authorization|bearer|token|secret|password|cookie|session)/i;

export const createDiagnosticId = (prefix = 'diag') =>
  `${prefix}_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 10)}`;

export const getDiagnosticsDir = () => {
  if (process.env.AIYA_DIAGNOSTICS_DIR?.trim()) return resolve(process.env.AIYA_DIAGNOSTICS_DIR.trim());
  return resolve(process.env.INIT_CWD || process.cwd(), '.state', 'diagnostics');
};

export const summarizeText = (value: unknown, maxLength = 500) => {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…[truncated ${text.length - maxLength} chars]`;
};

export const sha256Text = (value: unknown) =>
  createHash('sha256').update(String(value ?? '')).digest('hex');

export const errorToDiagnostic = (error: unknown) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: 'NonError',
    message: String(error),
  };
};

const sanitize = (value: unknown, depth = 0): unknown => {
  if (value == null) return value;
  if (depth > 8) return '[depth-limit]';
  if (typeof value === 'string') {
    if (value.length <= MAX_STRING_LENGTH) return value;
    return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitize(item, depth + 1);
    }
    return output;
  }
  return String(value);
};

export async function writeDiagnosticEvent(entry: Omit<DiagnosticEntry, 'at'> & { at?: string }) {
  const at = entry.at || new Date().toISOString();
  const normalized: DiagnosticEntry = sanitize({
    ...entry,
    at,
  }) as DiagnosticEntry;
  const dir = getDiagnosticsDir();
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, `${at.slice(0, 10)}.jsonl`), `${JSON.stringify(normalized)}\n`, 'utf8');
  return normalized;
}

export async function readDiagnosticEvents(options: {
  id?: string;
  scope?: string;
  status?: DiagnosticStatus;
  severity?: DiagnosticSeverity;
  limit?: number;
} = {}) {
  const dir = getDiagnosticsDir();
  const limit = Math.max(1, Math.min(options.limit || 100, 500));
  let files: string[] = [];
  try {
    files = (await readdir(dir))
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
      .sort()
      .reverse()
      .slice(0, 14);
  } catch {
    return [];
  }

  const results: DiagnosticEntry[] = [];
  for (const file of files) {
    const content = await readFile(join(dir, file), 'utf8').catch(() => '');
    const lines = content.trim().split(/\r?\n/).filter(Boolean).reverse();
    for (const line of lines) {
      let entry: DiagnosticEntry | null = null;
      try {
        entry = JSON.parse(line) as DiagnosticEntry;
      } catch {
        continue;
      }
      if (options.id && entry.id !== options.id) continue;
      if (options.scope && entry.scope !== options.scope) continue;
      if (options.status && entry.status !== options.status) continue;
      if (options.severity && entry.severity !== options.severity) continue;
      results.push(entry);
      if (results.length >= limit) return results;
    }
  }
  return results;
}
