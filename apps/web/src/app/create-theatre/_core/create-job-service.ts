import type { CreateJob, GeneratedResult } from './types';

export const demoModelFallbacks = ['official-deepseek-deepseek-v4-flash'];

export const isCreateJobActive = (job?: CreateJob | null) => job?.status === 'queued' || job?.status === 'running';

const fixedFastStackRule = [
  '固定技术栈：单文件 HTML + 内联 CSS + 原生 JavaScript。',
  '只做一个完整 index.html；禁止 React、Vue、Vite、TypeScript、多文件、npm 安装、外部资源和网络请求。',
  '目标是快速交付最小可运行版本：先保证能玩/能用，再做少量视觉美化。',
  '所有界面文字使用简体中文；如使用方向键、WASD 或空格，必须 preventDefault，避免宿主页面滚动。',
].join('\n');

const withFixedFastStack = (text: string) => `${text.trim()}\n\n${fixedFastStackRule}`;

export const createJobPayload = (idea: string, currentApp?: GeneratedResult | null) => ({
  prompt: currentApp?.html ? withFixedFastStack('基于当前作品继续修改完善') : withFixedFastStack(idea),
  revision: currentApp?.html ? withFixedFastStack(idea) : '',
  currentApp: currentApp || undefined,
  mode: 'model',
  modelProvider: 'official-deepseek-deepseek-v4-flash',
  modelFallbacks: demoModelFallbacks,
});

export async function createTheatreJob(input: { idea: string; currentApp?: GeneratedResult | null }) {
  const response = await fetch('/api/create/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createJobPayload(input.idea, input.currentApp)),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.job) throw new Error(payload?.error || '\u521b\u5efa\u751f\u6210\u4efb\u52a1\u5931\u8d25');
  return payload.job as CreateJob;
}

export async function fetchCreateJob(jobId: string) {
  const response = await fetch(`/api/create/jobs/${jobId}`, { cache: 'no-store' });
  const payload = await response.json().catch(() => null);
  return (payload?.job || null) as CreateJob | null;
}

export function subscribeCreateJobEvents(
  jobId: string,
  handlers: {
    onJob: (job: CreateJob) => void;
    onDone?: () => void;
    onError?: () => void;
  },
) {
  const source = new EventSource(`/api/create/jobs/${jobId}/events`);
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload?.job) handlers.onJob(payload.job as CreateJob);
    if (payload?.job?.status === 'succeeded' || payload?.job?.status === 'failed') {
      source.close();
      handlers.onDone?.();
    }
  };
  source.onerror = () => {
    source.close();
    handlers.onError?.();
  };
  return source;
}
