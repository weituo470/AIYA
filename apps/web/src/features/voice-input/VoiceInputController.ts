import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AsrWebSocketClient } from './AsrWebSocketClient';
import type { AsrServerMessage, VoiceInputError, VoiceInputMetrics, VoiceInputState, VoicePointerBounds, VoicePointerPoint } from './types';
import { WebAudioPcmRecorder } from './WebAudioPcmRecorder';

const MIN_HOLD_MS = 250;
const SLIDE_CANCEL_PX = 90;
const COMMIT_STABLE_MS = 1200;
const FALLBACK_COMMIT_MS = 2500;

export type UseVoiceInputOptions = {
  wsUrl?: string;
  token?: string;
  hotwords?: string[];
  releaseTailMs?: number;
  onCommit: (text: string, metrics: VoiceInputMetrics) => void;
  onError?: (error: VoiceInputError) => void;
  onMetrics?: (metrics: VoiceInputMetrics) => void;
  onAudioChunk?: (chunk: ArrayBuffer) => void;
};

export type UseVoiceInputReturn = {
  state: VoiceInputState;
  partialText: string;
  finalText: string;
  errorMessage: string;
  statusText: string;
  isSupported: boolean;
  isActive: boolean;
  isCancelReady: boolean;
  firstTokenLatencyMs?: number;
  start: (point: VoicePointerPoint) => Promise<void>;
  move: (point: VoicePointerPoint, bounds?: VoicePointerBounds) => void;
  finish: () => Promise<void>;
  cancel: () => Promise<void>;
  dismissError: () => void;
};

type SessionRef = {
  runId: number;
  pointerActive: boolean;
  pressStartedAt: number;
  pressStartX: number;
  pressStartY: number;
  commitDone: boolean;
  finishRequested: boolean;
  startedAt: number;
  requestId: string;
  audioMs: number;
  tailBufferDone: boolean;
};

const initialSession = (): SessionRef => ({
  runId: 0,
  pointerActive: false,
  pressStartedAt: 0,
  pressStartX: 0,
  pressStartY: 0,
  commitDone: false,
  finishRequested: false,
  startedAt: 0,
  requestId: '',
  audioMs: 0,
  tailBufferDone: false,
});

export const getDefaultAsrWsUrl = () => {
  if (typeof window === 'undefined') return '';
  const envUrl = process.env.NEXT_PUBLIC_AIYA_ASR_WS_URL;
  if (envUrl) return envUrl;
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  if (isLocal) return 'ws://127.0.0.1:8787/ws/asr';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/asr`;
};

export const useVoiceInput = (options: UseVoiceInputOptions): UseVoiceInputReturn => {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [partialText, setPartialText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isCancelReady, setIsCancelReady] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [firstTokenLatencyMs, setFirstTokenLatencyMs] = useState<number | undefined>();

  const clientRef = useRef<AsrWebSocketClient | null>(null);
  const recorderRef = useRef<WebAudioPcmRecorder | null>(null);
  const sessionRef = useRef<SessionRef>(initialSession());
  const finalTextRef = useRef('');
  const partialTextRef = useRef('');
  const pendingChunksRef = useRef<ArrayBuffer[]>([]);
  const commitTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const hasAudioContext = Boolean(window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    setIsSupported(Boolean(navigator.mediaDevices?.getUserMedia && hasAudioContext && window.WebSocket));
    return () => {
      if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
      clientRef.current?.cancel();
      recorderRef.current?.stop().catch(() => {});
    };
  }, []);

  const statusText = useMemo(() => {
    if (!isSupported) return '当前浏览器不支持高质量语音输入，请使用 Chrome / Edge 并允许麦克风。';
    if (errorMessage) return errorMessage;
    if (isCancelReady) return '已滑出，松手取消。';
    if (state === 'connecting') return '正在预热麦克风与识别服务，按钮变绿后再开始说话。';
    if (state === 'listening') return '按钮已变绿，现在说话，松开后写入输入框。';
    if (state === 'tail-buffering') return '正在补录最后 2 秒尾音…';
    if (state === 'transcribing') return partialText || finalText || '正在识别…';
    if (state === 'done') return '已写入输入框，等待你确认或继续编辑。';
    return '按住麦克风 1 秒，按钮变绿后开始说话，松开后写入输入框。';
  }, [errorMessage, finalText, isCancelReady, isSupported, partialText, state]);

  const reportError = useCallback((error: VoiceInputError) => {
    setErrorMessage(error.message || '识别失败，请重试');
    setState('error');
    reportVoiceInputDiagnostic(error);
    options.onError?.(error);
  }, [options]);

  const buildMetrics = useCallback((cancelled: boolean, errorCode?: string): VoiceInputMetrics => {
    const session = sessionRef.current;
    const text = `${finalTextRef.current}${partialTextRef.current}`.trim();
    return {
      requestId: session.requestId,
      provider: 'doubao',
      startedAt: session.startedAt,
      firstPartialAt: firstTokenLatencyMs ? session.startedAt + firstTokenLatencyMs : undefined,
      firstFinalAt: undefined,
      stoppedAt: performance.now(),
      cancelled,
      errorCode,
      audioMs: session.audioMs,
      finalTextLength: text.length,
    };
  }, [firstTokenLatencyMs]);

  const markFirstToken = useCallback(() => {
    if (firstTokenLatencyMs != null) return;
    const startedAt = sessionRef.current.startedAt;
    if (startedAt) setFirstTokenLatencyMs(Math.round(performance.now() - startedAt));
  }, [firstTokenLatencyMs]);

  const commitRecognizedText = useCallback(() => {
    const session = sessionRef.current;
    if (session.commitDone) return;
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    const text = `${finalTextRef.current}${partialTextRef.current}`.trim();
    session.commitDone = true;
    const metrics = buildMetrics(false);
    options.onMetrics?.(metrics);
    if (text) options.onCommit(text, metrics);
    setState('done');
    window.setTimeout(() => {
      if (sessionRef.current.runId === session.runId) setState('idle');
    }, 900);
  }, [buildMetrics, options]);

  const scheduleCommitRecognizedText = useCallback((delayMs = 450) => {
    if (sessionRef.current.commitDone) return;
    if (commitTimerRef.current) window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = window.setTimeout(() => {
      commitTimerRef.current = null;
      commitRecognizedText();
    }, delayMs);
  }, [commitRecognizedText]);

  const handleServerMessage = useCallback((message: AsrServerMessage) => {
    if (message.type === 'ready') return;

    if (message.type === 'partial') {
      if (sessionRef.current.commitDone) return;
      markFirstToken();
      partialTextRef.current = message.text;
      setPartialText(message.text);
      setState('transcribing');
      if (commitTimerRef.current) scheduleCommitRecognizedText(COMMIT_STABLE_MS);
      return;
    }

    if (message.type === 'final') {
      if (sessionRef.current.commitDone) return;
      markFirstToken();
      partialTextRef.current = '';
      finalTextRef.current += message.text;
      setPartialText('');
      setFinalText(finalTextRef.current);
      setState('transcribing');
      if (commitTimerRef.current) scheduleCommitRecognizedText(COMMIT_STABLE_MS);
      return;
    }

    if (message.type === 'done') {
      scheduleCommitRecognizedText(COMMIT_STABLE_MS);
      return;
    }

    if (message.type === 'error') {
      reportError({ message: message.message || '识别失败，请重试', code: message.code, retryable: message.retryable });
    }
  }, [markFirstToken, reportError, scheduleCommitRecognizedText]);

  const flushPendingChunks = useCallback(() => {
    const client = clientRef.current;
    if (!client || client.readyState !== WebSocket.OPEN) return;
    pendingChunksRef.current.splice(0).forEach((chunk) => client.sendAudio(chunk));
  }, []);

  const stopAndSubmit = useCallback(async (runId: number) => {
    if (sessionRef.current.runId !== runId || sessionRef.current.commitDone) return;
    sessionRef.current.audioMs = await recorderRef.current?.stop().catch(() => 0) || 0;
    recorderRef.current = null;
    flushPendingChunks();
    if (clientRef.current?.readyState === WebSocket.OPEN) {
      clientRef.current.stop();
      setState('transcribing');
      scheduleCommitRecognizedText(FALLBACK_COMMIT_MS);
    } else {
      setState('connecting');
    }
  }, [flushPendingChunks, scheduleCommitRecognizedText]);

  const finishAfterTail = useCallback((runId: number) => {
    const session = sessionRef.current;
    const tailMs = Math.max(0, options.releaseTailMs || 0);
    if (!session.tailBufferDone && tailMs > 0) {
      session.tailBufferDone = true;
      setState('tail-buffering');
      window.setTimeout(() => {
        void stopAndSubmit(runId);
      }, tailMs);
      return;
    }
    void stopAndSubmit(runId);
  }, [options.releaseTailMs, stopAndSubmit]);

  const start = useCallback(async (point: VoicePointerPoint) => {
    if (!isSupported || !['idle', 'done', 'error'].includes(state)) return;

    const runId = sessionRef.current.runId + 1;
    const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionRef.current = {
      runId,
      pointerActive: true,
      pressStartedAt: performance.now(),
      pressStartX: point.clientX,
      pressStartY: point.clientY,
      commitDone: false,
      finishRequested: false,
      startedAt: performance.now(),
      requestId,
      audioMs: 0,
      tailBufferDone: false,
    };

    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    finalTextRef.current = '';
    partialTextRef.current = '';
    pendingChunksRef.current = [];
    setFinalText('');
    setPartialText('');
    setErrorMessage('');
    setIsCancelReady(false);
    setFirstTokenLatencyMs(undefined);
    setState('connecting');

    const client = new AsrWebSocketClient();
    const recorder = new WebAudioPcmRecorder();
    clientRef.current = client;
    recorderRef.current = recorder;

    try {
      const abortPendingStart = async () => {
        await recorder.stop().catch(() => {});
        if (recorderRef.current === recorder) recorderRef.current = null;
        client.close();
        if (clientRef.current === client) clientRef.current = null;
        if (sessionRef.current.runId === runId) {
          setIsCancelReady(false);
          setState('idle');
        }
      };

      await recorder.start({
        frameMs: 200,
        targetSampleRate: 16000,
        onChunk: (chunk) => {
          options.onAudioChunk?.(chunk.slice(0));
          if (client.readyState === WebSocket.OPEN) client.sendAudio(chunk);
          else pendingChunksRef.current.push(chunk);
        },
      });

      if (sessionRef.current.runId !== runId || (!sessionRef.current.pointerActive && !sessionRef.current.finishRequested)) {
        await abortPendingStart();
        return;
      }

      await client.connect({
        wsUrl: options.wsUrl || getDefaultAsrWsUrl(),
        token: options.token,
        requestId,
        hotwords: options.hotwords,
        onMessage: handleServerMessage,
        onError: reportError,
      });

      if (sessionRef.current.runId !== runId) {
        client.cancel();
        await abortPendingStart();
        return;
      }

      flushPendingChunks();
      if (sessionRef.current.finishRequested) {
        finishAfterTail(runId);
        return;
      }

      if (!sessionRef.current.pointerActive) {
        client.cancel();
        await abortPendingStart();
        return;
      }

      setState('listening');
    } catch (error) {
      const message = error instanceof Error ? error.message : '语音输入启动失败，请重试';
      const metrics = buildMetrics(false, 'VOICE_START_FAILED');
      options.onMetrics?.(metrics);
      reportError({ message, code: 'VOICE_START_FAILED', retryable: true });
      await recorder.stop().catch(() => {});
      client.close();
    }
  }, [buildMetrics, finishAfterTail, flushPendingChunks, handleServerMessage, isSupported, options, reportError, state]);

  const move = useCallback((point: VoicePointerPoint, bounds?: VoicePointerBounds) => {
    const session = sessionRef.current;
    if (!session.pointerActive) return;
    const dx = point.clientX - session.pressStartX;
    const dy = point.clientY - session.pressStartY;
    const outside = bounds
      ? point.clientX < bounds.left - 24 || point.clientX > bounds.right + 24 || point.clientY < bounds.top - 24 || point.clientY > bounds.bottom + 24
      : false;
    const nextCancelReady = outside || Math.abs(dx) > SLIDE_CANCEL_PX || dy < -SLIDE_CANCEL_PX;
    setIsCancelReady(nextCancelReady);
    if (nextCancelReady) setState('cancel-ready');
    else if (state === 'cancel-ready') setState(partialTextRef.current || finalTextRef.current ? 'transcribing' : 'listening');
  }, [state]);

  const cancel = useCallback(async () => {
    const metrics = buildMetrics(true);
    options.onMetrics?.(metrics);
    sessionRef.current.runId += 1;
    sessionRef.current.pointerActive = false;
    sessionRef.current.finishRequested = false;
    sessionRef.current.commitDone = true;
    clientRef.current?.cancel();
    clientRef.current = null;
    sessionRef.current.audioMs = await recorderRef.current?.stop().catch(() => 0) || 0;
    recorderRef.current = null;
    if (commitTimerRef.current) {
      window.clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }
    finalTextRef.current = '';
    partialTextRef.current = '';
    pendingChunksRef.current = [];
    setFinalText('');
    setPartialText('');
    setIsCancelReady(false);
    setState('idle');
  }, [buildMetrics, options]);

  const finish = useCallback(async () => {
    const session = sessionRef.current;
    if (!session.pointerActive) return;
    session.pointerActive = false;
    session.finishRequested = true;
    const heldMs = performance.now() - session.pressStartedAt;

    if (isCancelReady || heldMs < MIN_HOLD_MS) {
      await cancel();
      return;
    }

    finishAfterTail(session.runId);
  }, [cancel, finishAfterTail, isCancelReady]);

  const dismissError = useCallback(() => {
    if (state === 'error') {
      setErrorMessage('');
      setState('idle');
    }
  }, [state]);

  return {
    state,
    partialText,
    finalText,
    errorMessage,
    statusText,
    isSupported,
    isActive: ['connecting', 'listening', 'tail-buffering', 'transcribing', 'cancel-ready'].includes(state),
    isCancelReady,
    firstTokenLatencyMs,
    start,
    move,
    finish,
    cancel,
    dismissError,
  };
};

const reportVoiceInputDiagnostic = (error: VoiceInputError) => {
  if (typeof window === 'undefined') return;
  window.fetch('/api/diagnostics/client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      route: window.location.pathname,
      stage: 'voice-input',
      message: error.message,
      detail: {
        code: error.code,
        retryable: error.retryable,
        detail: error.detail,
      },
    }),
  }).catch(() => undefined);
};
