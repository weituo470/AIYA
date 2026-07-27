'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultTeacherVoice,
  teacherBrowserSpeechRate,
  teacherVoiceOptions,
  teacherVoiceStorageKey,
  teacherWelcomePlaybackRate,
  welcomeTeacherAudioPath,
  welcomeTeacherText,
} from '../_core/teacher-copy';

export function useTeacherVoice() {
  const [selectedTeacherVoice, setSelectedTeacherVoice] = useState(defaultTeacherVoice);
  const [teacherVoiceStatus, setTeacherVoiceStatus] = useState<'idle' | 'loading' | 'speaking' | 'fallback' | 'error'>('idle');
  const [teacherVoiceMessage, setTeacherVoiceMessage] = useState('');
  const [hasPendingTeacherSpeech, setHasPendingTeacherSpeech] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const pendingTeacherSpeechRef = useRef('');
  const voiceRunRef = useRef(0);

  useEffect(() => {
    try {
      const savedVoice = window.localStorage.getItem(teacherVoiceStorageKey);
      if (savedVoice && teacherVoiceOptions.some((item) => item.value === savedVoice)) {
        setSelectedTeacherVoice(savedVoice);
      }
    } catch {}
  }, []);

  const stopTeacherVoice = useCallback(() => {
    voiceRunRef.current += 1;
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    pendingTeacherSpeechRef.current = '';
    setHasPendingTeacherSpeech(false);
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    window.speechSynthesis?.cancel();
    setTeacherVoiceStatus('idle');
    setTeacherVoiceMessage('');
  }, []);

  const changeTeacherVoice = useCallback((speaker: string) => {
    if (!teacherVoiceOptions.some((item) => item.value === speaker)) return;
    stopTeacherVoice();
    setSelectedTeacherVoice(speaker);
    window.localStorage.setItem(teacherVoiceStorageKey, speaker);
  }, [stopTeacherVoice]);

  useEffect(() => {
    const audio = new Audio(welcomeTeacherAudioPath);
    audio.preload = 'auto';
    audio.playbackRate = teacherWelcomePlaybackRate;
    audio.load();
  }, []);

  const speakTeacher = useCallback(async (text: string) => {
    const content = text.trim();
    if (!content) return;
    const shouldUseWelcomeAudio = content === welcomeTeacherText && selectedTeacherVoice === defaultTeacherVoice;
    const runId = voiceRunRef.current + 1;
    voiceRunRef.current = runId;
    ttsAbortRef.current?.abort();
    const controller = new AbortController();
    ttsAbortRef.current = controller;
    audioRef.current?.pause();
    audioRef.current = null;
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    window.speechSynthesis?.cancel();

    const fallbackToBrowserSpeech = (message: string) => new Promise<void>((resolve) => {
      if (voiceRunRef.current !== runId) {
        resolve();
        return;
      }
      setTeacherVoiceMessage(message);
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) {
        setTeacherVoiceStatus('error');
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(content);
      utterance.lang = 'zh-CN';
      utterance.rate = teacherBrowserSpeechRate;
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find((voiceItem) =>
        voiceItem.lang.toLowerCase().startsWith('zh') && /xiaoxiao|huihui|yaoyao|female/i.test(voiceItem.name),
      ) || voices.find((voiceItem) => voiceItem.lang.toLowerCase().startsWith('zh'));
      if (preferredVoice) utterance.voice = preferredVoice;
      const fallbackTimer = window.setTimeout(() => {
        if (voiceRunRef.current === runId) {
          setTeacherVoiceStatus('idle');
          setTeacherVoiceMessage('');
        }
        resolve();
      }, Math.min(30000, Math.max(3200, content.length * 260)));
      utterance.onend = () => {
        window.clearTimeout(fallbackTimer);
        if (voiceRunRef.current !== runId) return;
        setTeacherVoiceStatus('idle');
        setTeacherVoiceMessage('');
        resolve();
      };
      utterance.onerror = () => {
        window.clearTimeout(fallbackTimer);
        if (voiceRunRef.current === runId) {
          setTeacherVoiceStatus('error');
        }
        resolve();
      };
      setTeacherVoiceStatus('fallback');
      window.speechSynthesis.speak(utterance);
    });

    const playAudioAndWait = (audio: HTMLAudioElement, loadingMessage: string, playingMessage: string) => new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      audio.onplaying = () => {
        if (voiceRunRef.current !== runId) return;
        setTeacherVoiceStatus('speaking');
        setTeacherVoiceMessage(playingMessage);
      };
      audio.onended = () => {
        if (voiceRunRef.current === runId) {
          setTeacherVoiceStatus('idle');
          setTeacherVoiceMessage('');
        }
        finish();
      };
      audio.onpause = () => {
        if (voiceRunRef.current !== runId) finish();
      };
      audio.onerror = () => {
        void fallbackToBrowserSpeech(`${loadingMessage}失败，已切换浏览器朗读`).finally(finish);
      };
      setTeacherVoiceStatus('loading');
      setTeacherVoiceMessage(loadingMessage);
      audio.play().catch(reject);
    });

    try {
      if (shouldUseWelcomeAudio) {
        const audio = new Audio(welcomeTeacherAudioPath);
        audio.preload = 'auto';
        audio.playbackRate = teacherWelcomePlaybackRate;
        audioRef.current = audio;
        await playAudioAndWait(audio, '\u64ad\u653e\u9884\u5f55\u6b22\u8fce\u8bed\u97f3', '\u64ad\u653e\u9884\u5f55\u6b22\u8fce\u8bed\u97f3');
        return;
      }

      const streamUrl = `/api/teacher-tts/stream?${new URLSearchParams({
        text: content,
        speaker: selectedTeacherVoice,
      }).toString()}`;
      const audio = new Audio(streamUrl);
      audio.preload = 'auto';
      audioRef.current = audio;
      await playAudioAndWait(audio, '\u6b63\u5728\u8fde\u63a5\u5b9e\u65f6\u8bed\u97f3', '\u8001\u5e08\u6b63\u5728\u5b9e\u65f6\u8bb2\u89e3');
    } catch (reason) {
      if (voiceRunRef.current !== runId || (reason instanceof DOMException && reason.name === 'AbortError')) return;
      const message = reason instanceof Error ? reason.message : '\u8bed\u97f3\u64ad\u653e\u5931\u8d25';
      const isAutoplayBlocked = reason instanceof DOMException && reason.name === 'NotAllowedError';
      if (isAutoplayBlocked || /user didn't interact|notallowed|play\(\) failed/i.test(message)) {
        pendingTeacherSpeechRef.current = content;
        setHasPendingTeacherSpeech(true);
        setTeacherVoiceStatus('idle');
        setTeacherVoiceMessage('\u70b9\u51fb\u9875\u9762\u4efb\u610f\u4f4d\u7f6e\u64ad\u653e\u8001\u5e08\u8bed\u97f3');
        return;
      }
      await fallbackToBrowserSpeech(`${message}\uff0c\u5df2\u5207\u6362\u6d4f\u89c8\u5668\u6717\u8bfb`);
    }
  }, [selectedTeacherVoice]);

  const resumePendingTeacherSpeech = useCallback(() => {
    const text = pendingTeacherSpeechRef.current;
    if (!text) return;
    pendingTeacherSpeechRef.current = '';
    setHasPendingTeacherSpeech(false);
    void speakTeacher(text);
  }, [speakTeacher]);

  useEffect(() => {
    window.addEventListener('pointerdown', resumePendingTeacherSpeech, { capture: true });
    window.addEventListener('touchstart', resumePendingTeacherSpeech, { capture: true });
    window.addEventListener('keydown', resumePendingTeacherSpeech, { capture: true });
    return () => {
      window.removeEventListener('pointerdown', resumePendingTeacherSpeech, { capture: true });
      window.removeEventListener('touchstart', resumePendingTeacherSpeech, { capture: true });
      window.removeEventListener('keydown', resumePendingTeacherSpeech, { capture: true });
    };
  }, [resumePendingTeacherSpeech]);

  const selectedTeacherVoiceOption = teacherVoiceOptions.find((item) => item.value === selectedTeacherVoice) || teacherVoiceOptions[0];

  return {
    selectedTeacherVoice,
    selectedTeacherVoiceOption,
    teacherVoiceStatus,
    teacherVoiceMessage,
    hasPendingTeacherSpeech,
    resumePendingTeacherSpeech,
    stopTeacherVoice,
    changeTeacherVoice,
    speakTeacher,
  };
}
