'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TeacherCoderError, buildValidationSummary } from '../../_shared/task-trace';
import { completedGoldenKeyLineage, type GoldenKeyContext } from '../../_shared/golden-key-flow';
import { runTeacherCoder } from '../_core/teacher-coder-client';
import type { CreateJob, DeviceContext, GeneratedResult } from '../_core/types';

type UseCreateTheatreJobOptions = {
  onCompleted?: (version: number, job: CreateJob) => void;
  modelMode?: string;
  teacherProfile?: { name?: string; avatar?: string } | null;
};

const getCreateErrorMessage = (reason: unknown) => {
  const raw = reason instanceof Error ? reason.message.trim() : '';
  if (!raw) return '创建生成任务失败。';
  if (/^not found$/i.test(raw)) {
    return '生成接口返回 Not Found。请刷新页面后重试；如果仍然出现，说明本地服务或模型网关路径需要检查。';
  }
  return raw;
};


const collectDeviceContext = (): DeviceContext | null => {
  if (typeof window === 'undefined') return null;
  const width = Math.max(0, Math.round(window.innerWidth || document.documentElement.clientWidth || 0));
  const height = Math.max(0, Math.round(window.innerHeight || document.documentElement.clientHeight || 0));
  const coarse = window.matchMedia?.('(pointer: coarse)').matches || false;
  const fine = window.matchMedia?.('(pointer: fine)').matches || false;
  const touch = Boolean(navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || 'ontouchstart' in window;
  const surface: DeviceContext['surface'] = width && width <= 760
    ? 'mobile'
    : touch && width && width <= 1100
      ? 'tablet'
      : 'desktop';
  return {
    surface,
    pointer: coarse ? 'coarse' : fine ? 'fine' : 'unknown',
    touch,
    width: width || undefined,
    height: height || undefined,
    isApk: Boolean((window as Window & { AiyaApk?: unknown }).AiyaApk),
  };
};

const reportClientFailure = (payload: {
  message: string;
  jobId?: string;
  interactionId?: string;
  prompt?: string;
  stage?: string;
}) => {
  void fetch('/api/diagnostics/client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      route: '/create-theatre',
      ...payload,
    }),
  }).catch(() => undefined);
};

export function useCreateTheatreJob({
  onCompleted,
  modelMode,
  teacherProfile,
}: UseCreateTheatreJobOptions = {}) {
  const [job, setJob] = useState<CreateJob | null>(null);
  const [currentApp, setCurrentApp] = useState<GeneratedResult | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [appVersion, setAppVersion] = useState(0);

  const startedAtRef = useRef<number | null>(null);
  const completedJobIdRef = useRef<string | null>(null);
  const pendingJobWasRevisionRef = useRef(false);
  const pendingJobReplacesCurrentRef = useRef(false);
  const onCompletedRef = useRef(onCompleted);
  const modelModeRef = useRef(modelMode);
  const teacherProfileRef = useRef(teacherProfile);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  useEffect(() => {
    modelModeRef.current = modelMode;
    teacherProfileRef.current = teacherProfile;
  }, [modelMode, teacherProfile]);

  const isActive = job?.status === 'queued' || job?.status === 'running' || isSubmitting;
  const result = job?.result || currentApp;
  const events = job?.events || [];
  const elapsed = startedAtRef.current ? now - startedAtRef.current : 0;
  const visibleAppVersion = appVersion || (currentApp?.html ? 1 : 0);

  const startCreateJob = useCallback(async (idea: string, options: {
    interactionId?: string;
    replaceCurrentApp?: boolean;
    goldenKeyContext?: GoldenKeyContext;
    userName?: string;
    deviceId?: string;
  } = {}) => {
    const trimmedIdea = idea.trim();
    if (!trimmedIdea) {
      setError('请先输入你想做的小应用。');
      return false;
    }
    setError('');
    const effectiveCurrentApp = options.replaceCurrentApp ? null : currentApp;
    pendingJobWasRevisionRef.current = Boolean(effectiveCurrentApp?.html);
    pendingJobReplacesCurrentRef.current = Boolean(options.replaceCurrentApp);
    setIsSubmitting(true);
    startedAtRef.current = Date.now();
    let submittedJobId = '';
    try {
      const jobId = `teacher-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
      submittedJobId = jobId;
      const nowIso = new Date().toISOString();
      const baseEvents = [
        { at: nowIso, stage: 'preparing', message: effectiveCurrentApp?.html ? '老师正在读取当前作品代码。' : '老师正在理解你的应用想法。' },
        { at: nowIso, stage: 'fast_generating', message: effectiveCurrentApp?.html ? '老师正在直接修改这一版代码。' : '老师正在直接写第一版代码。' },
      ];
      setJob({
        id: jobId,
        goldenKeyContext: options.goldenKeyContext,
        interactionId: options.interactionId,
        status: 'running',
        stage: 'fast_generating',
        prompt: trimmedIdea,
        revision: effectiveCurrentApp?.html ? trimmedIdea : '',
        attempts: 1,
        events: baseEvents,
        result: effectiveCurrentApp || null,
        validationReport: null,
      });
      const coded = await runTeacherCoder({
        onProgress: progress => setJob(previous => previous?.id === jobId ? { ...previous, stage: progress.stage || previous.stage, build: progress.build || previous.build } : previous),
        idea: trimmedIdea,
        modelMode: modelModeRef.current,
        teacherProfile: teacherProfileRef.current,
        currentApp: effectiveCurrentApp,
        deviceContext: collectDeviceContext(),
        taskContext: {
          clientTaskId: jobId,
          interactionId: options.interactionId,
          userName: options.userName,
          deviceId: options.deviceId,
          source: 'web-v2',
          appId: 'aiya-create-theatre-v2',
        },
      });
      const finishedAt = new Date().toISOString();
      const coderEvents = (coded.events || []).map((event) => ({
        at: finishedAt,
        stage: event.stage || 'fast_generating',
        message: event.message || '老师正在写代码。',
      }));
      setJob({
        id: jobId,
        goldenKeyContext: options.goldenKeyContext,
        interactionId: options.interactionId,
        status: 'succeeded',
        stage: 'succeeded',
        prompt: trimmedIdea,
        revision: effectiveCurrentApp?.html ? trimmedIdea : '',
        attempts: 1,
        events: [
          ...baseEvents,
          ...coderEvents,
          { at: finishedAt, stage: 'succeeded', message: coded.reply || '老师已经完成这一版。' },
        ],
        result: { ...coded.result, goldenKey: completedGoldenKeyLineage(effectiveCurrentApp, options.goldenKeyContext) },
        build: coded.build,
        validationReport: buildValidationSummary(coded.build),

      });
      return true;
    } catch (reason) {
      const message = getCreateErrorMessage(reason);
      const failedAt = new Date().toISOString();
      reportClientFailure({
        message,
        jobId: submittedJobId,
        prompt: trimmedIdea,
        stage: 'failed',
        interactionId: options.interactionId,
      });
      setError(message);
      setJob((previous) => previous
        ? {
            ...previous,
            status: 'failed',
            stage: 'failed',
            build: reason instanceof TeacherCoderError ? reason.build : undefined,
            error: message,
            events: [
              ...(previous.events || []),
              { at: failedAt, stage: 'failed', message },
            ],
            validationReport: {
              ok: false,
              failures: [message],
            },
          }
        : null);
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }, [currentApp]);

  const restoreCurrentApp = useCallback((app: GeneratedResult | null) => {
    setCurrentApp(app);
    setAppVersion(app?.html ? 1 : 0);
    setJob(null);
    completedJobIdRef.current = null;
    pendingJobWasRevisionRef.current = false;
    pendingJobReplacesCurrentRef.current = false;
    startedAtRef.current = null;
  }, []);

  useEffect(() => {
    if (!isActive) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActive]);

  useEffect(() => {
    if (job?.status !== 'succeeded' || !job.result?.html || completedJobIdRef.current === job.id) return;
    completedJobIdRef.current = job.id;
    const nextVersion = pendingJobReplacesCurrentRef.current
      ? 1
      : appVersion > 0
        ? appVersion + 1
        : (pendingJobWasRevisionRef.current || currentApp?.html ? 2 : 1);
    setAppVersion(nextVersion);
    setCurrentApp(job.result);
    onCompletedRef.current?.(nextVersion, job);
  }, [appVersion, currentApp?.html, job]);

  return {
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
  };
}
