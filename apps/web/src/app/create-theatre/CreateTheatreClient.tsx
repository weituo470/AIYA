'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useVoiceInput, VoiceInputButton, type VoiceInputMetrics } from '../../features/voice-input';
import styles from './create-theatre.module.css';

import { aiBasicsQuizQuestions } from './_core/ai-basics-quiz';
import {
  appendNicknameQuestion,
  hasMeaningfulStudentHistory,
  inferStudentProfile,
  isAppBuildRequest,
  isAppRevisionRequest,
  profileSummary,
  removeNicknameQuestions,
  stripNicknameQuestions,
} from './_core/intent';
import { legacyStudentProfileStorageKey, studentMemoryStorageKey, writeStudentMemory } from './_core/student-memory';
import {
  firstAppSuggestions,
  formatDuration,
  looksLikeCorruptedText,
  makeStudentMessage,
  makeTeacherMessage,
  safeHtml,
  stageLabel,
  stages,
  teacherProgressScript,
  teacherVoiceOptions,
  versionLabel,
  warmupTeacherTip,
  warmupTeacherTitle,
  warmupTeacherVoiceText,
  welcomeTeacherText,
} from './_core/teacher-copy';
import type { CreateJob, StudentMemory, StudentProfile, TeacherChatMessage, ViewMode } from './_core/types';
import {
  buildReplayScenes,
  createEmptyReplaySample,
  filterReplayMessagesForSample,
  makeReplayVersion,
  normalizeReplaySample,
  saveReplayToLibrary,
  theatreReplayStorageKey,
  type TheatreReplaySample,
} from './_core/theatre-replay';
import { useCreateTheatrePublicSettings } from '../_shared/useCreateTheatrePublicSettings';
import {
  createVoiceprintEmbedding,
  extractVoiceprintNickname,
  formatVoiceprintScore,
  voiceprintStorageKey,
} from './_core/voiceprint';
import { useCreateTheatreJob } from './_hooks/useCreateTheatreJob';
import { useCreateTheatreGuide } from './_hooks/useCreateTheatreGuide';
import { useTeacherVoice } from './_hooks/useTeacherVoice';
import { GameGuideOverlay } from './_components/GameGuideOverlay';

const AUTO_VOICEPRINT_MIN_AUDIO_MS = 3000;
const AUTO_VOICEPRINT_LOGIN_MIN_AUDIO_MS = 1200;
const THEATRE_DEVICE_ID_KEY = 'aiya:create-theatre:device-id';
const VOICEPRINT_ENROLLMENT_SENTENCE = '今天很开心能学习AI编程';
const sourceTokenPattern = /(<!--[\s\S]*?-->|\/\*[\s\S]*?\*\/|<!doctype[^>]*>|<\/?[a-zA-Z][^>]*>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|if|else|for|while|switch|case|break|continue|new|class|document|window|addEventListener|querySelector|getElementById|Math|Date)\b|\b\d+(?:\.\d+)?\b)/gi;

const sourceTokenClass = (token: string) => {
  if (token.startsWith('<!--') || token.startsWith('/*')) return styles.sourceComment;
  if (token.startsWith('<')) return styles.sourceTag;
  if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) return styles.sourceString;
  if (/^\d/.test(token)) return styles.sourceNumber;
  return styles.sourceKeyword;
};

const highlightSourceCode = (source: string) => {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  source.replace(sourceTokenPattern, (token, _match, offset: number) => {
    if (offset > lastIndex) nodes.push(source.slice(lastIndex, offset));
    nodes.push(<span className={sourceTokenClass(token)} key={`${offset}-${token.slice(0, 12)}`}>{token}</span>);
    lastIndex = offset + token.length;
    return token;
  });
  if (lastIndex < source.length) nodes.push(source.slice(lastIndex));
  return nodes;
};

const isExplicitNewAppRequest = (text: string) => (
  isAppBuildRequest(text)
  && /做|开发|生成|制作|创建|写|弄/.test(text)
  && !/把|给.*加|增加|加入|添加|改|优化|完善|删除|去掉|换成|保留/.test(text)
);

type TeacherChatSendOptions = {
  preTeacherReply?: string;
  baseMessages?: TeacherChatMessage[];
  interactionId?: string;
};

const createInteractionId = () =>
  `cti_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

const reportTheatreInteraction = (payload: {
  interactionId: string;
  phase: string;
  message?: string;
  studentNickname?: string;
  userText?: string;
  teacherReply?: string;
  prompt?: string;
  currentAppTitle?: string;
  jobId?: string;
  decision?: Record<string, unknown>;
  routeState?: Record<string, unknown>;
  detail?: Record<string, unknown>;
}) => {
  void fetch('/api/create-theatre/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
};

const getTheatreDeviceId = () => {
  if (typeof window === 'undefined') return 'server-render';
  const existing = window.localStorage.getItem(THEATRE_DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `theatre-web-${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  window.localStorage.setItem(THEATRE_DEVICE_ID_KEY, created);
  return created;
};

const syncTheatreStudentMemory = async (payload: {
  profile: StudentProfile;
  chatMessages: TeacherChatMessage[];
  currentApp: unknown;
  voiceprint?: { embedding: number[]; sampleCount?: number; updatedAt?: string; model?: string };
}) => {
  if (!payload.profile.nickname) return;
  const response = await fetch('/api/create-theatre/student-memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      deviceId: getTheatreDeviceId(),
    }),
  }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
};

const stripVoiceprintFields = (profile: StudentProfile): StudentProfile => {
  const { voiceprintEnrolled, voiceprintSampleCount, voiceprintUpdatedAt, ...rest } = profile;
  return rest;
};

const clearLegacyLocalVoiceprints = () => {
  window.localStorage.removeItem(voiceprintStorageKey);
  const raw = window.localStorage.getItem(studentMemoryStorageKey);
  if (!raw) return;
  const memories = JSON.parse(raw) as Record<string, StudentMemory>;
  if (!memories || typeof memories !== 'object') return;
  Object.keys(memories).forEach((key) => {
    if (!memories[key]?.profile) return;
    memories[key] = {
      ...memories[key],
      profile: stripVoiceprintFields(memories[key].profile),
    };
  });
  window.localStorage.setItem(studentMemoryStorageKey, JSON.stringify(memories));
};

const fetchTheatreStudentMemory = async (nickname?: string): Promise<StudentMemory | null> => {
  if (!nickname) return null;
  const response = await fetch(`/api/create-theatre/student-memory?nickname=${encodeURIComponent(nickname)}`, {
    cache: 'no-store',
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => null) : null;
  if (!response?.ok || !payload?.ok || !payload.memory) return null;
  const memory = payload.memory as StudentMemory;
  const profile = {
    ...(payload.student?.profile || memory.profile || {}),
    nickname: payload.student?.nickname || memory.profile?.nickname || nickname,
    voiceprintEnrolled: Boolean(payload.student?.voiceprint || memory.profile?.voiceprintEnrolled),
    voiceprintSampleCount: payload.student?.voiceprint?.sampleCount || memory.profile?.voiceprintSampleCount,
    voiceprintUpdatedAt: payload.student?.voiceprint?.updatedAt || memory.profile?.voiceprintUpdatedAt,
  };
  return {
    profile,
    chatMessages: Array.isArray(memory.chatMessages) ? memory.chatMessages : [],
    currentApp: memory.currentApp || null,
    updatedAt: memory.updatedAt || new Date().toISOString(),
  };
};


export default function CreateTheatreClient() {
  const classroomSettings = useCreateTheatrePublicSettings();
  const [prompt, setPrompt] = useState('');
  const [view, setView] = useState<ViewMode>('preview');
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswerIndex, setQuizAnswerIndex] = useState<number | null>(null);
  const [quizCorrectCount, setQuizCorrectCount] = useState(0);
  const [teacherVoiceEnabled, setTeacherVoiceEnabled] = useState(true);
  const {
    selectedTeacherVoice,
    selectedTeacherVoiceOption,
    teacherVoiceStatus,
    teacherVoiceMessage,
    hasPendingTeacherSpeech,
    resumePendingTeacherSpeech,
    stopTeacherVoice,
    changeTeacherVoice,
    speakTeacher,
  } = useTeacherVoice();
  const [teacherAgentReply, setTeacherAgentReply] = useState('');
  const [teacherAgentStatus, setTeacherAgentStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [studentProfile, setStudentProfile] = useState<StudentProfile>({});
  const [teacherChatMessages, setTeacherChatMessages] = useState<TeacherChatMessage[]>([]);
  const [teacherChatInput, setTeacherChatInput] = useState('');
  const [isTeacherChatting, setIsTeacherChatting] = useState(false);
  const [lastInteractionId, setLastInteractionId] = useState('');
  const [failureRetryUsed, setFailureRetryUsed] = useState(false);
  const [voiceprintStatus, setVoiceprintStatus] = useState('\u58f0\u7eb9\u767b\u5f55\u662f\u4f53\u9a8c\u539f\u578b\uff0c\u4e0d\u7528\u4e8e\u9ad8\u5b89\u5168\u8ba4\u8bc1\u3002');
  const [storageReady, setStorageReady] = useState(false);
  const [autoStartPrompt, setAutoStartPrompt] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [microphonePermission, setMicrophonePermission] = useState<'checking' | 'unknown' | 'granted' | 'denied' | 'unsupported'>('checking');
  const [microphoneMessage, setMicrophoneMessage] = useState('正在检测麦克风权限。');
  const [replaySample, setReplaySample] = useState<TheatreReplaySample>(() => createEmptyReplaySample());
  const [replayStep, setReplayStep] = useState(0);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replayNotice, setReplayNotice] = useState('');

  const handleJobCompleted = useCallback((nextVersion: number, completedJob: CreateJob) => {
    const completionText = `${versionLabel(nextVersion)}\u5b8c\u6210\u4e86\u3002\u73b0\u5728\u4f60\u53ef\u4ee5\u8bd5\u73a9\uff0c\u4e5f\u53ef\u4ee5\u7ee7\u7eed\u8f93\u5165\u60f3\u4f18\u5316\u7684\u5730\u65b9\u3002`;
    setTeacherChatMessages((messages) => [...messages, makeTeacherMessage(completionText)].slice(-50));
    if (completedJob.interactionId) {
      reportTheatreInteraction({
        interactionId: completedJob.interactionId,
        phase: 'generation_completed',
        message: 'create-theatre generation completed',
        teacherReply: completionText,
        prompt: completedJob.prompt,
        jobId: completedJob.id,
        currentAppTitle: completedJob.result?.title || '',
        decision: { version: nextVersion, status: completedJob.status },
      });
    }
    const replayVersion = makeReplayVersion(nextVersion, completedJob);
    if (!replayVersion) return;
    setReplaySample((sample) => ({
      ...sample,
      title: `${sample.studentName || '学生'}的 AI 编程课堂回放`,
      versions: [...sample.versions.filter((item) => item.version !== nextVersion), replayVersion].slice(-12),
      updatedAt: new Date().toISOString(),
    }));
    setReplayNotice(`${versionLabel(nextVersion)}已加入回放素材。`);
  }, []);

  const {
    job,
    currentApp,
    error,
    setError,
    isActive,
    result,
    events,
    elapsed,
    visibleAppVersion,
    startCreateJob,
    restoreCurrentApp,
  } = useCreateTheatreJob({
    onCompleted: handleJobCompleted,
    modelMode: classroomSettings.modelMode,
    teacherProfile: classroomSettings.teacher,
  });
  const guide = useCreateTheatreGuide();

  const teacherChatInputRef = useRef<HTMLInputElement | null>(null);
  const cursorRef = useRef({ start: 0, end: 0 });
  const studentProfileRef = useRef<StudentProfile>({});
  const voiceprintModeRef = useRef<'idle' | 'enroll' | 'login'>('idle');
  const voiceprintAudioChunksRef = useRef<ArrayBuffer[]>([]);
  const autoVoiceprintAudioChunksRef = useRef<ArrayBuffer[]>([]);
  const autoVoiceprintNoticeNamesRef = useRef(new Set<string>());
  const voiceprintGuideNamesRef = useRef(new Set<string>());
  const spokenTeacherMessageRef = useRef('');
  const replayHydratedRef = useRef(false);
  const replayPlaybackRunRef = useRef(0);
  const replayProjectIdRef = useRef('');
  const teacherChatEndRef = useRef<HTMLDivElement | null>(null);
  const sendTeacherChatRef = useRef<(text?: string, options?: TeacherChatSendOptions) => Promise<void> | void>(() => undefined);
  const autoStartMetaRef = useRef<{ interactionId?: string; replaceCurrentApp?: boolean }>({});
  const microphoneReady = microphonePermission === 'granted';

  const clearReplayProject = useCallback(() => {
    const emptySample = createEmptyReplaySample();
    replayPlaybackRunRef.current += 1;
    replayProjectIdRef.current = emptySample.projectId;
    setIsReplayPlaying(false);
    setReplayStep(0);
    setReplayNotice('');
    setReplaySample(emptySample);
  }, []);

  const beginReplayProject = useCallback((
    projectId: string,
    messages: TeacherChatMessage[],
    profile: StudentProfile,
  ) => {
    const nextSample = createEmptyReplaySample({
      projectId,
      studentName: profile.nickname,
      messages,
    });
    replayPlaybackRunRef.current += 1;
    replayProjectIdRef.current = nextSample.projectId;
    stopTeacherVoice();
    setIsReplayPlaying(false);
    setReplayStep(0);
    setReplayNotice('');
    setReplaySample(nextSample);
  }, [stopTeacherVoice]);

  const activeStageIndex = Math.max(0, stages.findIndex((item) => item.key === (job?.stage || 'queued')));
  const loginStatusName = studentProfile.nickname || '\u6e38\u5ba2';
  const profileStatusText = studentProfile.nickname ? '\u5efa\u6863\u5df2\u5b8c\u6210' : '\u6e38\u5ba2\u672a\u5efa\u6863';
  const voiceprintStatusText = studentProfile.voiceprintEnrolled
    ? `\u58f0\u7eb9\u5df2\u5f55\u5236${studentProfile.voiceprintSampleCount ? ` \u00b7 ${studentProfile.voiceprintSampleCount}\u6b21` : ''}`
    : studentProfile.nickname ? '\u58f0\u7eb9\u5f85\u5f55\u5236' : '\u58f0\u7eb9\u672a\u5f55\u5236';
  const voiceprintGuideStatus = (nickname: string) => `已为${nickname}建档。之后你使用语音输入时，我会自动完成声纹记录。`;
  const quizQuestion = aiBasicsQuizQuestions[quizIndex % aiBasicsQuizQuestions.length];
  const quizAnswered = quizAnswerIndex !== null;
  const quizIsCorrect = quizAnswered && quizAnswerIndex === quizQuestion.answerIndex;
  const highlightedSource = useMemo(
    () => highlightSourceCode(result?.html || '还没有源码。'),
    [result?.html],
  );
  const handleQuizAnswer = (answerIndex: number) => {
    if (quizAnswered) return;
    setQuizAnswerIndex(answerIndex);
    if (answerIndex === quizQuestion.answerIndex) {
      setQuizCorrectCount((count) => count + 1);
    }
  };
  const nextQuizQuestion = () => {
    setQuizIndex((index) => (index + 1) % aiBasicsQuizQuestions.length);
    setQuizAnswerIndex(null);
  };

  const handleDownloadHtml = () => {
    const html = result?.html;
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aiya-demo-v${visibleAppVersion || 1}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const replayScenes = useMemo(() => buildReplayScenes(replaySample), [replaySample]);
  const activeReplayScene = replayScenes[Math.min(replayStep, Math.max(0, replayScenes.length - 1))];

  const speakReplayScene = useCallback((step: number) => {
    const scene = replayScenes[Math.min(step, Math.max(0, replayScenes.length - 1))];
    if (!scene) return;
    replayPlaybackRunRef.current += 1;
    setIsReplayPlaying(false);
    void speakTeacher(scene.narration);
  }, [replayScenes, speakTeacher]);

  const handleSaveReplaySample = () => {
    if (!replaySample.versions.length) {
      setReplayNotice('当前还没有完整作品可保存。先完成一次生成，再保存回放样本。');
      return;
    }
    const saved = saveReplayToLibrary({
      ...replaySample,
      title: replaySample.studentName ? `${replaySample.studentName}的 AI 编程课堂回放` : replaySample.title,
      updatedAt: new Date().toISOString(),
    });
    setReplaySample(saved);
    setReplayNotice('已保存为学习样本，新用户可以用它查看完整创作过程。');
  };

  const handleSelectReplayStep = (step: number) => {
    if (!replayScenes.length) return;
    replayPlaybackRunRef.current += 1;
    setIsReplayPlaying(false);
    setReplayStep(step);
    speakReplayScene(step);
  };

  const handleToggleReplay = () => {
    if (!replayScenes.length) {
      setReplayNotice('当前项目还没有可回放内容。完成一个作品后再播放。');
      return;
    }
    if (isReplayPlaying) {
      replayPlaybackRunRef.current += 1;
      setIsReplayPlaying(false);
      stopTeacherVoice();
      return;
    }
    setReplayNotice('');
    setIsReplayPlaying(true);
  };

  useEffect(() => {
    studentProfileRef.current = studentProfile;
  }, [studentProfile]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(theatreReplayStorageKey);
      if (raw) {
        const normalized = normalizeReplaySample(JSON.parse(raw));
        replayProjectIdRef.current = normalized.projectId;
        setReplaySample(normalized);
      }
    } catch {}
    replayHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!replayHydratedRef.current) return;
    try {
      window.localStorage.setItem(theatreReplayStorageKey, JSON.stringify(replaySample));
    } catch {}
  }, [replaySample]);

  useEffect(() => {
    if (!studentProfile.nickname) return;
    setReplaySample((sample) => ({
      ...sample,
      studentName: studentProfile.nickname,
      title: `${studentProfile.nickname}的 AI 编程课堂回放`,
      updatedAt: new Date().toISOString(),
    }));
  }, [studentProfile.nickname]);

  useEffect(() => {
    setReplaySample((sample) => ({
      ...sample,
      messages: filterReplayMessagesForSample(sample, teacherChatMessages),
      updatedAt: new Date().toISOString(),
    }));
  }, [teacherChatMessages]);

  useEffect(() => {
    if (!isReplayPlaying || !activeReplayScene) return;
    let cancelled = false;
    const runId = replayPlaybackRunRef.current + 1;
    replayPlaybackRunRef.current = runId;

    const playCurrentScene = async () => {
      await speakTeacher(activeReplayScene.narration);
      if (cancelled || replayPlaybackRunRef.current !== runId) return;
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 650);
      });
      if (cancelled || replayPlaybackRunRef.current !== runId) return;
      setReplayStep((step) => {
        if (step >= replayScenes.length - 1) {
          setIsReplayPlaying(false);
          return step;
        }
        return step + 1;
      });
    };

    void playCurrentScene();
    return () => {
      cancelled = true;
    };
  }, [activeReplayScene, isReplayPlaying, replayScenes.length, speakTeacher]);


  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophonePermission('unsupported');
      setMicrophoneMessage('当前浏览器不支持网页麦克风录音，请换用 Chrome、Edge 或系统浏览器。');
      return;
    }

    let permissionStatus: PermissionStatus | null = null;
    const applyPermissionState = (state?: PermissionState) => {
      if (state === 'granted') {
        setMicrophonePermission('granted');
        setMicrophoneMessage('麦克风已开启。请按住 1 秒，等按钮变绿后再开始说话。');
        return;
      }
      if (state === 'denied') {
        setMicrophonePermission('denied');
        setMicrophoneMessage('麦克风权限已被拒绝。请在浏览器地址栏、系统设置或微信权限里允许麦克风。');
        return;
      }
      setMicrophonePermission('unknown');
      setMicrophoneMessage('请先点击开启麦克风。授权成功后，按住 1 秒等按钮变绿后再说。');
    };

    if (!navigator.permissions?.query) {
      applyPermissionState('prompt');
      return;
    }

    navigator.permissions.query({ name: 'microphone' as PermissionName })
      .then((status) => {
        permissionStatus = status;
        applyPermissionState(status.state);
        status.onchange = () => applyPermissionState(status.state);
      })
      .catch(() => applyPermissionState('prompt'));

    return () => {
      if (permissionStatus) permissionStatus.onchange = null;
    };
  }, []);

  const requestMicrophonePermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicrophonePermission('unsupported');
      setMicrophoneMessage('当前浏览器不支持网页麦克风录音，请换用 Chrome、Edge 或系统浏览器。');
      return;
    }

    setMicrophonePermission('checking');
    setMicrophoneMessage('正在请求麦克风权限，请在弹窗里选择允许。');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getTracks().forEach((track) => track.stop());
      setMicrophonePermission('granted');
      setMicrophoneMessage('麦克风已开启。请按住 1 秒，等按钮变绿后再开始说话。');
    } catch (error) {
      const browserError = error as DOMException;
      if (browserError?.name === 'NotAllowedError' || browserError?.name === 'PermissionDeniedError') {
        setMicrophonePermission('denied');
        setMicrophoneMessage('你刚才拒绝了麦克风权限。请在浏览器或系统设置里允许麦克风后再试。');
        return;
      }
      if (browserError?.name === 'NotFoundError' || browserError?.name === 'DevicesNotFoundError') {
        setMicrophonePermission('unsupported');
        setMicrophoneMessage('没有检测到可用麦克风，请检查系统输入设备。');
        return;
      }
      setMicrophonePermission('unknown');
      setMicrophoneMessage('麦克风开启失败，请重新点击开启麦克风。');
    }
  }, []);

  const visibleAppVersionLabel = visibleAppVersion ? versionLabel(visibleAppVersion) : '第一版';
  const teacherTitle = isActive ? '老师正在写代码' : currentApp ? `${visibleAppVersionLabel}已经完成，可以继续完善` : warmupTeacherTitle;
  const teacherTip = isActive
    ? teacherProgressScript(job?.stage, job?.attempts)
    : currentApp
      ? `我完成了${visibleAppVersionLabel}
我等你试玩
你可以继续告诉我想改哪里`
      : warmupTeacherTip;
  const displayedTeacherTip = isActive ? teacherTip : currentApp ? teacherTip : teacherAgentReply || teacherTip;
  const teacherSupportText = displayedTeacherTip.trim() === teacherTitle.trim() ? warmupTeacherTip : displayedTeacherTip;
  const teacherVoiceText = `${teacherTitle}。${teacherSupportText}`;
  const latestTeacherMessage = [...teacherChatMessages].reverse().find((message) => message.role === 'teacher');
  const teacherVoiceIsActive = teacherVoiceStatus === 'loading' || teacherVoiceStatus === 'speaking' || teacherVoiceStatus === 'fallback';

  const rememberCursor = () => {
    const element = teacherChatInputRef.current;
    if (!element) return;
    cursorRef.current = {
      start: element.selectionStart ?? teacherChatInput.length,
      end: element.selectionEnd ?? teacherChatInput.length,
    };
  };

  const buildInputWithVoiceText = (current: string, text: string) => {
    const value = text.trim();
    const start = Math.max(0, Math.min(cursorRef.current.start, current.length));
    const end = Math.max(start, Math.min(cursorRef.current.end, current.length));
    const before = current.slice(0, start);
    const after = current.slice(end);
    const next = `${before}${before && !/\s$/.test(before) ? ' ' : ''}${value}${after && !/^\s/.test(after) ? ' ' : ''}${after}`;
    const nextCursor = next.length - after.length;
    return { next, nextCursor };
  };

  const maybeAutoEnrollVoiceprint = (text: string, embedding: number[] | null, metrics?: VoiceInputMetrics) => {
    const activeProfile = studentProfileRef.current;
    if (activeProfile.voiceprintEnrolled || !embedding || !metrics || metrics.audioMs < AUTO_VOICEPRINT_MIN_AUDIO_MS) {
      return;
    }

    const nickname = activeProfile.nickname;
    if (!nickname) {
      return;
    }
    const nextProfile = inferStudentProfile(activeProfile, text);

    const now = new Date().toISOString();
    const sampleCount = 1;
    const enrolledProfile = {
      ...nextProfile,
      nickname,
      voiceprintEnrolled: true,
      voiceprintSampleCount: sampleCount,
      voiceprintUpdatedAt: now,
      updatedAt: now,
    };
    studentProfileRef.current = enrolledProfile;
    setStudentProfile(enrolledProfile);

    const status = `${nickname}，我已经在这次语音输入中自动完成声纹记录。`;
    setVoiceprintStatus(status);
    autoVoiceprintNoticeNamesRef.current.add(nickname.toLocaleLowerCase());
    void syncTheatreStudentMemory({
      profile: enrolledProfile,
      chatMessages: teacherChatMessages,
      currentApp,
      voiceprint: { embedding, sampleCount, updatedAt: now },
    });
  };

  const maybeRecognizeServerVoiceprintFromChat = async (embedding: number[] | null, metrics?: VoiceInputMetrics): Promise<TeacherChatSendOptions | null> => {
    if (!embedding || !metrics || metrics.audioMs < AUTO_VOICEPRINT_LOGIN_MIN_AUDIO_MS) return null;
    if (studentProfileRef.current.voiceprintEnrolled) return null;

    const response = await fetch('/api/create-theatre/voiceprints/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedding }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;
    if (!response?.ok || !payload?.ok || !payload.matched || !payload.student?.nickname) return null;

    const nickname = String(payload.student.nickname);
    const memory = payload.memory || null;
    const restoredProfile = {
      ...(payload.student.profile || studentProfileRef.current),
      nickname,
      voiceprintEnrolled: true,
      voiceprintSampleCount: payload.student.voiceprint?.sampleCount,
      voiceprintUpdatedAt: payload.student.voiceprint?.updatedAt,
      updatedAt: new Date().toISOString(),
    };
    const hasHistory = Array.isArray(memory?.chatMessages) && memory.chatMessages.length > 1;
    const reply = hasHistory
      ? `\u6211\u542c\u51fa\u6765\u4e86\uff0c\u662f${nickname}\u3002\u6b22\u8fce\u56de\u6765\uff0c\u6211\u5df2\u7ecf\u628a\u4f60\u7684\u5b66\u4e60\u6863\u6848\u8c03\u51fa\u6765\u4e86\u3002`
      : `\u6211\u542c\u51fa\u6765\u4e86\uff0c\u662f${nickname}\u3002\u6b22\u8fce\u56de\u6765\uff0c\u6211\u4eec\u53ef\u4ee5\u7ee7\u7eed\u4ece\u4e00\u4e2a\u5c0f\u5e94\u7528\u5f00\u59cb\u3002`;

    studentProfileRef.current = restoredProfile;
    setStudentProfile(restoredProfile);
    restoreCurrentApp(memory?.currentApp || null);
    clearReplayProject();
    setVoiceprintStatus(reply);

    return {
      preTeacherReply: reply,
      baseMessages: hasHistory ? memory.chatMessages.slice(-48) : undefined,
    };
  };

  const makeVoiceprintGuideReply = (nickname: string) => `好的，${nickname}。我已经为你建立学习档案。
之后你使用语音输入时，我会自动完成声纹记录。`;

  const commitVoiceAndSend = async (text: string, metrics?: VoiceInputMetrics) => {
    const value = text.trim();
    if (!value) {
      autoVoiceprintAudioChunksRef.current = [];
      return;
    }
    const embedding = metrics && metrics.audioMs >= AUTO_VOICEPRINT_LOGIN_MIN_AUDIO_MS
      ? createVoiceprintEmbedding(autoVoiceprintAudioChunksRef.current)
      : null;
    autoVoiceprintAudioChunksRef.current = [];
    maybeAutoEnrollVoiceprint(value, embedding, metrics);
    const current = teacherChatInputRef.current?.value ?? teacherChatInput;
    const { next, nextCursor } = buildInputWithVoiceText(current, value);
    setTeacherChatInput(next);

    const voiceprintLoginOptions = await Promise.race([
      maybeRecognizeServerVoiceprintFromChat(embedding, metrics),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 800)),
    ]).catch(() => null);

    window.requestAnimationFrame(() => {
      teacherChatInputRef.current?.focus();
      teacherChatInputRef.current?.setSelectionRange(nextCursor, nextCursor);
      cursorRef.current = { start: nextCursor, end: nextCursor };
      sendTeacherChatRef.current(next, voiceprintLoginOptions || undefined);
    });
  };

  const voice = useVoiceInput({
    hotwords: ['AIYA', '\u8001\u5E08', '\u5E94\u7528', '\u7F16\u7A0B', '\u751F\u6210', '\u4EE3\u7801', '\u6211\u662F', '\u53EB\u6211'],
    releaseTailMs: 2000,
    onCommit: commitVoiceAndSend,
    onAudioChunk: (chunk) => autoVoiceprintAudioChunksRef.current.push(chunk),
    onError: () => {
      autoVoiceprintAudioChunksRef.current = [];
    },
  });

  const chatVoice = {
    ...voice,
    start: (point: Parameters<typeof voice.start>[0]) => {
      autoVoiceprintAudioChunksRef.current = [];
      return voice.start(point);
    },
    cancel: () => {
      autoVoiceprintAudioChunksRef.current = [];
      return voice.cancel();
    },
  };

  const recognizedVoiceText = `${voice.finalText}${voice.partialText}`.trim();
  const voiceHelpText = voice.errorMessage
    || (voice.state === 'done' && recognizedVoiceText ? `已识别并发送：${recognizedVoiceText}`
      : voice.isActive && recognizedVoiceText ? `正在识别：${recognizedVoiceText}`
        : voice.statusText);

  const handleVoiceprintCommit = useCallback(async (text: string) => {
    const mode = voiceprintModeRef.current;
    voiceprintModeRef.current = 'idle';
    const embedding = createVoiceprintEmbedding(voiceprintAudioChunksRef.current);
    voiceprintAudioChunksRef.current = [];
    let nickname = extractVoiceprintNickname(text, studentProfile.nickname);

    if (!embedding) {
      const reply = '\u8FD9\u6B21\u58F0\u7EB9\u592A\u77ED\u4E86\uFF0C\u8BF7\u6E05\u695A\u8BF4\u51FA 2 \u5230 4 \u79D2\u5185\u5BB9\u3002';
      setVoiceprintStatus(reply);
      setTeacherChatMessages((messages) => [...messages, makeTeacherMessage(reply)].slice(-50));
      return;
    }

    if (!nickname && mode !== 'login') {
      const reply = '\u6211\u8FD8\u4E0D\u77E5\u9053\u4F60\u7684\u79F0\u547C\uFF0C\u5148\u544A\u8BC9\u6211\u4F60\u53EB\u4EC0\u4E48\u5427\u3002';
      setVoiceprintStatus(reply);
      setTeacherChatMessages((messages) => [...messages, makeTeacherMessage(reply)].slice(-50));
      return;
    }

    if (mode === 'enroll') {
      const now = new Date().toISOString();
      const sampleCount = Math.max(1, (studentProfile.voiceprintSampleCount || 0) + 1);
      const nextProfile = inferStudentProfile(studentProfile, `\u6211\u53EB${nickname}`);
      const enrolledProfile = {
        ...nextProfile,
        voiceprintEnrolled: true,
        voiceprintSampleCount: sampleCount,
        voiceprintUpdatedAt: now,
        updatedAt: now,
      };
      studentProfileRef.current = enrolledProfile;
      setStudentProfile(enrolledProfile);
      const saved = await syncTheatreStudentMemory({
        profile: enrolledProfile,
        chatMessages: teacherChatMessages,
        currentApp,
        voiceprint: { embedding, sampleCount, updatedAt: now },
      });
      const reply = saved?.ok
        ? `\u597D\u7684\uFF0C${nickname}\uFF0C\u58F0\u7EB9\u5EFA\u6863\u5B8C\u6210\u3002\u4E0B\u6B21\u4F60\u544A\u8BC9\u6211\u81EA\u5DF1\u662F\u8C01\uFF0C\u6211\u5C31\u80FD\u7EE7\u7EED\u5E26\u4F60\u5B66\u3002`
        : '\u58F0\u7EB9\u5EFA\u6863\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5\u3002';
      setVoiceprintStatus(reply);
      setTeacherChatMessages((messages) => [...messages, makeStudentMessage(text), makeTeacherMessage(reply)].slice(-50));
      return;
    }

    const hasSpokenNickname = Boolean(nickname);
    const response = await fetch('/api/create-theatre/voiceprints/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embedding }),
    }).catch(() => null);
    const payload = response ? await response.json().catch(() => null) : null;

    if (!response?.ok || !payload?.ok) {
      const reply = '\u6211\u8FD8\u4E0D\u77E5\u9053\u4F60\u7684\u79F0\u547C\uFF0C\u5148\u544A\u8BC9\u6211\u4F60\u53EB\u4EC0\u4E48\u5427\u3002';
      setVoiceprintStatus(reply);
      setTeacherChatMessages((messages) => [...messages, makeStudentMessage(text), makeTeacherMessage(reply)].slice(-50));
      return;
    }

    if (!payload.matched || !payload.student?.nickname) {
      const reply = hasSpokenNickname && nickname
        ? `\u6211\u8FD8\u4E0D\u80FD\u786E\u8BA4\u4F60\u662F${nickname}\u3002\u5982\u679C\u4F60\u662F\u65B0\u540C\u5B66\uFF0C\u5148\u544A\u8BC9\u6211\u4F60\u7684\u79F0\u547C\u5427\u3002`
        : `\u6211\u8FD8\u6CA1\u80FD\u901A\u8FC7\u58F0\u7EB9\u8BA4\u51FA\u4F60\u3002\u5F53\u524D\u5339\u914D\u5206\uFF1A${formatVoiceprintScore(Number(payload.score || 0))}\u3002`;
      setVoiceprintStatus(reply);
      setTeacherChatMessages((messages) => [...messages, makeStudentMessage(text), makeTeacherMessage(reply)].slice(-50));
      return;
    }

    const matchedNickname = String(payload.student.nickname);
    if (hasSpokenNickname && nickname && matchedNickname.toLocaleLowerCase() !== nickname.toLocaleLowerCase()) {
      const reply = `\u6211\u542C\u5230\u4F60\u8BF4\u662F${nickname}\uFF0C\u4F46\u58F0\u7EB9\u66F4\u50CF${matchedNickname}\u3002\u6211\u6682\u65F6\u4E0D\u81EA\u52A8\u5207\u6362\u6863\u6848\u3002`;
      setVoiceprintStatus(reply);
      setTeacherChatMessages((messages) => [...messages, makeStudentMessage(text), makeTeacherMessage(reply)].slice(-50));
      return;
    }

    nickname = matchedNickname;
    const memory = payload.memory as StudentMemory | null;
    const restoredProfile = {
      ...(payload.student.profile || memory?.profile || studentProfile),
      nickname,
      voiceprintEnrolled: true,
      voiceprintSampleCount: payload.student.voiceprint?.sampleCount,
      voiceprintUpdatedAt: payload.student.voiceprint?.updatedAt,
      updatedAt: new Date().toISOString(),
    };
    const hasHistory = Boolean(memory && hasMeaningfulStudentHistory(memory));
    const reply = hasHistory
      ? `\u6211\u542C\u51FA\u6765\u4E86\uFF0C\u662F${nickname}\u3002\u6B22\u8FCE\u56DE\u6765\u3002\n\u6211\u5DF2\u7ECF\u628A\u4F60\u7684\u5B66\u4E60\u6863\u6848\u548C\u4E0A\u6B21\u8FDB\u5EA6\u8C03\u51FA\u6765\u4E86\u3002`
      : `\u6211\u542C\u51FA\u6765\u4E86\uFF0C\u662F${nickname}\u3002\n\u6B22\u8FCE\u56DE\u6765\uFF0C\u4F46\u4F60\u8FD8\u6CA1\u6709\u4F5C\u54C1\u5386\u53F2\uFF0C\u6211\u4EEC\u53EF\u4EE5\u4ECE\u4E00\u4E2A\u65B0\u5E94\u7528\u5F00\u59CB\u3002`;
    studentProfileRef.current = restoredProfile;
    setStudentProfile(restoredProfile);
    restoreCurrentApp(memory?.currentApp || null);
    clearReplayProject();
    setVoiceprintStatus(reply);
    if (hasHistory) {
      setTeacherChatMessages([...(memory?.chatMessages || []).slice(-48), makeTeacherMessage(reply)]);
    } else {
      setTeacherChatMessages((messages) => [...messages, makeStudentMessage(text), makeTeacherMessage(reply)].slice(-50));
    }
  }, [clearReplayProject, currentApp, restoreCurrentApp, studentProfile, teacherChatMessages]);

  const voiceprintVoice = useVoiceInput({
    hotwords: ['AIYA', '\u8001\u5e08', '\u58f0\u7eb9', '\u767b\u5f55', '\u6211\u662f', '\u53eb\u6211'],
    onAudioChunk: (chunk) => voiceprintAudioChunksRef.current.push(chunk),
    onCommit: handleVoiceprintCommit,
    onError: (error) => setVoiceprintStatus(error.message),
  });

  const makeVoiceprintVoice = (mode: 'enroll' | 'login') => ({
    ...voiceprintVoice,
    start: (point: Parameters<typeof voiceprintVoice.start>[0]) => {
      voiceprintModeRef.current = mode;
      voiceprintAudioChunksRef.current = [];
      const nickname = studentProfileRef.current.nickname;
      setVoiceprintStatus(mode === 'enroll'
        ? (nickname ? `正在建立声纹档案：请清楚念“${VOICEPRINT_ENROLLMENT_SENTENCE}”。` : `正在建立声纹档案：请先告诉老师你的称呼，再念“${VOICEPRINT_ENROLLMENT_SENTENCE}”。`)
        : '\u6b63\u5728\u58f0\u7eb9\u767b\u5f55\uff1a\u8bf7\u8bf4\u51fa\u4f60\u7684\u540d\u5b57\u3002');
      return voiceprintVoice.start(point);
    },
  });
  const voiceprintEnrollVoice = makeVoiceprintVoice('enroll');
  const voiceprintLoginVoice = makeVoiceprintVoice('login');
  const voiceprintHelpText = voiceprintVoice.errorMessage
    || (voiceprintVoice.finalText || voiceprintVoice.partialText ? `\u6b63\u5728\u8bc6\u522b\uff1a${voiceprintVoice.finalText}${voiceprintVoice.partialText}` : voiceprintStatus);

  useEffect(() => {
    try {
      clearLegacyLocalVoiceprints();
      window.localStorage.removeItem(legacyStudentProfileStorageKey);
      window.localStorage.removeItem('aiya:create-theatre:teacher-chat');
      setTeacherChatMessages([
        makeTeacherMessage(warmupTeacherVoiceText),
      ]);
    } catch {
      setTeacherChatMessages([
        makeTeacherMessage(warmupTeacherVoiceText),
      ]);
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady || !studentProfile.nickname) return;
    writeStudentMemory({
      profile: studentProfile,
      chatMessages: teacherChatMessages.slice(-50),
      currentApp,
      updatedAt: new Date().toISOString(),
    });
    void syncTheatreStudentMemory({
      profile: studentProfile,
      chatMessages: teacherChatMessages.slice(-50),
      currentApp,
    });
  }, [currentApp, storageReady, studentProfile, teacherChatMessages]);

  useEffect(() => {
    setTeacherChatMessages((messages) => {
      let changed = false;
      const next = messages.map((message) => {
        if (message.role !== 'teacher' || !looksLikeCorruptedText(message.text)) return message;
        changed = true;
        return { ...message, text: welcomeTeacherText };
      });
      return changed ? next : messages;
    });
  });

  useEffect(() => {
    teacherChatEndRef.current?.scrollIntoView({ block: 'end' });
  }, [teacherChatMessages, isTeacherChatting]);

  useEffect(() => {
    if (!teacherVoiceEnabled || guide.isGuideOpen) return;
    if (!latestTeacherMessage || spokenTeacherMessageRef.current === latestTeacherMessage.id) return;
    spokenTeacherMessageRef.current = latestTeacherMessage.id;
    void speakTeacher(latestTeacherMessage.text);
  }, [guide.isGuideOpen, latestTeacherMessage, speakTeacher, teacherVoiceEnabled]);

  const sendTeacherChat = useCallback(async (text = teacherChatInput, options: TeacherChatSendOptions = {}) => {
    const value = text.trim();
    if (!value || isTeacherChatting) return;
    const interactionId = options.interactionId || createInteractionId();
    setLastInteractionId(interactionId);
    const activeStudentProfile = studentProfileRef.current;
    const nextProfile = inferStudentProfile(activeStudentProfile, value);
    const isNamingSelf = Boolean(nextProfile.nickname && nextProfile.nickname !== activeStudentProfile.nickname);
    reportTheatreInteraction({
      interactionId,
      phase: 'student_message',
      message: 'student sent create-theatre chat message',
      studentNickname: nextProfile.nickname || activeStudentProfile.nickname,
      userText: value,
      currentAppTitle: currentApp?.title || '',
      routeState: {
        hasCurrentApp: Boolean(currentApp?.html),
        isActive,
        jobStatus: job?.status || '',
        jobStage: job?.stage || '',
      },
    });

    if (isNamingSelf) {
      const memory = await fetchTheatreStudentMemory(nextProfile.nickname);
      if (memory && hasMeaningfulStudentHistory(memory)) {
        const restoredProfile = {
          ...memory.profile,
          ageGroup: nextProfile.ageGroup || memory.profile.ageGroup,
          pronoun: nextProfile.pronoun || memory.profile.pronoun,
          updatedAt: new Date().toISOString(),
        };
        const needsVoiceprint = !restoredProfile.voiceprintEnrolled;
        const voiceprintReply = needsVoiceprint && restoredProfile.nickname ? makeVoiceprintGuideReply(restoredProfile.nickname) : '';
        const welcome = `${restoredProfile.nickname}\uFF0C\u6B22\u8FCE\u56DE\u6765\u3002\n\u6211\u628A\u4F60\u4E0A\u6B21\u7684\u5BF9\u8BDD\u548C\u5B66\u4E60\u8FDB\u5EA6\u8C03\u51FA\u6765\u4E86\u3002${voiceprintReply ? `\n${voiceprintReply}` : ''}`;
        studentProfileRef.current = restoredProfile;
        setStudentProfile(restoredProfile);
        setTeacherChatMessages([
          ...(memory.chatMessages || []).slice(-48),
          makeTeacherMessage(welcome),
        ]);
        if (needsVoiceprint && restoredProfile.nickname) {
          setVoiceprintStatus(voiceprintGuideStatus(restoredProfile.nickname));
        }
        restoreCurrentApp(memory.currentApp || null);
        clearReplayProject();
        setPrompt('');
        setTeacherChatInput('');
        reportTheatreInteraction({
          interactionId,
          phase: 'memory_restored',
          message: 'student memory restored by nickname',
          studentNickname: restoredProfile.nickname,
          userText: value,
          teacherReply: welcome,
          currentAppTitle: memory.currentApp?.title || '',
          decision: { restoredHistory: true, startedGeneration: false },
        });
        return;
      }
    }

    const studentMessage = makeStudentMessage(value);
    const baseMessages = options.baseMessages || teacherChatMessages;
    const pendingMessages = [...baseMessages, studentMessage].slice(-50);
    const withPreTeacherReply = (reply: string) => [options.preTeacherReply, reply].filter(Boolean).join('\n');
    const wantsNewApp = isExplicitNewAppRequest(value);
    const wantsRevision = isAppRevisionRequest(value);
    const shouldStartImmediately = !isActive && (wantsNewApp || (!currentApp?.html && isAppBuildRequest(value)) || (currentApp?.html && wantsRevision));
    const shouldReplaceCurrentApp = Boolean(currentApp?.html && wantsNewApp);
    const shouldGuideVoiceprint = Boolean(
      isNamingSelf
      && nextProfile.nickname
      && !nextProfile.voiceprintEnrolled
      && !voiceprintGuideNamesRef.current.has(nextProfile.nickname.toLocaleLowerCase()),
    );
    const voiceprintGuideReply = shouldGuideVoiceprint && nextProfile.nickname ? makeVoiceprintGuideReply(nextProfile.nickname) : '';
    if (shouldGuideVoiceprint && nextProfile.nickname) {
      voiceprintGuideNamesRef.current.add(nextProfile.nickname.toLocaleLowerCase());
      setVoiceprintStatus(voiceprintGuideStatus(nextProfile.nickname));
      writeStudentMemory({
        profile: nextProfile,
        chatMessages: pendingMessages,
        currentApp,
        updatedAt: new Date().toISOString(),
      });
    }
    studentProfileRef.current = nextProfile;
    setStudentProfile(nextProfile);
    setTeacherChatInput('');

    if (shouldStartImmediately) {
      const startReply = currentApp?.html
        ? (shouldReplaceCurrentApp ? '\u6536\u5230\uFF0C\u6211\u73B0\u5728\u5F00\u59CB\u5199\u4E00\u4E2A\u65B0\u7684\u5E94\u7528\u3002' : '\u6536\u5230\uFF0C\u6211\u73B0\u5728\u76F4\u63A5\u4FEE\u6539\u5F53\u524D\u4EE3\u7801\u3002')
        : nextProfile.nickname
          ? `\u6536\u5230\uFF0C${nextProfile.nickname}\uFF0C\u6211\u73B0\u5728\u5F00\u59CB\u5199\u7B2C\u4E00\u7248\u3002`
          : '\u6536\u5230\uFF0C\u6211\u73B0\u5728\u5F00\u59CB\u5199\u7B2C\u4E00\u7248\u3002';
      const startReplyForDisplay = currentApp?.html ? stripNicknameQuestions(startReply) : appendNicknameQuestion(startReply, nextProfile);
      const reply = withPreTeacherReply([startReplyForDisplay, voiceprintGuideReply].filter(Boolean).join('\n'));
      const teacherMessage = makeTeacherMessage(reply);
      if (!currentApp?.html || shouldReplaceCurrentApp) {
        beginReplayProject(interactionId, [studentMessage, teacherMessage], nextProfile);
      }
      setTeacherChatMessages([...pendingMessages, teacherMessage].slice(-50));
      reportTheatreInteraction({
        interactionId,
        phase: 'generation_decision',
        message: shouldReplaceCurrentApp ? 'new app generation started over restored current app' : 'generation started immediately',
        studentNickname: nextProfile.nickname,
        userText: value,
        teacherReply: reply,
        prompt: value,
        currentAppTitle: currentApp?.title || '',
        decision: {
          wantsNewApp,
          wantsRevision,
          shouldStartImmediately,
          shouldReplaceCurrentApp,
          hasCurrentApp: Boolean(currentApp?.html),
        },
      });
      setPrompt(value);
      autoStartMetaRef.current = { interactionId, replaceCurrentApp: shouldReplaceCurrentApp };
      setAutoStartPrompt(value);
      return;
    }

    if (voiceprintGuideReply) {
      setTeacherChatMessages([...pendingMessages, makeTeacherMessage(withPreTeacherReply(voiceprintGuideReply))].slice(-50));
      reportTheatreInteraction({
        interactionId,
        phase: 'teacher_reply_only',
        message: 'voiceprint guide reply only',
        studentNickname: nextProfile.nickname,
        userText: value,
        teacherReply: voiceprintGuideReply,
        currentAppTitle: currentApp?.title || '',
        decision: { shouldGuideVoiceprint: true, startedGeneration: false },
      });
      return;
    }

    setTeacherChatMessages(pendingMessages);
    setIsTeacherChatting(true);
    try {
      const response = await fetch('/api/teacher-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase: isActive ? 'waiting_chat' : 'chat',
          userText: value,
          currentAppTitle: currentApp?.title || '',
          jobStatus: job?.status || '',
          jobStage: job?.stage || '',
          lastEvent: events.at(-1)?.message || '',
          studentProfile: nextProfile,
          chatHistory: pendingMessages.slice(-8).map((message) => ({
            role: message.role,
            text: message.text,
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `\u8001\u5E08 Agent ${response.status}`);
      const reply = removeNicknameQuestions(String(payload.reply || '').trim() || '\u6211\u5728\u3002\u6211\u4EEC\u7EE7\u7EED\u3002', nextProfile);
      const wantsFirstBuild = payload.nextAction === 'start_generation' || isAppBuildRequest(value);
      const agentWantsRevision = payload.nextAction === 'revise' || isAppRevisionRequest(value);
      const shouldStart = !isActive && (wantsNewApp || (currentApp?.html ? agentWantsRevision : wantsFirstBuild));
      const agentShouldReplaceCurrentApp = Boolean(currentApp?.html && wantsNewApp);
      const generationPrompt = String(payload.suggestedPrompt || value).trim();
      const startAwareReply = shouldStart && !/\u5F00\u59CB|\u751F\u6210|\u5199\u4EE3\u7801|\u8001\u5E08|\u4FEE\u6539\u4EFB\u52A1/.test(reply)
        ? `${reply}\n\u6211\u73B0\u5728\u5F00\u59CB${agentShouldReplaceCurrentApp ? '\u5199\u4E00\u4E2A\u65B0\u7684\u5E94\u7528' : currentApp?.html ? '\u4FEE\u6539\u5F53\u524D\u4EE3\u7801' : '\u5199\u7B2C\u4E00\u7248\u4EE3\u7801'}\u3002`
        : reply;
      const finalReply = shouldStart
        ? (currentApp?.html ? stripNicknameQuestions(startAwareReply) : appendNicknameQuestion(startAwareReply, nextProfile))
        : removeNicknameQuestions(startAwareReply, nextProfile);
      const teacherMessage = makeTeacherMessage(withPreTeacherReply(finalReply));
      if (shouldStart && (!currentApp?.html || agentShouldReplaceCurrentApp)) {
        beginReplayProject(interactionId, [studentMessage, teacherMessage], nextProfile);
      }
      setTeacherChatMessages([...pendingMessages, teacherMessage].slice(-50));
      reportTheatreInteraction({
        interactionId,
        phase: shouldStart ? 'generation_decision' : 'teacher_reply_only',
        message: shouldStart ? 'teacher-agent reply led to generation' : 'teacher-agent replied without generation',
        studentNickname: nextProfile.nickname,
        userText: value,
        teacherReply: finalReply,
        prompt: generationPrompt,
        currentAppTitle: currentApp?.title || '',
        decision: {
          nextAction: payload.nextAction || '',
          wantsNewApp,
          wantsFirstBuild,
          wantsRevision: agentWantsRevision,
          shouldStart,
          shouldReplaceCurrentApp: agentShouldReplaceCurrentApp,
          hasCurrentApp: Boolean(currentApp?.html),
        },
      });
      if (shouldStart && generationPrompt) {
        setPrompt(generationPrompt);
        autoStartMetaRef.current = { interactionId, replaceCurrentApp: agentShouldReplaceCurrentApp };
        setAutoStartPrompt(generationPrompt);
      }
    } catch (reason) {
      const fallbackReply = '\u6211\u521A\u521A\u6CA1\u8FDE\u4E0A\uFF0C\u4F46\u6211\u8FD8\u5728\u8FD9\u91CC\u3002\u4F60\u53EF\u4EE5\u7EE7\u7EED\u8BD5\u73A9\uFF0C\u6216\u8005\u518D\u95EE\u6211\u4E00\u6B21\u3002';
      setTeacherChatMessages([
        ...pendingMessages,
        makeTeacherMessage(withPreTeacherReply(fallbackReply)),
      ].slice(-50));
      reportTheatreInteraction({
        interactionId,
        phase: 'teacher_agent_error',
        message: reason instanceof Error ? reason.message : 'teacher-agent request failed',
        studentNickname: nextProfile.nickname,
        userText: value,
        teacherReply: fallbackReply,
        currentAppTitle: currentApp?.title || '',
        decision: { startedGeneration: false },
      });
    } finally {
      setIsTeacherChatting(false);
    }
  }, [
    beginReplayProject,
    clearReplayProject,
    currentApp,
    events,
    isActive,
    isTeacherChatting,
    job?.stage,
    job?.status,
    restoreCurrentApp,
    studentProfile,
    teacherChatInput,
    teacherChatMessages,
  ]);

  useEffect(() => {
    sendTeacherChatRef.current = sendTeacherChat;
  }, [sendTeacherChat]);

  const chooseFirstAppSuggestion = useCallback((suggestion: typeof firstAppSuggestions[number]) => {
    const interactionId = createInteractionId();
    setLastInteractionId(interactionId);
    const reply = appendNicknameQuestion(`\u597D\uFF0C\u6211\u4EEC\u5148\u505A${suggestion.label}\u3002\n\u6211\u73B0\u5728\u5F00\u59CB\u4EB2\u81EA\u5199\u4EE3\u7801\u3002`, studentProfile);
    const studentMessage = makeStudentMessage(`\u6211\u60F3\u505A\uFF1A${suggestion.label}`);
    const teacherMessage = makeTeacherMessage(reply);
    beginReplayProject(interactionId, [studentMessage, teacherMessage], studentProfile);
    setTeacherChatMessages([
      ...teacherChatMessages,
      studentMessage,
      teacherMessage,
    ].slice(-50));
    reportTheatreInteraction({
      interactionId,
      phase: 'generation_decision',
      message: 'student clicked first app suggestion',
      studentNickname: studentProfile.nickname,
      userText: `\u6211\u60F3\u505A\uFF1A${suggestion.label}`,
      teacherReply: reply,
      prompt: suggestion.prompt,
      currentAppTitle: currentApp?.title || '',
      decision: { source: 'suggestion', shouldStart: true, shouldReplaceCurrentApp: false },
    });
    autoStartMetaRef.current = { interactionId, replaceCurrentApp: false };
    setAutoStartPrompt(suggestion.prompt);
    window.requestAnimationFrame(() => teacherChatInputRef.current?.focus());
  }, [beginReplayProject, currentApp?.title, studentProfile, teacherChatMessages]);

  const createJob = async (ideaOverride?: string, options: { speak?: boolean; isRetry?: boolean; interactionId?: string; replaceCurrentApp?: boolean } = {}) => {
    const idea = (ideaOverride || prompt).trim();
    const interactionId = options.interactionId || createInteractionId();
    if (!options.interactionId) setLastInteractionId(interactionId);
    if (!options.isRetry) setFailureRetryUsed(false);
    if (options.isRetry) setFailureRetryUsed(true);
    if (
      !options.isRetry
      && (!currentApp?.html || options.replaceCurrentApp)
      && replayProjectIdRef.current !== interactionId
    ) {
      beginReplayProject(interactionId, teacherChatMessages.slice(-2), studentProfile);
    }
    reportTheatreInteraction({
      interactionId,
      phase: 'generation_start_requested',
      message: options.replaceCurrentApp ? 'start new app generation with current app ignored' : 'start create-theatre generation',
      studentNickname: studentProfile.nickname,
      prompt: idea,
      currentAppTitle: currentApp?.title || '',
      decision: { replaceCurrentApp: Boolean(options.replaceCurrentApp), isRetry: Boolean(options.isRetry) },
    });
    const started = await startCreateJob(idea, {
      interactionId,
      replaceCurrentApp: options.replaceCurrentApp,
      userName: studentProfile.nickname,
      deviceId: getTheatreDeviceId(),
    });
    if (!started) {
      reportTheatreInteraction({
        interactionId,
        phase: 'generation_not_started',
        message: 'startCreateJob returned false',
        studentNickname: studentProfile.nickname,
        prompt: idea,
        currentAppTitle: currentApp?.title || '',
        decision: { replaceCurrentApp: Boolean(options.replaceCurrentApp), isRetry: Boolean(options.isRetry) },
      });
      return;
    }
    setPrompt('');
    if (options.speak ?? true) {
      const reply = appendNicknameQuestion(`\u597D\u7684\uFF0C\u6211\u73B0\u5728\u5F00\u59CB\u5199\uFF1A${idea}`, studentProfile);
      setTeacherChatMessages((messages) => [...messages, makeTeacherMessage(reply)].slice(-50));
    }
  };

  const retryFailedJob = () => {
    if (!job?.prompt || job.status !== 'failed' || failureRetryUsed || isActive) return;
    const interactionId = job.interactionId || createInteractionId();
    setLastInteractionId(interactionId);
    setTeacherChatMessages((messages) => [
      ...messages,
      makeTeacherMessage('\u521A\u624D\u8FD9\u6B21\u751F\u6210\u5931\u8D25\u4E86\u3002\u6211\u4F1A\u6309\u540C\u4E00\u4E2A\u9700\u6C42\u518D\u8BD5\u4E00\u6B21\uFF1B\u5982\u679C\u8FD8\u5931\u8D25\uFF0C\u5C31\u628A\u9519\u8BEF\u539F\u56E0\u4FDD\u7559\u4E0B\u6765\u65B9\u4FBF\u6392\u67E5\u3002'),
    ].slice(-50));
    void createJob(job.prompt, { speak: false, isRetry: true, interactionId });
  };

  useEffect(() => {
    if (!autoStartPrompt || isActive) return;
    const idea = autoStartPrompt;
    const meta = autoStartMetaRef.current;
    autoStartMetaRef.current = {};
    setAutoStartPrompt('');
    void createJob(idea, { speak: false, interactionId: meta.interactionId, replaceCurrentApp: meta.replaceCurrentApp });
  }, [autoStartPrompt, isActive]);

  useEffect(() => {
    const controller = new AbortController();
    const phase = job?.status === 'succeeded' ? 'celebrate' : isActive ? 'waiting' : currentApp ? 'revise' : 'warmup';
    const lastEvent = events.at(-1)?.message || '';
    setTeacherAgentStatus('loading');
    fetch('/api/teacher-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase,
        userText: prompt,
        currentAppTitle: currentApp?.title || '',
        jobStatus: job?.status || '',
        jobStage: job?.stage || '',
        lastEvent,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || `老师 Agent ${response.status}`);
        setTeacherAgentReply(payload.reply || '');
        setTeacherAgentStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setTeacherAgentReply('');
        setTeacherAgentStatus('error');
      });
    return () => controller.abort();
  }, [job?.status, job?.stage, currentApp?.title]);

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <a className={styles.brand} href="/create">
          <span className={styles.brandMark}>A</span>
          <span><strong>AIYA 创作课堂</strong><small>老师 Coding Agent</small></span>
        </a>
        <nav className={styles.nav}>
          <div
            className={`${styles.loginStatus} ${studentProfile.nickname ? styles.loginStatusKnown : ''}`}
            aria-label={`\u767b\u5f55\u72b6\u6001\uff1a${loginStatusName}\uff0c${profileStatusText}\uff0c${voiceprintStatusText}`}
            title={`\u767b\u5f55\u72b6\u6001\uff1a${loginStatusName}\uff0c${profileStatusText}\uff0c${voiceprintStatusText}`}
          >
            <span className={styles.loginStatusDot} aria-hidden="true" />
            <span><strong>{loginStatusName}</strong><small>{profileStatusText}</small></span>
            <span className={`${styles.loginStatusBadge} ${studentProfile.voiceprintEnrolled ? styles.loginStatusBadgeDone : ''}`}>{voiceprintStatusText}</span>
          </div>
          <button className={styles.guideEntryButton} type="button" onClick={guide.startGuide}>新手引导</button>
          <a
            className={styles.headerV3Download}
            href="/downloads/aiya-v3-debug.apk"
            download="AIYA-V3-latest.apk"
            title="下载最新版 AIYA V3 APK"
            aria-label="下载最新版 AIYA V3 APK"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17.5v1.2A2.3 2.3 0 0 0 7.3 21h9.4a2.3 2.3 0 0 0 2.3-2.3v-1.2" />
            </svg>
            <span>下载最新版 V3 APK</span>
          </a>
        </nav>
      </header>

      <section className={styles.stage}>
        <div className={styles.creatorCredit} aria-label="作者君维，联系微信16675143990">
          <span>作者：君维</span>
          <span aria-hidden="true">·</span>
          <span>联系微信：16675143990</span>
        </div>
        {error ? (
          <div className={styles.error}>
            <p>{error}</p>
            {job?.status === 'failed' && job.prompt ? (
              <button type="button" onClick={retryFailedJob} disabled={failureRetryUsed || isActive}>
                {failureRetryUsed ? '已重试一次' : '按原需求再试一次'}
              </button>
            ) : null}
          </div>
        ) : null}

        <section className={styles.teacherPanel} data-guide-id="teacher-panel">
          <div className={styles.teacherAvatar}>{classroomSettings.teacher.avatar}</div>
          <div className={styles.teacherCopy}>
            <p className={styles.eyebrow}>{classroomSettings.teacher.name}</p>
            <h2>{teacherTitle}</h2>
            <p>{teacherSupportText}</p>
            <div className={styles.settingsSummary}>
              <button
                type="button"
                className={styles.moreSettingsButton}
                onClick={() => setSettingsOpen((open) => !open)}
                aria-expanded={settingsOpen}
                aria-controls="create-theatre-settings"
              >
                {settingsOpen ? '收起设置' : '更多设置'}
              </button>
              <span
                className={`${styles.teacherVoiceStatus} ${teacherVoiceIsActive ? styles.teacherVoiceStatusActive : ''}`}
                aria-live="polite"
              >
                {teacherVoiceStatus === 'loading' ? '生成语音中' : teacherVoiceStatus === 'speaking' ? '正在播放' : teacherVoiceStatus === 'fallback' ? '浏览器朗读' : teacherVoiceEnabled ? '语音已开' : '语音关闭'}{teacherVoiceMessage ? ` · ${teacherVoiceMessage}` : ''}
              </span>
            </div>
            {settingsOpen ? (
              <div className={styles.teacherVoiceControls} id="create-theatre-settings" data-guide-id="teacher-voice-controls">
                <button type="button" onClick={() => { if (teacherVoiceEnabled) stopTeacherVoice(); setTeacherVoiceEnabled((value) => !value); }}>{teacherVoiceEnabled ? '关闭老师语音' : '开启老师语音'}</button>
                <button type="button" onClick={() => void speakTeacher(latestTeacherMessage?.text || teacherVoiceText)} disabled={teacherVoiceStatus === 'loading'}>重播讲解</button>
                <label className={styles.teacherVoiceSelect}>
                  <span>老师音色</span>
                  <select
                    value={selectedTeacherVoice}
                    onChange={(event) => changeTeacherVoice(event.target.value)}
                    aria-label="选择老师音色"
                    data-testid="teacher-voice-select"
                  >
                    {teacherVoiceOptions.map((voiceOption) => (
                      <option key={voiceOption.value} value={voiceOption.value}>
                        {voiceOption.label} · {voiceOption.note}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  data-testid="teacher-voice-preview-button"
                  onClick={() => void speakTeacher(`你好，我是${selectedTeacherVoiceOption.label}。我们从一个小应用开始学习 AI 编程吧。`)}
                  disabled={teacherVoiceStatus === 'loading'}
                >
                  试听音色
                </button>
                <button type="button" onClick={stopTeacherVoice} disabled={teacherVoiceStatus === 'idle'}>停止</button>
              </div>
            ) : null}
            {hasPendingTeacherSpeech ? (
              <button
                type="button"
                className={styles.tapToStartVoice}
                onClick={resumePendingTeacherSpeech}
                aria-label="点击任意位置开始听老师讲解"
              >
                <span>浏览器需要你先互动一下</span>
                <strong>点击任意位置开始听老师讲解</strong>
              </button>
            ) : null}
            <div
              className={`${styles.voiceVisualizer} ${teacherVoiceStatus === 'speaking' || teacherVoiceStatus === 'fallback' ? styles.voiceVisualizerActive : ''}`}
              data-testid="teacher-voice-visualizer"
              aria-label={teacherVoiceStatus === 'speaking' || teacherVoiceStatus === 'fallback' ? '老师正在说话' : '老师语音未播放'}
            >
              {Array.from({ length: 18 }).map((_, index) => <span key={index} />)}
            </div>
          </div>
        </section>

        <section className={styles.teacherDialogWindow} data-testid="teacher-dialog-window" aria-label="学生和老师的对话窗口">
          <div className={styles.dialogTitleBar}>
            <div>
              <span className={styles.dialogDot} />
              <strong>老师对话窗口</strong>
              <small>{isActive ? '老师正在生成当前版本' : '可以先和老师互相认识'}</small>
            </div>
            <div className={styles.dialogMeta}>
              {lastInteractionId ? (
                <button
                  type="button"
                  className={styles.interactionIdBadge}
                  onClick={() => navigator.clipboard?.writeText(lastInteractionId)}
                  title="点击复制交互编号；把这个编号发给开发者可以定位完整问题记录。"
                >
                  交互编号：{lastInteractionId}
                </button>
              ) : null}
              <span>{profileSummary(studentProfile)}</span>
            </div>
          </div>
          <div className={`${styles.microphonePanel} ${microphoneReady ? styles.microphonePanelReady : ''}`} data-testid="microphone-permission-panel">
            <div>
              <strong>麦克风权限</strong>
              <small>{microphoneMessage}</small>
            </div>
            <button
              type="button"
              onClick={requestMicrophonePermission}
              disabled={microphonePermission === 'checking' || microphonePermission === 'unsupported' || microphoneReady}
              aria-pressed={microphoneReady}
            >
              {microphoneReady ? '麦克风已开启' : microphonePermission === 'checking' ? '检测中' : '开启麦克风'}
            </button>
          </div>
          {settingsOpen ? (
            <div className={styles.dialogSettings} aria-label="课堂更多设置">
              <div className={styles.profileHints} aria-label="学生档案快捷输入">
                {!studentProfile.nickname ? <button type="button" onClick={() => setTeacherChatInput('叫我 ')}>告诉昵称</button> : null}
                {!studentProfile.ageGroup ? (
                  <>
                    <button type="button" onClick={() => void sendTeacherChat('我是小朋友')}>我是小朋友</button>
                    <button type="button" onClick={() => void sendTeacherChat('我是大人')}>我是大人</button>
                  </>
                ) : null}
                {!studentProfile.pronoun ? (
                  <>
                    <button type="button" onClick={() => void sendTeacherChat('我是男生')}>男生</button>
                    <button type="button" onClick={() => void sendTeacherChat('我是女生')}>女生</button>
                  </>
                ) : null}
              </div>
              <div className={styles.voiceprintPanel} data-testid="voiceprint-panel">
                <div>
                  <strong>{'\u58f0\u7eb9\u767b\u5f55\u539f\u578b'}</strong>
                  <small>{studentProfile.nickname && !studentProfile.voiceprintEnrolled ? '已建档。之后使用语音输入时会自动完成声纹记录；也可以在这里手动补录。' : '\u5148\u5EFA\u6863\uFF0C\u518D\u6309\u4F4F\u767B\u5F55\u8BF4\u51FA\u540D\u5B57\u3002\u539F\u59CB\u97F3\u9891\u4E0D\u4FDD\u5B58\uFF0C\u4EC5\u4FDD\u7559\u670D\u52A1\u5668\u58F0\u7EB9\u7279\u5F81\u3002'}</small>
                </div>
                <div className={styles.voiceprintActions}>
                  <VoiceInputButton
                    voice={voiceprintEnrollVoice}
                    className={`${styles.voiceButton} ${styles.voiceprintButton}`}
                    activeClassName={styles.listening}
                    cancelReadyClassName={styles.cancelReady}
                    dotClassName={styles.voiceDot}
                    labelIdle={'\u6309\u4f4f\u5efa\u6863'}
                    labelArming={'\u7ee7\u7eed\u6309\u4f4f\uff0c\u53d8\u7eff\u540e\u518d\u5ff5'}
                    labelActive={'\u677e\u624b\u5efa\u6863'}
                    labelCancel={'\u677e\u624b\u53d6\u6d88'}
                    disabled={!microphoneReady || (voiceprintVoice.isActive && voiceprintModeRef.current !== 'enroll')}
                  />
                  <VoiceInputButton
                    voice={voiceprintLoginVoice}
                    className={`${styles.voiceButton} ${styles.voiceprintButton}`}
                    activeClassName={styles.listening}
                    cancelReadyClassName={styles.cancelReady}
                    dotClassName={styles.voiceDot}
                    labelIdle={'\u6309\u4f4f\u767b\u5f55'}
                    labelArming={'\u7ee7\u7eed\u6309\u4f4f\uff0c\u53d8\u7eff\u540e\u518d\u8bf4'}
                    labelActive={'\u677e\u624b\u767b\u5f55'}
                    labelCancel={'\u677e\u624b\u53d6\u6d88'}
                    disabled={!microphoneReady || (voiceprintVoice.isActive && voiceprintModeRef.current !== 'login')}
                  />
                </div>
                <span>{voiceprintHelpText}</span>
              </div>
            </div>
          ) : null}
          {!currentApp && !isActive ? (
            <div className={styles.appSuggestions} data-testid="first-app-suggestions" data-guide-id="first-app-suggestions" aria-label="老师推荐的第一个应用">
              <span>老师推荐的第一个应用</span>
              {firstAppSuggestions.map((suggestion) => (
                <button key={suggestion.label} type="button" onClick={() => chooseFirstAppSuggestion(suggestion)}>
                  <strong>{suggestion.label}</strong>
                  <small>{suggestion.prompt}</small>
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.teacherChatMessages}>
            {teacherChatMessages.map((message) => (
              <div key={message.id} className={`${styles.chatBubble} ${message.role === 'student' ? styles.chatStudent : styles.chatTeacher}`}>
                <span>{message.role === 'student' ? '我' : '老师'}</span>
                <p>{message.text}</p>
              </div>
            ))}
            {isTeacherChatting ? (
              <div className={`${styles.chatBubble} ${styles.chatTeacher}`}>
                <span>老师</span>
                <p>思考中</p>
              </div>
            ) : null}
            <div ref={teacherChatEndRef} />
          </div>
          <form
            className={styles.teacherChatForm}
            onSubmit={(event) => {
              event.preventDefault();
              void sendTeacherChat();
            }}
          >
            <input
              ref={teacherChatInputRef}
              data-guide-id="teacher-chat-input"
              value={teacherChatInput}
              onChange={(event) => setTeacherChatInput(event.target.value)}
              onClick={rememberCursor}
              onKeyUp={rememberCursor}
              onSelect={rememberCursor}
              onFocus={rememberCursor}
              placeholder={isActive ? '等待时可以问：老师，它现在做到哪一步了？' : currentApp ? '例如：给计算器加上发声功能' : '例如：做一个计算器，或者叫我小宇'}
            />
            <VoiceInputButton
              voice={chatVoice}
              className={`${styles.voiceButton} ${styles.chatVoiceButton}`}
              activeClassName={styles.listening}
              cancelReadyClassName={styles.cancelReady}
              dotClassName={styles.voiceDot}
              labelIdle="按住 1 秒，变绿后说话"
              labelArming="继续按住，变绿后再说"
              labelActive="正在收音，松开发送"
              disabled={isTeacherChatting || !microphoneReady}
            />
            <button type="submit" data-guide-id="teacher-send-button" disabled={!teacherChatInput.trim() || isTeacherChatting}>{isTeacherChatting ? '回复中' : '发送'}</button>
            <p className={`${styles.voiceStatus} ${voice.isActive ? styles.voiceStatusLive : ''}`}>{voiceHelpText}</p>
          </form>
        </section>

        <section className={styles.workspace}>
          <aside className={styles.leftRail} data-guide-id="lesson-progress">
            <div className={styles.statusLine}><span className={isActive ? styles.liveDot : styles.doneDot} /><strong>{isActive ? '正在生成' : '课堂就绪'}</strong><small>{formatDuration(elapsed)}</small></div>
            <ol className={styles.timeline}>
              {stages.map((stage, index) => (
                <li key={stage.key} className={index === activeStageIndex ? styles.stepActive : index < activeStageIndex ? styles.stepDone : ''}>
                  <span>{index + 1}</span><div><strong>{stage.label}</strong><small>{stage.note}</small></div>
                </li>
              ))}
            </ol>
          </aside>

          <aside className={styles.previewPane}>
            <div className={styles.tabs} data-guide-id="demo-preview-tabs">
              <button className={view === 'preview' ? styles.tabActive : ''} onClick={() => setView('preview')} type="button">试玩</button>
              <button className={view === 'source' ? styles.tabActive : ''} onClick={() => setView('source')} type="button">源码</button>
              <button className={view === 'evidence' ? styles.tabActive : ''} onClick={() => setView('evidence')} type="button">验证</button>
              <button className={view === 'replay' ? styles.tabActive : ''} onClick={() => setView('replay')} type="button">回放</button>
              <button disabled={!result?.html} onClick={handleDownloadHtml} type="button">下载 HTML</button>
            </div>
            {isActive ? (
              <section className={styles.quizPanel} aria-label="等待时 AI 基础问答">
                <div className={styles.quizHeader}>
                  <div>
                    <span>等待小游戏</span>
                    <h3>AI 编程小问答</h3>
                  </div>
                  <small>第 {(quizIndex % aiBasicsQuizQuestions.length) + 1}/{aiBasicsQuizQuestions.length} 题 · 答对 {quizCorrectCount} 题</small>
                </div>
                <p className={styles.quizQuestion}>{quizQuestion.question}</p>
                <div className={styles.quizOptions}>
                  {quizQuestion.options.map((option, index) => {
                    const isSelected = quizAnswerIndex === index;
                    const isCorrectAnswer = quizAnswered && index === quizQuestion.answerIndex;
                    return (
                      <button
                        key={option}
                        type="button"
                        className={[
                          styles.quizOption,
                          isSelected ? styles.quizOptionSelected : '',
                          isCorrectAnswer ? styles.quizOptionCorrect : '',
                          quizAnswered && isSelected && !isCorrectAnswer ? styles.quizOptionWrong : '',
                        ].filter(Boolean).join(' ')}
                        disabled={quizAnswered}
                        onClick={() => handleQuizAnswer(index)}
                      >
                        <span>{String.fromCharCode(65 + index)}</span>
                        {option}
                      </button>
                    );
                  })}
                </div>
                {quizAnswered ? (
                  <div className={quizIsCorrect ? styles.quizFeedbackGood : styles.quizFeedback}>
                    <strong>{quizIsCorrect ? '答对了，继续保持。' : `答案是 ${String.fromCharCode(65 + quizQuestion.answerIndex)}。`}</strong>
                    <p>{quizQuestion.explanation}</p>
                    <button type="button" onClick={nextQuizQuestion}>下一题</button>
                  </div>
                ) : (
                  <p className={styles.quizHint}>Demo 生成时可以顺手学一点 AI 编程常识。</p>
                )}
              </section>
            ) : null}
            {view === 'replay' ? (
              <section className={styles.replayPanel} aria-label="交互过程回放">
                <div className={styles.replayHero}>
                  <div>
                    <span>学习样本回放</span>
                    <h3>把一次真实创作变成课堂录像</h3>
                    <p>记录学生提问、老师讲解、每一版代码变化，并用语音按步骤播讲。</p>
                  </div>
                  <div className={styles.replayActions}>
                    <button type="button" onClick={handleToggleReplay} disabled={!replayScenes.length}>{isReplayPlaying ? '暂停回放' : '语音播放'}</button>
                    <button type="button" onClick={() => handleSelectReplayStep(Math.max(0, replayStep - 1))} disabled={replayStep <= 0}>上一段</button>
                    <button type="button" onClick={() => handleSelectReplayStep(Math.min(replayScenes.length - 1, replayStep + 1))} disabled={replayStep >= replayScenes.length - 1}>下一段</button>
                    <button type="button" onClick={handleSaveReplaySample} disabled={!replaySample.versions.length}>保存为样本</button>
                    <a className={styles.replayLink} href="/create-theatre/replay">完整回放页</a>
                  </div>
                </div>
                {replayNotice ? <p className={styles.replayNotice}>{replayNotice}</p> : null}
                <div className={styles.replayBody}>
                  <div className={styles.replayTimeline}>
                    {!replayScenes.length ? (
                      <p className={styles.replayNotice}>当前回放为空。完成一个项目后，这里只记录该项目从需求到成品的完整过程。</p>
                    ) : null}
                    {replayScenes.map((scene, index) => (
                      <button
                        key={scene.id}
                        type="button"
                        className={[styles.replayStep, index === replayStep ? styles.replayStepActive : ''].filter(Boolean).join(' ')}
                        onClick={() => handleSelectReplayStep(index)}
                      >
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <strong>{scene.title}</strong>
                        <small>{scene.type === 'version' ? '代码版本' : scene.type === 'message' ? '对话片段' : '开场'}</small>
                      </button>
                    ))}
                  </div>
                  <div className={styles.replayScreen}>
                    <div className={styles.replayNarration}>
                      <span>{replayScenes.length ? `老师语音播讲 · ${replayStep + 1}/${replayScenes.length}` : '老师语音播讲 · 暂无片段'}</span>
                      <h4>{activeReplayScene?.title || '暂无回放'}</h4>
                      <p>{activeReplayScene?.narration || '生成一个作品后，这里会出现可回放的学习过程。'}</p>
                    </div>
                    {activeReplayScene?.html ? (
                      <iframe className={styles.replayPreview} sandbox="allow-scripts" srcDoc={safeHtml(activeReplayScene.html)} title="AIYA replay preview" />
                    ) : (
                      <pre className={styles.replayDetail}>{activeReplayScene?.detail || '暂无片段。'}</pre>
                    )}
                  </div>
                </div>
              </section>
            ) : null}
            {view === 'preview' ? <iframe className={styles.preview} sandbox="allow-scripts" srcDoc={safeHtml(result?.html)} title="AIYA demo preview" /> : null}
            {view === 'source' ? (
              <section className={styles.sourcePanel} aria-label="源码彩色讲解">
                <div className={styles.sourceLegend}>
                  <span><i className={styles.legendComment} />注释</span>
                  <span><i className={styles.legendTag} />HTML 结构</span>
                  <span><i className={styles.legendKeyword} />JS 关键字</span>
                  <span><i className={styles.legendString} />文字内容</span>
                </div>
                <pre className={styles.sourceCode}>{highlightedSource}</pre>
              </section>
            ) : null}
            {view === 'evidence' ? (
              <div className={styles.evidence}>
                <h3>验证依据</h3>
                <p>状态：{job?.status || '未开始'}</p>
                <p>阶段：{stageLabel(job?.stage)}</p>
                <p>验证：{job?.validationReport ? (job.validationReport.ok === false ? '有诊断提示' : '已完成') : '等待中'}</p>
                <h4>提示与问题</h4>
                <ul>
                  {[...(job?.validationReport?.failures || []), ...(job?.validationReport?.warnings || []), ...(job?.validationReport?.quality?.gateFailures || []), ...(job?.validationReport?.quality?.warnings || [])].map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                  {!job?.validationReport ? <li>等待生成后显示验证信息。</li> : null}
                </ul>
              </div>
            ) : null}
          </aside>
        </section>
      </section>
      {guide.isGuideOpen ? (
        <GameGuideOverlay
          step={guide.guideStep}
          index={guide.guideIndex}
          total={guide.guideTotal}
          rect={guide.guideRect}
          onNext={guide.nextGuideStep}
          onPrevious={guide.previousGuideStep}
          onClose={guide.closeGuide}
        />
      ) : null}
    </main>
  );
}
