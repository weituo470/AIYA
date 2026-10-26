import { actualTaskReply, isTaskStatusQuestion, truthfulTeacherReply } from '../../_shared/teacher-task-state';
import { exec } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDiagnosticId,
  errorToDiagnostic,
  summarizeText,
  writeDiagnosticEvent,
} from '../../../lib/diagnostics';

export const runtime = 'nodejs';

type JsonObject = Record<string, unknown>;

type TeacherAgentRequest = {
  phase?: string;
  userText?: string;
  currentAppTitle?: string;
  jobStatus?: string;
  jobStage?: string;
  lastEvent?: string;
  studentProfile?: {
    nickname?: string;
    ageGroup?: string;
    pronoun?: string;
    voiceprintEnrolled?: boolean;
    voiceprintSampleCount?: number;
    voiceprintUpdatedAt?: string;
  };
  chatHistory?: Array<{
    role?: string;
    text?: string;
  }>;
};

type TeacherAgentReply = {
  reply: string;
  suggestedPrompt?: string;
  nextAction?: 'ask_idea' | 'start_generation' | 'revise' | 'explain' | 'celebrate' | 'chat';
};

const MAX_USER_TEXT = 800;
const FIXED_WARMUP_REPLY = '\u4f60\u597d\u5440\uff0c\u8ba9\u6211\u4eec\u4ece\u4e00\u4e2a\u5c0f\u5e94\u7528\u5f00\u59cb\u5b66\u4e60AI\u7f16\u7a0b\u5427';

const env = (key: string) => process.env[key]?.trim() || '';

const jsonError = (message: string, status = 500, extra: JsonObject = {}) =>
  Response.json({ ok: false, error: message, ...extra }, { status });

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const openAiChatUrl = (baseUrl: string) => {
  const base = trimTrailingSlash(baseUrl);
  if (/^https:\/\/api\.deepseek\.com$/i.test(base)) return `${base}/chat/completions`;
  if (/\/(v\d+|openai)$/i.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
};

const readConfig = () => {
  const baseUrl =
    env('AIYA_TEACHER_AGENT_BASE_URL') ||
    env('HERMES_BASE_URL') ||
    env('AIYA_CREATE_FAST_DIRECT_HTML_BASE_URL') ||
    env('AIYA_CREATE_FAST_MODEL_BASE_URL') ||
    env('AIYA_CREATE_MODEL_BASE_URL') ||
    env('ANTHROPIC_BASE_URL') ||
    'http://127.0.0.1:1234';
  const apiKey =
    env('AIYA_TEACHER_AGENT_API_KEY') ||
    env('HERMES_API_KEY') ||
    env('AIYA_CREATE_FAST_DIRECT_HTML_API_KEY') ||
    env('AIYA_CREATE_FAST_MODEL_API_KEY') ||
    env('AIYA_CREATE_MODEL_API_KEY') ||
    env('ANTHROPIC_API_KEY') ||
    'lm-studio';
  const model =
    env('AIYA_TEACHER_AGENT_MODEL') ||
    env('HERMES_MODEL') ||
    env('AIYA_CREATE_FAST_DIRECT_HTML_MODEL') ||
    env('AIYA_CREATE_FAST_MODEL') ||
    env('AIYA_CREATE_MODEL') ||
    env('ANTHROPIC_MODEL') ||
    '';
  const apiType =
    env('AIYA_TEACHER_AGENT_API_TYPE') ||
    env('HERMES_API_TYPE') ||
    (baseUrl.includes('anthropic') ? 'anthropic' : 'openai');
  const provider =
    env('AIYA_TEACHER_AGENT_PROVIDER') ||
    env('HERMES_TEACHER_AGENT_PROVIDER') ||
    (apiType === 'hermes-cli' ? 'hermes-cli' : 'http');
  return {
    baseUrl: trimTrailingSlash(baseUrl),
    apiKey,
    model,
    apiType,
    provider,
    cliCommand: env('AIYA_TEACHER_AGENT_CLI_COMMAND') || env('HERMES_CLI_COMMAND') || 'hermes',
    cliProvider: env('AIYA_TEACHER_AGENT_CLI_PROVIDER') || env('HERMES_CLI_PROVIDER') || 'openai-codex',
    timeoutMs: Number.parseInt(env('AIYA_TEACHER_AGENT_TIMEOUT_MS') || env('HERMES_TIMEOUT_MS') || '30000', 10),
    maxTurns: Number.parseInt(env('AIYA_TEACHER_AGENT_MAX_TURNS') || '8', 10),
  };
};

const teacherSystemPrompt = `You are AIYA's AI coding teacher for absolute beginners.
Your job is to guide a student to build small playable web apps with AI.
Always reply in Simplified Chinese.
Return JSON only. Do not use Markdown.

Core behavior:
1. Be warm, concise, and specific. Use 1 to 3 short sentences for normal chat.
2. If the student asks to build an app, set nextAction to "start_generation" and provide a clear one-sentence suggestedPrompt for your coding route.
3. If currentAppTitle is not empty and the student asks to change/add/fix/optimize, set nextAction to "revise" and write suggestedPrompt as an incremental change request.
4. nextAction is a proposal only, not an accepted job. Never claim you are starting, still writing, or finished based on chatHistory. Only jobStatus/jobStage are evidence of active work; a prior completed job does not mean a new request is running. When proposing generation, say the requirement is ready to submit, not that coding has started.
5. If studentProfile contains nickname, use it naturally and never ask for nickname, name, or how to address the student again.
6. If studentProfile.voiceprintEnrolled is true, you know the student's voiceprint has been recorded. Do not ask them to record it again.
7. If a fact is already present in studentProfile, do not ask it again. Ask at most one lightweight missing-profile question only when it does not block building.
8. During generation, the student may chat with you. Explain observable progress in first-person short lines, not hidden reasoning.
10. Never say you will arrange, delegate, or hand work to another programming Agent. The teacher is the coding Agent.
9. Protect privacy: do not ask for real full name, school, address, contact info, or precise age.

JSON shape:
{
  "reply": "Chinese message shown to the student",
  "suggestedPrompt": "optional one-sentence generator prompt",
  "nextAction": "ask_idea | start_generation | revise | explain | celebrate | chat"
}`;

const buildProfileFacts = (profile: TeacherAgentRequest['studentProfile'] = {}) => ({
  nickname: profile.nickname || '',
  ageGroup: profile.ageGroup || '',
  pronoun: profile.pronoun || '',
  voiceprintEnrolled: Boolean(profile.voiceprintEnrolled),
  voiceprintSampleCount: profile.voiceprintSampleCount || 0,
  voiceprintUpdatedAt: profile.voiceprintUpdatedAt || '',
});

const buildUserPrompt = (body: TeacherAgentRequest) => {
  const userText = String(body.userText || '').slice(0, MAX_USER_TEXT);
  const profileFacts = buildProfileFacts(body.studentProfile);
  const constraints = [
    profileFacts.nickname
      ? `Known nickname: ${profileFacts.nickname}. Never ask name/nickname/how to address again.`
      : 'Nickname is unknown. You may ask once, but do not delay app generation if the student already requested an app.',
    profileFacts.voiceprintEnrolled
      ? `Voiceprint is already enrolled with ${profileFacts.voiceprintSampleCount} sample(s). Never ask to record voiceprint again.`
      : 'Voiceprint is not enrolled or unknown. Do not force enrollment unless the student asks about login/identity.',
    profileFacts.ageGroup ? `Known age group: ${profileFacts.ageGroup}.` : 'Age group unknown; asking is optional and should not block building.',
    profileFacts.pronoun ? `Known pronoun/preference: ${profileFacts.pronoun}.` : 'Pronoun/preference unknown; do not ask unless useful.',
  ];
  return JSON.stringify({
    phase: body.phase || 'warmup',
    userText,
    currentAppTitle: body.currentAppTitle || '',
    jobStatus: body.jobStatus || '',
    jobStage: body.jobStage || '',
    lastEvent: body.lastEvent || '',
    studentProfile: profileFacts,
    chatHistory: (body.chatHistory || [])
      .slice(-8)
      .map((item) => ({
        role: String(item.role || '').slice(0, 16),
        text: String(item.text || '').slice(0, 240),
      })),
    constraints,
  });
};

type TeacherStudentProfile = NonNullable<TeacherAgentRequest['studentProfile']>;

const nicknameQuestionLinePattern = /(\u600E\u4E48\u79F0\u547C|\u79F0\u547C\u4F60|\u53EB\u4EC0\u4E48|\u540D\u5B57\u662F\u4EC0\u4E48|\u544A\u8BC9\u6211.*(?:\u540D\u5B57|\u6635\u79F0)|\u6635\u79F0\u662F\u4EC0\u4E48|\u5982\u4F55\u79F0\u547C|\u6211\u53EF\u4EE5.*\u79F0\u547C)/;
const voiceprintQuestionLinePattern = /(\u58F0\u7EB9.*(?:\u5F55\u5165|\u5EFA\u6863|\u91C7\u96C6)|(?:\u5F55\u5165|\u5EFA\u6863).*\u58F0\u7EB9)/;

const sanitizeTeacherReply = (reply: TeacherAgentReply, profile: TeacherStudentProfile = {}) => {
  const lines = reply.reply.split('\n').filter((line) => {
    if (profile.nickname && nicknameQuestionLinePattern.test(line)) return false;
    if (profile.voiceprintEnrolled && voiceprintQuestionLinePattern.test(line)) return false;
    return true;
  });
  const cleaned = lines
    .join('\n')
    .replace(/(?:安排|交给|提交给)\s*编程\s*Agent/g, '我直接开始写代码')
    .replace(/编程\s*Agent/g, '老师')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    ...reply,
    reply: cleaned || reply.reply,
  };
};

const extractJson = (text: string): TeacherAgentReply => {
  const raw = text.trim();
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      reply: raw.slice(0, 240) || '\u6211\u4EEC\u5148\u628A\u60F3\u6CD5\u8BF4\u6E05\u695A\uFF0C\u518D\u8BA9 AI \u505A\u51FA\u7B2C\u4E00\u7248\u3002',
      nextAction: 'ask_idea',
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as Partial<TeacherAgentReply>;
    const reply = typeof parsed.reply === 'string' ? parsed.reply.trim() : '';
    if (!reply) throw new Error('empty reply');
    return {
      reply,
      suggestedPrompt: typeof parsed.suggestedPrompt === 'string' ? parsed.suggestedPrompt.trim() : undefined,
      nextAction: parsed.nextAction,
    };
  } catch {
    return {
      reply: raw.slice(0, 240) || '\u6211\u4EEC\u5148\u628A\u60F3\u6CD5\u8BF4\u6E05\u695A\uFF0C\u518D\u8BA9 AI \u505A\u51FA\u7B2C\u4E00\u7248\u3002',
      nextAction: 'ask_idea',
    };
  }
};

async function callOpenAIChat(config: ReturnType<typeof readConfig>, userPrompt: string, signal: AbortSignal) {
  const response = await fetch(openAiChatUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: teacherSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.4,
      stream: false,
    }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Teacher OpenAI HTTP ${response.status}: ${text.slice(0, 240)}`);
  const json = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json.choices?.[0]?.message?.content || '';
  return extractJson(content);
}

async function callAnthropic(config: ReturnType<typeof readConfig>, userPrompt: string, signal: AbortSignal) {
  const response = await fetch(`${config.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      system: teacherSystemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      max_tokens: 600,
      temperature: 0.4,
    }),
    signal,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Teacher Anthropic HTTP ${response.status}: ${text.slice(0, 240)}`);
  const json = JSON.parse(text) as { content?: Array<{ text?: string }> };
  const content = json.content?.map((item) => item.text || '').join('\n') || '';
  return extractJson(content);
}

const quoteShellArg = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

const runHermesCli = (config: ReturnType<typeof readConfig>, promptFile: string) => new Promise<string>((resolve, reject) => {
  const query = `请读取这个文件，根据文件里的要求生成结果，并只输出 JSON：${promptFile}`;
  const args = [
    'chat',
    '-Q',
    '--provider',
    config.cliProvider,
    '-m',
    config.model,
    '-q',
    query,
    '--max-turns',
    String(config.maxTurns),
    '--source',
    'tool',
  ];
  const command = [config.cliCommand, ...args].map(quoteShellArg).join(' ');
  exec(command, {
    cwd: process.cwd(),
    timeout: config.timeoutMs,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
  }, (error, stdout, stderr) => {
    if (!error) {
      resolve(stdout);
      return;
    }
    reject(new Error(`Hermes CLI exit ${error.code ?? 'unknown'}: ${(stderr || stdout || error.message).slice(0, 600)}`));
  });
});

async function callHermesCli(config: ReturnType<typeof readConfig>, userPrompt: string, signal: AbortSignal) {
  const dir = await mkdtemp(join(tmpdir(), 'aiya-teacher-agent-'));
  const promptFile = join(dir, 'request.txt');
  try {
    await writeFile(promptFile, `${teacherSystemPrompt}\n\n请求 JSON:\n${userPrompt}\n`, 'utf8');
    if (signal.aborted) throw new Error('Hermes CLI 调用超时或被取消。');
    const output = await runHermesCli(config, promptFile);
    return extractJson(output);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function POST(request: Request) {
  const diagnosticId = createDiagnosticId('teacher_agent');
  const requestStartedAt = Date.now();
  let body: TeacherAgentRequest;
  try {
    body = (await request.json()) as TeacherAgentRequest;
  } catch {
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'teacher-agent',
      status: 'failed',
      severity: 'warn',
      route: '/api/teacher-agent',
      message: '请求体必须是 JSON。',
      durationMs: Date.now() - requestStartedAt,
    }).catch(() => undefined);
    return jsonError('请求体必须是 JSON。', 400, { diagnosticId });
  }

  if ((body.phase || 'warmup') === 'warmup') {
    return Response.json({
      ok: true,
      diagnosticId,
      provider: 'teacher-agent',
      model: 'fixed-warmup',
      apiType: 'local',
      reply: FIXED_WARMUP_REPLY,
      nextAction: 'ask_idea',
    });
  }

  if (isTaskStatusQuestion(String(body.userText || ''))) {
    return Response.json({ ok: true, diagnosticId, provider: 'task-state', model: 'actual-task-state', apiType: 'local', reply: actualTaskReply(body), nextAction: 'chat' });
  }

  const config = readConfig();
  if (!config.model) {
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'teacher-agent',
      status: 'failed',
      severity: 'error',
      route: '/api/teacher-agent',
      message: '老师 Agent 模型通道未配置。',
      durationMs: Date.now() - requestStartedAt,
      data: {
        phase: body.phase || 'warmup',
        userText: summarizeText(body.userText),
        missing: ['AIYA_TEACHER_AGENT_MODEL 或 HERMES_MODEL'],
      },
    }).catch(() => undefined);
    return jsonError('老师 Agent 模型通道未配置。', 503, {
      diagnosticId,
      missing: ['AIYA_TEACHER_AGENT_MODEL 或 HERMES_MODEL'],
    });
  }
  if (config.provider !== 'hermes-cli' && (!config.baseUrl || !config.apiKey)) {
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'teacher-agent',
      status: 'failed',
      severity: 'error',
      route: '/api/teacher-agent',
      message: '老师 Agent HTTP 模型通道未配置。',
      durationMs: Date.now() - requestStartedAt,
      model: config.model,
      provider: config.provider,
      apiType: config.apiType,
      data: {
        phase: body.phase || 'warmup',
        userText: summarizeText(body.userText),
        missing: ['AIYA_TEACHER_AGENT_BASE_URL 或 HERMES_BASE_URL'],
      },
    }).catch(() => undefined);
    return jsonError('老师 Agent HTTP 模型通道未配置。', 503, {
      diagnosticId,
      missing: ['AIYA_TEACHER_AGENT_BASE_URL 或 HERMES_BASE_URL'],
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const userPrompt = buildUserPrompt(body);
    const reply = config.provider === 'hermes-cli'
      ? await callHermesCli(config, userPrompt, controller.signal)
      : config.apiType === 'anthropic'
        ? await callAnthropic(config, userPrompt, controller.signal)
        : await callOpenAIChat(config, userPrompt, controller.signal);
    return Response.json({
      ok: true,
      diagnosticId,
      provider: 'teacher-agent',
      model: config.model,
      apiType: config.provider === 'hermes-cli' ? `hermes-cli/${config.cliProvider}` : config.apiType,
      ...sanitizeTeacherReply({ ...reply, reply: truthfulTeacherReply(reply.reply, body, reply.nextAction === 'start_generation' || reply.nextAction === 'revise') }, body.studentProfile || {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '老师 Agent 调用失败。';
    await writeDiagnosticEvent({
      id: diagnosticId,
      scope: 'teacher-agent',
      status: 'failed',
      severity: 'error',
      route: '/api/teacher-agent',
      message,
      durationMs: Date.now() - requestStartedAt,
      model: config.model,
      provider: config.provider,
      apiType: config.provider === 'hermes-cli' ? `hermes-cli/${config.cliProvider}` : config.apiType,
      data: {
        phase: body.phase || 'warmup',
        userText: summarizeText(body.userText),
        currentAppTitle: body.currentAppTitle || '',
        jobStatus: body.jobStatus || '',
        jobStage: body.jobStage || '',
        studentProfile: {
          nickname: body.studentProfile?.nickname || '',
          ageGroup: body.studentProfile?.ageGroup || '',
          pronoun: body.studentProfile?.pronoun || '',
          voiceprintEnrolled: Boolean(body.studentProfile?.voiceprintEnrolled),
          voiceprintSampleCount: body.studentProfile?.voiceprintSampleCount || 0,
        },
        error: errorToDiagnostic(error),
      },
    }).catch(() => undefined);
    return jsonError(message, 502, {
      diagnosticId,
      provider: 'teacher-agent',
      model: config.model,
      apiType: config.apiType,
    });
  } finally {
    clearTimeout(timer);
  }
}
