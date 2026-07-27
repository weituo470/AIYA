export type VoiceInputState = 'idle' | 'connecting' | 'listening' | 'tail-buffering' | 'transcribing' | 'cancel-ready' | 'done' | 'error';

export type AsrServerMessage =
  | { type: 'ready'; requestId?: string }
  | { type: 'partial'; text: string; segmentId?: string }
  | { type: 'final'; text: string; segmentId?: string }
  | { type: 'done' }
  | { type: 'error'; message?: string; retryable?: boolean; code?: string };

export type VoiceInputMetrics = {
  requestId: string;
  provider: 'doubao';
  startedAt: number;
  firstPartialAt?: number;
  firstFinalAt?: number;
  stoppedAt?: number;
  cancelled: boolean;
  errorCode?: string;
  audioMs: number;
  finalTextLength: number;
};

export type VoiceInputError = {
  message: string;
  code?: string;
  retryable?: boolean;
  detail?: unknown;
};

export type VoicePointerPoint = {
  clientX: number;
  clientY: number;
};

export type VoicePointerBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
