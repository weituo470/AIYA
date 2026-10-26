'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useVoiceInput, VoiceInputButton, type VoiceInputMetrics } from '../../features/voice-input';
import styles from './create-theatre.module.css';

import { aiBasicsQuizQuestions } from './_core/ai-basics-quiz';
import {
  appendNicknameQuestion,
  hasMeaningfulStudentHistory,
  inferStudentProfile,
  isAppBuildRequest,
  isAppRevisionRequest,
  isProfileOnlyStudentMessage,
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
  safePreviewHtml,
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
import { ModelSwitcher } from '../_shared/ModelSwitcher';
import { TaskTracePanel } from '../_shared/TaskTracePanel';
import { selectTaskBuild } from '../_shared/task-trace';
import { actualTaskReply, isTaskStatusQuestion, resolveGenerationDecision, truthfulTeacherReply } from '../_shared/teacher-task-state';
import traceStyles from '../_shared/task-trace.module.css';
import { BuildPreferenceSelector } from '../_shared/BuildPreferenceSelector';
import { GoldenKeyPicker } from '../_shared/GoldenKeyPicker';
import { GoldenKeyJourney } from '../_shared/GoldenKeyJourney';
import type { GoldenKeyContext, GoldenKeyUpgradeDraft } from '../_shared/golden-key-flow';
import goldenKeyStyles from '../_shared/golden-key.module.css';
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
import {
  achievementDefinitions,
  createEmptyAchievementState,
  getAchievementStorageKey,
  mergeAchievementState,
  type AchievementDefinition,
  type AchievementId,
  type AchievementState,
  type AchievementStats,
} from './_core/achievements';

const AUTO_VOICEPRINT_MIN_AUDIO_MS = 3000;
const AUTO_VOICEPRINT_LOGIN_MIN_AUDIO_MS = 1200;
const AUTO_VOICEPRINT_LOGIN_TIMEOUT_MS = 2500;
const THEATRE_DEVICE_ID_KEY = 'aiya:create-theatre:device-id';
const DEVICE_AUTO_LOGIN_SUPPRESSED_SESSION_KEY = 'aiya:create-theatre:device-login-suppressed';
const THEATRE_V2_GUEST_SESSION_KEY = `guest-session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const VOICEPRINT_ENROLLMENT_SENTENCE = '今天很开心能学习AI编程';
const AIYA_APK_APP_ID = 'cc.shenliu.aiya.v2';
const AIYA_APK_UPDATE_ENDPOINT = '/api/create-theatre/apk-updates';
const AIYA_APK_AUTO_DOWNLOAD_KEY_PREFIX = 'aiya:apk-update:auto-downloaded';
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


const achievementUnlockedAt = () => new Date().toISOString();

const achievementPredicates: Record<AchievementId, (stats: AchievementStats) => boolean> = {
  first_code: (stats) => stats.previewConfirmedVersions.length >= 1,
  ai_partner: (stats) => stats.teacherMessages >= 3,
  who_am_i: (stats) => stats.profileCompleted,
  announcer: (stats) => stats.voiceInputUsed,
  success_run: (stats) => stats.previewConfirmedVersions.length >= 1 && stats.validationReviewed,
  no_fear_debug: (stats) => stats.failedThenRetried && stats.previewConfirmedVersions.length >= 1,
  little_inventor: (stats) => stats.revisionCount >= 1 && stats.previewConfirmedVersions.some((version) => version >= 2),
  optimizer: (stats) => stats.previewConfirmedVersions.filter((version) => version >= 2).length >= 2 && (stats.validationReviewed || stats.sourceOpened),
  voiceprint_profile: (stats) => stats.voiceprintEnrolled,
  ai_quiz_master: (stats) => stats.quizCorrect >= 5,
  source_explorer: (stats) => stats.previewConfirmedVersions.length >= 1 && stats.sourceOpened,
  take_home_work: (stats) => stats.previewConfirmedVersions.length >= 1 && stats.downloadedHtml,
};

const resolveUnlockedAchievements = (state: AchievementState) => {
  const nextUnlocked: AchievementState['unlocked'] = {};
  const newlyUnlocked: AchievementDefinition[] = [];
  achievementDefinitions.forEach((achievement) => {
    if (state.unlocked[achievement.id] && achievementPredicates[achievement.id](state.stats)) {
      nextUnlocked[achievement.id] = state.unlocked[achievement.id];
    }
  });
  achievementDefinitions.forEach((achievement) => {
    if (nextUnlocked[achievement.id]) return;
    if (!achievementPredicates[achievement.id](state.stats)) return;
    nextUnlocked[achievement.id] = achievementUnlockedAt();
    newlyUnlocked.push(achievement);
  });
  return {
    state: { ...state, unlocked: nextUnlocked },
    newlyUnlocked,
  };
};

const achievementFireworkBursts = [
  { x: '18%', y: '28%', delay: '80ms', size: '180px', distance: '-68px', farDistance: '-90px', colorA: '#34d399', colorB: '#fde047' },
  { x: '78%', y: '24%', delay: '240ms', size: '210px', distance: '-80px', farDistance: '-105px', colorA: '#38bdf8', colorB: '#f472b6' },
  { x: '50%', y: '18%', delay: '420ms', size: '250px', distance: '-95px', farDistance: '-125px', colorA: '#facc15', colorB: '#22c55e' },
  { x: '29%', y: '62%', delay: '620ms', size: '150px', distance: '-57px', farDistance: '-75px', colorA: '#a78bfa', colorB: '#f97316' },
  { x: '70%', y: '62%', delay: '780ms', size: '160px', distance: '-61px', farDistance: '-80px', colorA: '#fb7185', colorB: '#5eead4' },
] as const;

const achievementComets = [
  { x: '16%', delay: '0ms', tilt: '-16deg', height: '42vh', rise: '-42vh', color: '#34d399' },
  { x: '78%', delay: '160ms', tilt: '13deg', height: '46vh', rise: '-46vh', color: '#38bdf8' },
  { x: '50%', delay: '320ms', tilt: '0deg', height: '54vh', rise: '-54vh', color: '#facc15' },
] as const;

const achievementSparkles = [
  { x: '12%', y: '18%', delay: '260ms', size: '8px', color: '#fef3c7' },
  { x: '25%', y: '46%', delay: '520ms', size: '6px', color: '#bbf7d0' },
  { x: '35%', y: '19%', delay: '720ms', size: '7px', color: '#bfdbfe' },
  { x: '44%', y: '76%', delay: '1040ms', size: '5px', color: '#fde68a' },
  { x: '58%', y: '15%', delay: '880ms', size: '7px', color: '#fecdd3' },
  { x: '67%', y: '49%', delay: '460ms', size: '6px', color: '#ddd6fe' },
  { x: '84%', y: '19%', delay: '620ms', size: '8px', color: '#ccfbf1' },
  { x: '89%', y: '72%', delay: '1120ms', size: '5px', color: '#fed7aa' },
] as const;

const achievementParticleAngles = Array.from({ length: 18 }, (_, index) => `${index * 20}deg`);

const makeAchievementTeacherAnnouncement = (achievements: AchievementDefinition[], nickname?: string) => {
  const studentName = nickname?.trim();
  const studentPrefix = studentName ? `${studentName}同学，` : '';
  if (achievements.length === 1) {
    const [achievement] = achievements;
    return `${studentPrefix}恭喜你解锁了「${achievement.title}」成就。${achievement.description}`;
  }
  const titles = achievements.map((achievement) => `「${achievement.title}」`).join('、');
  return `${studentPrefix}恭喜你一次解锁了 ${achievements.length} 个成就：${titles}。我已经把它们记录到你的学习档案里。`;
};

const playAchievementSynthCelebrationSound = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    if (context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }

    const master = context.createGain();
    const now = context.currentTime;
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.gain.exponentialRampToValueAtTime(0.18, now + 0.025);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 2.15);
    master.connect(context.destination);

    const scheduleTone = ({
      frequency,
      start,
      duration,
      type = 'sine',
      volume = 0.45,
      detune = 0,
    }: {
      frequency: number;
      start: number;
      duration: number;
      type?: OscillatorType;
      volume?: number;
      detune?: number;
    }) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now + start);
      oscillator.detune.setValueAtTime(detune, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(volume, now + start + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      oscillator.connect(gain);
      gain.connect(master);
      oscillator.start(now + start);
      oscillator.stop(now + start + duration + 0.04);
    };

    const scheduleNoisePop = (start: number, duration: number, volume: number) => {
      const sampleRate = context.sampleRate;
      const buffer = context.createBuffer(1, Math.max(1, Math.floor(sampleRate * duration)), sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < channel.length; index += 1) {
        const envelope = 1 - index / channel.length;
        channel[index] = (Math.random() * 2 - 1) * envelope * envelope;
      }
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = buffer;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1600, now + start);
      filter.frequency.exponentialRampToValueAtTime(5200, now + start + duration * 0.55);
      filter.Q.setValueAtTime(1.1, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(volume, now + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(now + start);
      source.stop(now + start + duration);
    };

    const launch = context.createOscillator();
    const launchGain = context.createGain();
    const launchFilter = context.createBiquadFilter();
    launch.type = 'sawtooth';
    launch.frequency.setValueAtTime(120, now);
    launch.frequency.exponentialRampToValueAtTime(1040, now + 0.5);
    launchFilter.type = 'lowpass';
    launchFilter.frequency.setValueAtTime(360, now);
    launchFilter.frequency.exponentialRampToValueAtTime(3200, now + 0.5);
    launchGain.gain.setValueAtTime(0.0001, now);
    launchGain.gain.exponentialRampToValueAtTime(0.18, now + 0.08);
    launchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    launch.connect(launchFilter);
    launchFilter.connect(launchGain);
    launchGain.connect(master);
    launch.start(now);
    launch.stop(now + 0.6);

    scheduleNoisePop(0.52, 0.42, 0.42);
    scheduleNoisePop(0.78, 0.34, 0.26);
    scheduleNoisePop(1.02, 0.30, 0.22);

    [
      { frequency: 659.25, start: 0.48, duration: 0.15, volume: 0.38 },
      { frequency: 880, start: 0.62, duration: 0.16, volume: 0.34 },
      { frequency: 1174.66, start: 0.78, duration: 0.18, volume: 0.32 },
      { frequency: 1567.98, start: 0.96, duration: 0.24, volume: 0.26 },
      { frequency: 2093, start: 1.18, duration: 0.36, volume: 0.2 },
    ].forEach((note, index) => {
      scheduleTone({ ...note, type: 'triangle', detune: index % 2 === 0 ? -8 : 8 });
      scheduleTone({ ...note, frequency: note.frequency * 2, duration: note.duration * 0.72, type: 'sine', volume: note.volume * 0.34 });
    });

    window.setTimeout(() => {
      void context.close().catch(() => undefined);
    }, 2400);
  } catch {
    // Celebration sound is optional. If autoplay or WebAudio is unavailable, keep the achievement flow working.
  }
};

const achievementAudioSources = [
  '/audio/achievements/achievement-celebration-fanfare.wav',
  '/audio/achievements/achievement-celebration-chime.wav',
  '/audio/achievements/achievement-firework-burst-1.ogg',
  '/audio/achievements/achievement-firework-burst-2.ogg',
  '/audio/achievements/achievement-firework-burst-3.ogg',
] as const;

const achievementAudioPool = new Map<string, HTMLAudioElement>();

const warmAchievementAudio = () => {
  if (typeof window === 'undefined') return;
  achievementAudioSources.forEach((src) => {
    if (achievementAudioPool.has(src)) return;
    try {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.load();
      achievementAudioPool.set(src, audio);
    } catch {
      // Audio preloading is a best-effort enhancement.
    }
  });
};

const cloneAchievementAudio = (src: string) => {
  const warmAudio = achievementAudioPool.get(src);
  if (!warmAudio) return new Audio(src);
  const clone = warmAudio.cloneNode(true) as HTMLAudioElement;
  clone.preload = 'auto';
  return clone;
};

const playAchievementAudioClip = (src: string, options: { delayMs?: number; volume?: number } = {}) => new Promise<boolean>((resolve) => {
  if (typeof window === 'undefined') {
    resolve(false);
    return;
  }
  window.setTimeout(() => {
    try {
      const audio = cloneAchievementAudio(src);
      audio.volume = Math.max(0, Math.min(1, options.volume ?? 0.72));
      let settled = false;
      const finish = (started: boolean) => {
        if (settled) return;
        settled = true;
        resolve(started);
      };
      audio.addEventListener('error', () => finish(false), { once: true });
      const playResult = audio.play();
      if (playResult) {
        playResult.then(() => finish(true)).catch(() => finish(false));
      } else {
        finish(true);
      }
      window.setTimeout(() => finish(false), 1400);
    } catch {
      resolve(false);
    }
  }, options.delayMs ?? 0);
});

const playAchievementCelebrationSound = () => {
  warmAchievementAudio();
  let realClipStarted = false;
  const clips = [
    playAchievementAudioClip('/audio/achievements/achievement-celebration-fanfare.wav', { delayMs: 0, volume: 0.46 }),
    playAchievementAudioClip('/audio/achievements/achievement-celebration-chime.wav', { delayMs: 60, volume: 0.35 }),
    playAchievementAudioClip('/audio/achievements/achievement-firework-burst-1.ogg', { delayMs: 180, volume: 0.66 }),
    playAchievementAudioClip('/audio/achievements/achievement-firework-burst-2.ogg', { delayMs: 360, volume: 0.6 }),
    playAchievementAudioClip('/audio/achievements/achievement-firework-burst-3.ogg', { delayMs: 560, volume: 0.54 }),
  ];
  clips.forEach((clip) => {
    clip.then((started) => {
      realClipStarted = realClipStarted || started;
    }).catch(() => undefined);
  });

  window.setTimeout(() => {
    if (!realClipStarted) playAchievementSynthCelebrationSound();
  }, 900);
};

const resolveAchievementProfileKey = (nickname?: string) => {
  const normalized = nickname?.trim();
  return normalized || THEATRE_V2_GUEST_SESSION_KEY;
};

const hasCompletedStudentProfile = (profile: StudentProfile) => Boolean(
  profile.nickname?.trim() && profile.nicknameConfirmedByUser,
);

const loadAchievementState = (nickname?: string) => {
  if (typeof window === 'undefined') return createEmptyAchievementState();
  try {
    const raw = window.localStorage.getItem(getAchievementStorageKey(resolveAchievementProfileKey(nickname)));
    return mergeAchievementState(raw ? JSON.parse(raw) : null);
  } catch {
    return createEmptyAchievementState();
  }
};

const saveAchievementState = (state: AchievementState, nickname?: string) => {
  try {
    window.localStorage.setItem(getAchievementStorageKey(resolveAchievementProfileKey(nickname)), JSON.stringify(state));
  } catch {
    // Achievement state is a learning aid. If storage is unavailable, the page should still work.
  }
};

const getAiyaApkBridge = (): AiyaApkBridge | null => {
  if (typeof window === 'undefined') return null;
  return (window as Window & { AiyaApk?: AiyaApkBridge }).AiyaApk || null;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
};

const saveTextWithAiyaApk = (filename: string, mimeType: string, content: string) => {
  const bridge = getAiyaApkBridge();
  if (!bridge?.saveBase64File || typeof TextEncoder === 'undefined') return false;
  const base64 = bytesToBase64(new TextEncoder().encode(content));
  bridge.saveBase64File(filename, mimeType, base64);
  return true;
};

const downloadUrlWithAiyaApk = (
  url: string,
  filename: string,
  mimeType: string,
  options: { installPrompt?: boolean } = {},
) => {
  const bridge = getAiyaApkBridge();
  if (options.installPrompt && bridge?.downloadAndInstallUrl) {
    bridge.downloadAndInstallUrl(url, filename, mimeType);
    return true;
  }
  if (!bridge?.downloadUrl) return false;
  bridge.downloadUrl(url, filename, mimeType);
  return true;
};

const resolveApkUpdateDownload = (manifest?: ApkUpdateManifest | null) => {
  const rawUrl = manifest?.apkUrl || manifest?.apkPath;
  if (!rawUrl || typeof window === 'undefined') return null;
  const latestName = manifest?.versionName || String(manifest?.versionCode || '新版');
  const filename = manifest?.filename || `aiya-v2-${latestName}.apk`;
  return {
    latestName,
    filename,
    absoluteDownloadUrl: new URL(rawUrl, window.location.href).toString(),
  };
};

const apkAutoDownloadStorageKey = (manifest: ApkUpdateManifest) => [
  AIYA_APK_AUTO_DOWNLOAD_KEY_PREFIX,
  manifest.appId || AIYA_APK_APP_ID,
  manifest.versionCode || manifest.versionName || 'unknown',
  manifest.apkSha256 || manifest.filename || '',
].join(':');

const readAiyaApkVersionCode = (bridge: AiyaApkBridge | null) => {
  if (!bridge) return 0;
  try {
    const raw = bridge.getVersionCode?.();
    const parsed = Number.parseInt(String(raw || '1'), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  } catch {
    return 1;
  }
};

const readAiyaApkVersionName = (bridge: AiyaApkBridge | null) => {
  if (!bridge) return '';
  try {
    return String(bridge.getVersionName?.() || '1.0').trim() || '1.0';
  } catch {
    return '1.0';
  }
};

const readAiyaApkPackageName = (bridge: AiyaApkBridge | null) => {
  if (!bridge) return AIYA_APK_APP_ID;
  try {
    return String(bridge.getPackageNameValue?.() || AIYA_APK_APP_ID).trim() || AIYA_APK_APP_ID;
  } catch {
    return AIYA_APK_APP_ID;
  }
};

const readAiyaApkDeviceId = (bridge: AiyaApkBridge | null = getAiyaApkBridge()) => {
  if (!bridge) return '';
  try {
    const raw = String(bridge.getDeviceId?.() || bridge.getAndroidId?.() || '').trim();
    const safe = raw.replace(/[^a-zA-Z0-9_.:-]+/g, '').slice(0, 80);
    return safe ? `apk-android-${safe}` : '';
  } catch {
    return '';
  }
};

const suppressDeviceAutoLoginForSession = () => {
  try {
    window.sessionStorage.setItem(DEVICE_AUTO_LOGIN_SUPPRESSED_SESSION_KEY, '1');
  } catch {}
};

const clearDeviceAutoLoginSuppression = () => {
  try {
    window.sessionStorage.removeItem(DEVICE_AUTO_LOGIN_SUPPRESSED_SESSION_KEY);
  } catch {}
};

const isDeviceAutoLoginSuppressed = () => {
  try {
    return window.sessionStorage.getItem(DEVICE_AUTO_LOGIN_SUPPRESSED_SESSION_KEY) === '1';
  } catch {
    return false;
  }
};

const formatBytes = (bytes?: number) => {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const triggerBrowserDownload = (href: string, filename: string) => {
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const PlaceholderBadge = ({ achievement }: { achievement: AchievementDefinition }) => (
  <div className={styles.achievementPlaceholder} style={{ '--achievement-color': achievement.color } as CSSProperties}>
    <span>?</span>
  </div>
);

const AchievementUnlockCelebration = ({
  achievement,
  onClose,
}: {
  achievement: AchievementDefinition;
  onClose: () => void;
}) => (
  <div
    className={styles.achievementOverlay}
    role="presentation"
    data-achievement-fireworks="active"
    onClick={onClose}
  >
    <div className={styles.achievementSky} aria-hidden="true">
      <div className={styles.achievementAurora} />
      {achievementComets.map((comet, index) => (
        <i
          key={`comet-${index}`}
          className={styles.achievementComet}
          style={{
            '--comet-x': comet.x,
            '--comet-delay': comet.delay,
            '--comet-tilt': comet.tilt,
            '--comet-height': comet.height,
            '--comet-rise': comet.rise,
            '--comet-color': comet.color,
          } as CSSProperties}
        />
      ))}
      {achievementFireworkBursts.map((burst, burstIndex) => (
        <span
          key={`firework-${burstIndex}`}
          className={styles.achievementFirework}
          style={{
            '--firework-x': burst.x,
            '--firework-y': burst.y,
            '--firework-delay': burst.delay,
            '--firework-size': burst.size,
            '--particle-distance': burst.distance,
            '--particle-far-distance': burst.farDistance,
            '--firework-color-a': burst.colorA,
            '--firework-color-b': burst.colorB,
          } as CSSProperties}
        >
          {achievementParticleAngles.map((angle, particleIndex) => (
            <i
              key={`${angle}-${particleIndex}`}
              style={{
                '--particle-angle': angle,
                '--particle-color': particleIndex % 2 === 0 ? burst.colorA : burst.colorB,
              } as CSSProperties}
            />
          ))}
        </span>
      ))}
      {achievementSparkles.map((sparkle, index) => (
        <i
          key={`sparkle-${index}`}
          className={styles.achievementSparkle}
          style={{
            '--sparkle-x': sparkle.x,
            '--sparkle-y': sparkle.y,
            '--sparkle-delay': sparkle.delay,
            '--sparkle-size': sparkle.size,
            '--sparkle-color': sparkle.color,
          } as CSSProperties}
        />
      ))}
    </div>
    <div className={styles.achievementToast} role="status" aria-live="polite" onClick={(event) => event.stopPropagation()}>
      <button type="button" className={styles.achievementToastClose} aria-label="关闭成就提示" onClick={onClose}>×</button>
      <div className={styles.achievementBurst} aria-hidden="true" />
      <div className={styles.achievementToastRing} aria-hidden="true" />
      <div className={styles.achievementToastIcon}>
        {achievement.available && achievement.icon ? <img src={achievement.icon} alt={achievement.title} /> : <PlaceholderBadge achievement={achievement} />}
      </div>
      <span>ACHIEVEMENT UNLOCKED</span>
      <h3>{achievement.title}</h3>
      <p>{achievement.description}</p>
      <small>烟花庆祝中，6 秒后自动关闭 · 点击空白处也可以关闭</small>
    </div>
  </div>
);

type TeacherChatSendOptions = {
  newProjectDraft?: boolean;
  preTeacherReply?: string;
  baseMessages?: TeacherChatMessage[];
  interactionId?: string;
  restoredCurrentApp?: StudentMemory['currentApp'];
};

type AiyaApkBridge = {
  getVersionCode?: () => number | string;
  getVersionName?: () => string;
  getPackageNameValue?: () => string;
  getDeviceId?: () => string;
  getAndroidId?: () => string;
  saveBase64File?: (filename: string, mimeType: string, base64: string) => void;
  downloadUrl?: (url: string, filename: string, mimeType: string) => void;
  downloadAndInstallUrl?: (url: string, filename: string, mimeType: string) => void;
};

type ApkUpdateManifest = {
  schemaVersion?: number;
  appId?: string;
  channel?: string;
  versionCode?: number;
  versionName?: string;
  apkUrl?: string;
  apkPath?: string;
  filename?: string;
  apkSha256?: string;
  apkBytes?: number;
  required?: boolean;
  autoDownload?: boolean;
  installPrompt?: boolean;
  minSupportedVersionCode?: number;
  message?: string;
  releaseNotes?: string[];
  publishedAt?: string;
};

type ApkUpdateState = {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'downloaded' | 'dismissed' | 'error';
  message: string;
  currentVersionCode?: number;
  currentVersionName?: string;
  required?: boolean;
  manifest?: ApkUpdateManifest;
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
  const apkDeviceId = readAiyaApkDeviceId();
  if (apkDeviceId) return apkDeviceId;
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

const normalizeServerStudentMemory = (payload: any, fallbackNickname?: string): StudentMemory | null => {
  if (!payload?.ok || !payload.memory) return null;
  const memory = payload.memory as StudentMemory;
  const profile = {
    ...(payload.student?.profile || memory.profile || {}),
    nickname: payload.student?.nickname || memory.profile?.nickname || fallbackNickname,
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

const fetchTheatreStudentMemory = async (nickname?: string): Promise<StudentMemory | null> => {
  if (!nickname) return null;
  const response = await fetch(`/api/create-theatre/student-memory?nickname=${encodeURIComponent(nickname)}`, {
    cache: 'no-store',
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => null) : null;
  if (!response?.ok) return null;
  return normalizeServerStudentMemory(payload, nickname);
};

const fetchTheatreStudentMemoryByDeviceId = async (deviceId?: string): Promise<StudentMemory | null> => {
  if (!deviceId) return null;
  const response = await fetch(`/api/create-theatre/student-memory?deviceId=${encodeURIComponent(deviceId)}`, {
    cache: 'no-store',
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => null) : null;
  if (!response?.ok) return null;
  return normalizeServerStudentMemory(payload);
};

const createAndroidDeviceProfile = (deviceId: string): StudentProfile => {
  const suffix = (deviceId.split('-').pop() || deviceId).replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || '0000';
  const now = new Date().toISOString();
  return {
    nickname: `AIYA设备${suffix}`,
    nicknameConfirmedByUser: false,
    deviceBound: true,
    deviceId,
    loginMethod: 'android-device',
    updatedAt: now,
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
  const [goldenKeyDraft, setGoldenKeyDraft] = useState(false);
  const [goldenKeyExampleId, setGoldenKeyExampleId] = useState('');
  const [goldenKeyUpgradeDraft, setGoldenKeyUpgradeDraft] = useState<GoldenKeyUpgradeDraft | null>(null);
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
  const [achievementState, setAchievementState] = useState<AchievementState>(() => createEmptyAchievementState());
  const [achievementQueue, setAchievementQueue] = useState<AchievementDefinition[]>([]);
  const [achievementPanelOpen, setAchievementPanelOpen] = useState(false);
  const [recentAchievements, setRecentAchievements] = useState<AchievementDefinition[]>([]);
  const [achievementAnnouncements, setAchievementAnnouncements] = useState<string[]>([]);
  const [apkDownloadState, setApkDownloadState] = useState<{
    status: 'idle' | 'building' | 'ready' | 'error';
    message: string;
    downloadUrl?: string;
    jobId?: string;
    apkBytes?: number;
  }>({ status: 'idle', message: '' });
  const [apkUpdateState, setApkUpdateState] = useState<ApkUpdateState>({ status: 'idle', message: '' });
  const [apkVersionLabel, setApkVersionLabel] = useState('');
  const [isAiyaApk, setIsAiyaApk] = useState(false);


  const unlockedAchievementCount = Object.keys(achievementState.unlocked).length;
  const latestAchievement = achievementQueue[0] || null;

  const updateAchievements = useCallback((updater: (stats: AchievementStats) => AchievementStats) => {
    setAchievementState((previous) => {
      const previousUnlocked = previous.unlocked;
      const candidate: AchievementState = {
        ...previous,
        stats: updater(previous.stats),
      };
      const resolved = resolveUnlockedAchievements(candidate);
      if (resolved.newlyUnlocked.length) {
        setAchievementQueue((queue) => [...queue, ...resolved.newlyUnlocked].slice(-6));
        setRecentAchievements(resolved.newlyUnlocked);
        playAchievementCelebrationSound();
        setAchievementAnnouncements((queue) => [
          ...queue,
          makeAchievementTeacherAnnouncement(resolved.newlyUnlocked, studentProfileRef.current.nickname),
        ].slice(-6));
      }
      const removedUnlockedIds = Object.keys(previousUnlocked).filter((id) => !resolved.state.unlocked[id as AchievementId]);
      if (removedUnlockedIds.length && !resolved.newlyUnlocked.length) {
        setRecentAchievements([]);
      }
      saveAchievementState(resolved.state, studentProfileRef.current.nickname);
      return resolved.state;
    });
  }, []);

  const closeAchievementToast = useCallback(() => {
    setAchievementQueue((queue) => queue.slice(1));
  }, []);

  useEffect(() => {
    warmAchievementAudio();
  }, []);

  useEffect(() => {
    const bridge = getAiyaApkBridge();
    if (!bridge) return;
    setIsAiyaApk(true);
    const versionName = readAiyaApkVersionName(bridge);
    const versionCode = readAiyaApkVersionCode(bridge);
    const versionText = versionName
      ? `APP v${versionName}${versionCode ? `（${versionCode}）` : ''}`
      : versionCode ? `APP v${versionCode}` : 'APP';
    setApkVersionLabel(versionText);
  }, []);


  useEffect(() => {
    const bridge = getAiyaApkBridge();
    if (!bridge) return undefined;
    let cancelled = false;
    const currentVersionCode = readAiyaApkVersionCode(bridge) || 1;
    const currentVersionName = readAiyaApkVersionName(bridge);
    const appId = readAiyaApkPackageName(bridge);
    setApkUpdateState({
      status: 'checking',
      message: '正在检查 APK 新版本…',
      currentVersionCode,
      currentVersionName,
    });
    const params = new URLSearchParams({
      currentVersionCode: String(currentVersionCode),
      appId,
    });
    fetch(`${AIYA_APK_UPDATE_ENDPOINT}?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as {
          ok?: boolean;
          error?: string;
          update?: { available?: boolean; required?: boolean };
          manifest?: ApkUpdateManifest;
        } | null;
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || `更新检查失败（HTTP ${response.status}）`);
        if (cancelled) return;
        const manifest = payload.manifest;
        const latestCode = Number(manifest?.versionCode || 0);
        if (payload.update?.available && manifest && latestCode > currentVersionCode) {
          const latestName = manifest.versionName || String(latestCode);
          setApkUpdateState({
            status: 'available',
            message: manifest.message || `发现 AIYA APK 新版本 ${latestName}，建议现在更新。`,
            currentVersionCode,
            currentVersionName,
            required: Boolean(payload.update.required),
            manifest,
          });
          return;
        }
        setApkUpdateState({
          status: 'current',
          message: '当前已经是最新 APK。',
          currentVersionCode,
          currentVersionName,
          manifest,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setApkUpdateState({
          status: 'error',
          message: error instanceof Error ? error.message : '暂时无法检查 APK 更新。',
          currentVersionCode,
          currentVersionName,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (apkUpdateState.status !== 'available' || !apkUpdateState.manifest?.autoDownload) return;
    const bridge = getAiyaApkBridge();
    if (!bridge?.downloadUrl && !bridge?.downloadAndInstallUrl) return;
    const manifest = apkUpdateState.manifest;
    const download = resolveApkUpdateDownload(manifest);
    if (!download) return;
    const storageKey = apkAutoDownloadStorageKey(manifest);
    try {
      if (window.localStorage.getItem(storageKey)) return;
    } catch {
      // If localStorage is unavailable, still avoid blocking the update prompt.
    }

    const handledByApk = downloadUrlWithAiyaApk(
      download.absoluteDownloadUrl,
      download.filename,
      'application/vnd.android.package-archive',
      { installPrompt: Boolean(manifest.installPrompt) },
    );
    if (!handledByApk) return;
    try {
      window.localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Best effort only.
    }
    setApkUpdateState((previous) => ({
      ...previous,
      status: 'downloaded',
      message: manifest.installPrompt && bridge.downloadAndInstallUrl
        ? `新版本 ${download.latestName} 已在后台下载。下载完成后，安卓会自动弹出安装确认；仍需你点一次“安装”。`
        : `新版本 ${download.latestName} 已交给安卓系统后台下载。下载完成后，请从系统通知或“下载/AIYA”打开 APK 完成覆盖安装。`,
    }));
  }, [apkUpdateState.status, apkUpdateState.manifest]);

  useEffect(() => {
    if (!latestAchievement) return undefined;
    const timer = window.setTimeout(closeAchievementToast, 6000);
    return () => window.clearTimeout(timer);
  }, [latestAchievement, closeAchievementToast]);

  useEffect(() => {
    const announcement = achievementAnnouncements[0];
    if (!announcement) return;
    setTeacherChatMessages((messages) => {
      if (messages.some((message) => message.role === 'teacher' && message.text === announcement)) return messages;
      return [...messages, makeTeacherMessage(announcement)].slice(-50);
    });
    setAchievementAnnouncements((queue) => queue.slice(1));
  }, [achievementAnnouncements]);

  const handleJobCompleted = useCallback((nextVersion: number, completedJob: CreateJob) => {
    const completionText = `${versionLabel(nextVersion)}\u5b8c\u6210\u4e86\u3002\u73b0\u5728\u4f60\u53ef\u4ee5\u8bd5\u73a9\uff0c\u4e5f\u53ef\u4ee5\u7ee7\u7eed\u8f93\u5165\u60f3\u4f18\u5316\u7684\u5730\u65b9\u3002`;
    updateAchievements((stats) => ({
      ...stats,
      completedApps: stats.completedApps + 1,
      revisionCount: nextVersion > 1 ? stats.revisionCount + 1 : stats.revisionCount,
      failedThenRetried: stats.failedThenRetried || failureRetryUsed,
    }));
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
  }, [failureRetryUsed, updateAchievements]);

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

  const teacherChatInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
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
  const deviceAutoLoginAttemptedRef = useRef(false);
  const teacherChatEndRef = useRef<HTMLDivElement | null>(null);
  const sendTeacherChatRef = useRef<(text?: string, options?: TeacherChatSendOptions) => Promise<void> | void>(() => undefined);
  const autoStartMetaRef = useRef<{ interactionId?: string; replaceCurrentApp?: boolean; goldenKeyContext?: GoldenKeyContext }>({});
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


  useEffect(() => {
    const loaded = loadAchievementState(studentProfile.nickname);
    const resolved = resolveUnlockedAchievements({
      ...loaded,
      stats: {
        ...loaded.stats,
        voiceprintEnrolled: Boolean(studentProfile.voiceprintEnrolled),
        profileCompleted: hasCompletedStudentProfile(studentProfile),
      },
    });
    setAchievementState(resolved.state);
    saveAchievementState(resolved.state, studentProfile.nickname);
  }, [studentProfile.nickname, studentProfile.nicknameConfirmedByUser, studentProfile.voiceprintEnrolled]);

  const activeStageIndex = Math.max(0, stages.findIndex((item) => item.key === (job?.stage || 'queued')));
  const loginStatusName = studentProfile.nickname || '\u6e38\u5ba2';
  const profileStatusText = studentProfile.deviceBound ? '安卓设备建档已完成' : studentProfile.nickname ? '\u5efa\u6863\u5df2\u5b8c\u6210' : '\u6e38\u5ba2\u672a\u5efa\u6863';
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
      updateAchievements((stats) => ({ ...stats, quizCorrect: stats.quizCorrect + 1 }));
    }
  };
  const nextQuizQuestion = () => {
    setQuizIndex((index) => (index + 1) % aiBasicsQuizQuestions.length);
    setQuizAnswerIndex(null);
  };

  const handleDownloadHtml = () => {
    const html = result?.html;
    if (!html) return;
    const filename = `aiya-demo-v${visibleAppVersion || 1}.html`;
    if (saveTextWithAiyaApk(filename, 'text/html; charset=utf-8', html)) {
      setApkDownloadState({ status: 'ready', message: `HTML 已保存到手机“下载/AIYA”目录：${filename}` });
      updateAchievements((stats) => ({ ...stats, downloadedHtml: true }));
      return;
    }
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    triggerBrowserDownload(url, filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
    updateAchievements((stats) => ({ ...stats, downloadedHtml: true }));
  };


  const handleDownloadApk = async () => {
    const html = result?.html;
    if (!html || apkDownloadState.status === 'building') return;
    setApkDownloadState({ status: 'building', message: '\u6b63\u5728\u628a\u4f5c\u54c1\u6253\u5305\u6210 APK\uff0c\u901a\u5e38\u9700\u8981\u5341\u51e0\u79d2\u3002' });
    try {
      const title = result?.title || currentApp?.title || `AIYA Demo V${visibleAppVersion || 1}`;
      const response = await fetch('/api/create-theatre/apk-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ html, title }),
      });
      const payload = await response.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        job?: { id?: string; downloadUrl?: string; apkBytes?: number };
      } | null;
      if (!response.ok || !payload?.ok || !payload.job?.downloadUrl) {
        throw new Error(payload?.error || `APK \u6784\u5efa\u5931\u8d25\uff08HTTP ${response.status}\uff09`);
      }
      const downloadUrl = payload.job.downloadUrl;
      const filename = `aiya-demo-v${visibleAppVersion || 1}.apk`;
      const absoluteDownloadUrl = new URL(downloadUrl, window.location.href).toString();
      const handledByApk = downloadUrlWithAiyaApk(
        absoluteDownloadUrl,
        filename,
        'application/vnd.android.package-archive',
      );
      setApkDownloadState({
        status: 'ready',
        message: handledByApk
          ? `APK 已生成，已交给手机系统下载：${filename}。安装时可能需要允许“未知来源”。`
          : 'APK 已生成，正在开始下载。安卓手机安装时可能需要允许“未知来源”。',
        downloadUrl: absoluteDownloadUrl,
        jobId: payload.job.id,
        apkBytes: payload.job.apkBytes,
      });
      if (!handledByApk) {
        triggerBrowserDownload(downloadUrl, filename);
      }
    } catch (error) {
      setApkDownloadState({
        status: 'error',
        message: error instanceof Error ? error.message : 'APK \u6784\u5efa\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5\u3002',
      });
    }
  };

  const handleDownloadApkUpdate = useCallback(() => {
    const manifest = apkUpdateState.manifest;
    const download = resolveApkUpdateDownload(manifest);
    if (!manifest || !download) return;
    const handledByApk = downloadUrlWithAiyaApk(
      download.absoluteDownloadUrl,
      download.filename,
      'application/vnd.android.package-archive',
      { installPrompt: Boolean(manifest.installPrompt) },
    );
    if (!handledByApk) {
      triggerBrowserDownload(download.absoluteDownloadUrl, download.filename);
    }
    setApkUpdateState((previous) => ({
      ...previous,
      status: 'downloaded',
      message: handledByApk
        ? (manifest.installPrompt && getAiyaApkBridge()?.downloadAndInstallUrl
          ? `新版 ${download.latestName} 已开始下载。下载完成后，安卓会自动弹出安装确认；仍需你点一次“安装”。`
          : `新版 ${download.latestName} 已开始下载。下载完成后，请从系统通知或“下载/AIYA”目录打开 APK 完成覆盖安装。`)
        : `新版 ${download.latestName} 已开始下载。下载完成后，请打开 APK 完成覆盖安装。`,
    }));
  }, [apkUpdateState.manifest]);

  const dismissApkUpdate = useCallback(() => {
    setApkUpdateState((previous) => ({ ...previous, status: 'dismissed' }));
  }, []);

  const currentPreviewVersion = visibleAppVersion || (currentApp?.html ? 1 : 0);
  const hasConfirmedCurrentPreview = currentPreviewVersion > 0
    && achievementState.stats.previewConfirmedVersions.includes(currentPreviewVersion);

  const handleConfirmPreview = () => {
    if (!currentPreviewVersion || !result?.html) return;
    updateAchievements((stats) => ({
      ...stats,
      previewConfirmedVersions: stats.previewConfirmedVersions.includes(currentPreviewVersion)
        ? stats.previewConfirmedVersions
        : [...stats.previewConfirmedVersions, currentPreviewVersion].sort((left, right) => left - right),
    }));
    if (!hasConfirmedCurrentPreview) {
      setTeacherChatMessages((messages) => [
        ...messages,
        makeTeacherMessage(`${versionLabel(currentPreviewVersion)}你已经试玩确认了。成就会在你亲自验证效果后点亮；接下来可以打开「验证」看老师的检查记录，或者告诉我哪里还想优化。`),
      ].slice(-50));
    }
  };

  const handleOpenSource = () => {
    setView('source');
    updateAchievements((stats) => ({ ...stats, sourceOpened: true }));
  };

  const handleOpenEvidence = () => {
    setView('evidence');
    updateAchievements((stats) => ({ ...stats, validationReviewed: true }));
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
    clearDeviceAutoLoginSuppression();
    studentProfileRef.current = enrolledProfile;
    setStudentProfile(enrolledProfile);
    updateAchievements((stats) => ({
      ...stats,
      profileCompleted: hasCompletedStudentProfile(enrolledProfile),
      voiceprintEnrolled: true,
    }));

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
    const activeProfile = studentProfileRef.current;
    if (activeProfile.voiceprintEnrolled || activeProfile.nickname) return null;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), AUTO_VOICEPRINT_LOGIN_TIMEOUT_MS);
    const response = await fetch('/api/create-theatre/voiceprints/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ embedding }),
    }).catch(() => null).finally(() => window.clearTimeout(timeoutId));
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

    clearDeviceAutoLoginSuppression();
    studentProfileRef.current = restoredProfile;
    setStudentProfile(restoredProfile);
    updateAchievements((stats) => ({
      ...stats,
      profileCompleted: hasCompletedStudentProfile(restoredProfile),
      voiceprintEnrolled: true,
    }));
    restoreCurrentApp(memory?.currentApp || null);
    clearReplayProject();
    setVoiceprintStatus(reply);

    return {
      preTeacherReply: reply,
      baseMessages: hasHistory ? memory.chatMessages.slice(-48) : undefined,
      restoredCurrentApp: memory?.currentApp || null,
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
    updateAchievements((stats) => ({ ...stats, voiceInputUsed: true }));
    const embedding = metrics && metrics.audioMs >= AUTO_VOICEPRINT_LOGIN_MIN_AUDIO_MS
      ? createVoiceprintEmbedding(autoVoiceprintAudioChunksRef.current)
      : null;
    autoVoiceprintAudioChunksRef.current = [];
    maybeAutoEnrollVoiceprint(value, embedding, metrics);
    const current = teacherChatInputRef.current?.value ?? teacherChatInput;
    const { next, nextCursor } = buildInputWithVoiceText(current, value);
    setTeacherChatInput(next);

    const shouldAttemptVoiceprintLogin = Boolean(
      embedding
      && metrics
      && metrics.audioMs >= AUTO_VOICEPRINT_LOGIN_MIN_AUDIO_MS
      && !studentProfileRef.current.nickname
      && !studentProfileRef.current.voiceprintEnrolled,
    );
    if (shouldAttemptVoiceprintLogin) {
      setVoiceprintStatus('正在通过声纹识别学生档案…');
    }
    const voiceprintLoginOptions = shouldAttemptVoiceprintLogin
      ? await maybeRecognizeServerVoiceprintFromChat(embedding, metrics).catch(() => null)
      : null;

    window.requestAnimationFrame(() => {
      teacherChatInputRef.current?.focus();
      teacherChatInputRef.current?.setSelectionRange(nextCursor, nextCursor);
      cursorRef.current = { start: nextCursor, end: nextCursor };
      sendTeacherChatRef.current(next, { ...voiceprintLoginOptions, newProjectDraft: goldenKeyDraft });
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
      clearDeviceAutoLoginSuppression();
      studentProfileRef.current = enrolledProfile;
      setStudentProfile(enrolledProfile);
      updateAchievements((stats) => ({
        ...stats,
        profileCompleted: hasCompletedStudentProfile(enrolledProfile),
        voiceprintEnrolled: true,
        voiceInputUsed: true,
      }));
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
    clearDeviceAutoLoginSuppression();
    studentProfileRef.current = restoredProfile;
    setStudentProfile(restoredProfile);
    updateAchievements((stats) => ({
      ...stats,
      profileCompleted: hasCompletedStudentProfile(restoredProfile),
      voiceprintEnrolled: true,
      voiceInputUsed: true,
    }));
    restoreCurrentApp(memory?.currentApp || null);
    clearReplayProject();
    setVoiceprintStatus(reply);
    if (isExplicitNewAppRequest(text) || isAppBuildRequest(text) || isAppRevisionRequest(text)) {
      setTeacherChatInput(text);
      window.requestAnimationFrame(() => {
        sendTeacherChatRef.current(text, {
          preTeacherReply: reply,
          baseMessages: hasHistory ? (memory?.chatMessages || []).slice(-48) : teacherChatMessages,
          restoredCurrentApp: memory?.currentApp || null,
        });
      });
      return;
    }
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

  const handleLogout = useCallback(() => {
    stopTeacherVoice();
    suppressDeviceAutoLoginForSession();
    voiceprintModeRef.current = 'idle';
    voiceprintAudioChunksRef.current = [];
    autoVoiceprintAudioChunksRef.current = [];
    autoVoiceprintNoticeNamesRef.current.clear();
    voiceprintGuideNamesRef.current.clear();
    studentProfileRef.current = {};
    setStudentProfile({});
    setTeacherChatInput('');
    setTeacherChatMessages([
      makeTeacherMessage('已退出当前学生档案。你现在是游客；服务器上的声纹、安卓设备绑定和学习记录不会删除。本次页面不会马上用安卓设备自动登录，方便你用声纹切换同学；下次重新打开 APK 时会再尝试设备自动登录。'),
    ]);
    setVoiceprintStatus('已退出登录。本次页面已暂停安卓设备自动登录；按住下方语音输入说需求，我会先尝试声纹登录。');
    setPrompt('');
    setAutoStartPrompt('');
    autoStartMetaRef.current = {};
    restoreCurrentApp(null);
    clearReplayProject();
    setRecentAchievements([]);
    setAchievementQueue([]);
    setAchievementAnnouncements([]);
    setApkDownloadState({ status: 'idle', message: '' });
  }, [clearReplayProject, restoreCurrentApp, stopTeacherVoice]);

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
    if (!storageReady || studentProfile.nickname || deviceAutoLoginAttemptedRef.current) return undefined;
    const deviceId = readAiyaApkDeviceId();
    if (!deviceId || isDeviceAutoLoginSuppressed()) return undefined;
    deviceAutoLoginAttemptedRef.current = true;
    let cancelled = false;
    void fetchTheatreStudentMemoryByDeviceId(deviceId).then((memory) => {
      if (cancelled || studentProfileRef.current.nickname) return;
      const isNewDeviceProfile = !memory?.profile?.nickname;
      const restoredProfile = {
        ...(memory?.profile?.nickname ? memory.profile : createAndroidDeviceProfile(deviceId)),
        deviceBound: true,
        deviceId,
        loginMethod: 'android-device' as const,
        updatedAt: new Date().toISOString(),
      };
      const reply = isNewDeviceProfile
        ? `${restoredProfile.nickname}，安卓设备建档已完成。以后打开这个 APP，我会默认用这台设备恢复你的学习进度；如果要切换同学，退出后用声纹登录。`
        : `${restoredProfile.nickname}，欢迎回来。我已经根据这台安卓设备把你的学习档案恢复好了。需要切换同学时，先退出登录，再用声纹登录。`;
      studentProfileRef.current = restoredProfile;
      setStudentProfile(restoredProfile);
      restoreCurrentApp(memory?.currentApp || null);
      clearReplayProject();
      setVoiceprintStatus(restoredProfile.voiceprintEnrolled
        ? `已通过安卓设备识别为${restoredProfile.nickname}；声纹档案仍可用于切换登录。`
        : `已完成安卓设备建档：${restoredProfile.nickname}；如果要让别的同学使用，请先退出登录再用声纹登录。`);
      updateAchievements((stats) => ({
        ...stats,
        profileCompleted: hasCompletedStudentProfile(restoredProfile),
        voiceprintEnrolled: Boolean(restoredProfile.voiceprintEnrolled),
      }));
      setTeacherChatMessages([
        ...(memory?.chatMessages || []).slice(-48),
        makeTeacherMessage(reply),
      ].slice(-50));
      if (isNewDeviceProfile) {
        void syncTheatreStudentMemory({
          profile: restoredProfile,
          chatMessages: [makeTeacherMessage(reply)],
          currentApp: null,
        });
      }
      reportTheatreInteraction({
        interactionId: createInteractionId(),
        phase: isNewDeviceProfile ? 'android_device_profile_created' : 'android_device_login',
        message: isNewDeviceProfile ? 'student memory created by Android device id' : 'student memory restored by Android device id',
        studentNickname: restoredProfile.nickname,
        teacherReply: reply,
        currentAppTitle: memory?.currentApp?.title || '',
        decision: {
          deviceIdSource: 'AiyaApk.getDeviceId',
          createdDeviceProfile: isNewDeviceProfile,
          voiceprintConflictAvoided: true,
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [clearReplayProject, restoreCurrentApp, storageReady, studentProfile.nickname, updateAchievements]);

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
    if (!teacherVoiceEnabled) return;
    if (!latestTeacherMessage || spokenTeacherMessageRef.current === latestTeacherMessage.id) return;
    spokenTeacherMessageRef.current = latestTeacherMessage.id;
    void speakTeacher(latestTeacherMessage.text);
  }, [latestTeacherMessage, speakTeacher, teacherVoiceEnabled]);

  const sendTeacherChat = useCallback(async (text = teacherChatInput, options: TeacherChatSendOptions = {}) => {
    const value = text.trim();
    if (!value || isTeacherChatting) return;
    // A chosen template is an explicit new-project draft, not a revision inferred from its wording.
    const usingGoldenKey = Boolean(options.newProjectDraft || (goldenKeyDraft && value === teacherChatInput.trim()));
    const usingGoldenUpgrade = Boolean(!usingGoldenKey && goldenKeyUpgradeDraft && value === teacherChatInput.trim());
    if (usingGoldenUpgrade && (isActive || !currentApp?.html || currentApp.html !== goldenKeyUpgradeDraft?.targetHtml)) {
      setError('当前作品已变化或仍在生成，请重新选择这一轮加强，避免修改错误的作品。');
      return;
    }
    const goldenKeyContext: GoldenKeyContext | undefined = usingGoldenKey && goldenKeyExampleId
      ? { exampleId: goldenKeyExampleId }
      : usingGoldenUpgrade && goldenKeyUpgradeDraft
        ? { exampleId: goldenKeyUpgradeDraft.exampleId, upgradeId: goldenKeyUpgradeDraft.upgradeId } : undefined;
    const interactionId = options.interactionId || createInteractionId();
    setLastInteractionId(interactionId);
    const activeStudentProfile = studentProfileRef.current;
    let nextProfile = usingGoldenKey || usingGoldenUpgrade ? activeStudentProfile : inferStudentProfile(activeStudentProfile, value);
    const isNamingSelf = Boolean(
      nextProfile.nickname
      && nextProfile.nicknameConfirmedByUser
      && (!activeStudentProfile.nicknameConfirmedByUser || nextProfile.nickname !== activeStudentProfile.nickname),
    );
    const wantsNewApp = usingGoldenKey || (!usingGoldenUpgrade && isExplicitNewAppRequest(value));
    const wantsRevision = usingGoldenUpgrade || (!usingGoldenKey && isAppRevisionRequest(value));
    const wantsBuild = isAppBuildRequest(value);
    const hasDevelopmentIntent = wantsNewApp || wantsRevision || wantsBuild;
    let effectiveCurrentApp = options.restoredCurrentApp === undefined ? currentApp : (options.restoredCurrentApp || null);
    let effectiveBaseMessages = options.baseMessages || teacherChatMessages;
    let preTeacherReply = options.preTeacherReply || '';
    reportTheatreInteraction({
      interactionId,
      phase: 'student_message',
      message: 'student sent create-theatre chat message',
      studentNickname: nextProfile.nickname || activeStudentProfile.nickname,
      userText: value,
      currentAppTitle: effectiveCurrentApp?.title || '',
      routeState: {
        hasCurrentApp: Boolean(effectiveCurrentApp?.html),
        isActive,
        jobStatus: job?.status || '',
        jobStage: job?.stage || '',
      },
    });
    updateAchievements((stats) => ({ ...stats, teacherMessages: stats.teacherMessages + 1 }));

    if (isNamingSelf) {
      const memory = await fetchTheatreStudentMemory(nextProfile.nickname);
      if (memory && hasMeaningfulStudentHistory(memory)) {
        const restoredProfile = {
          ...memory.profile,
          nickname: nextProfile.nickname,
          nicknameConfirmedByUser: true,
          loginMethod: 'nickname' as const,
          ageGroup: nextProfile.ageGroup || memory.profile.ageGroup,
          pronoun: nextProfile.pronoun || memory.profile.pronoun,
          updatedAt: new Date().toISOString(),
        };
        const needsVoiceprint = !restoredProfile.voiceprintEnrolled;
        const voiceprintReply = needsVoiceprint && restoredProfile.nickname ? makeVoiceprintGuideReply(restoredProfile.nickname) : '';
        const welcome = `${restoredProfile.nickname}\uFF0C\u6B22\u8FCE\u56DE\u6765\u3002\n\u6211\u628A\u4F60\u4E0A\u6B21\u7684\u5BF9\u8BDD\u548C\u5B66\u4E60\u8FDB\u5EA6\u8C03\u51FA\u6765\u4E86\u3002${voiceprintReply ? `\n${voiceprintReply}` : ''}`;
        clearDeviceAutoLoginSuppression();
        studentProfileRef.current = restoredProfile;
        setStudentProfile(restoredProfile);
        updateAchievements((stats) => ({
          ...stats,
          profileCompleted: hasCompletedStudentProfile(restoredProfile),
          voiceprintEnrolled: Boolean(restoredProfile.voiceprintEnrolled),
        }));
        if (needsVoiceprint && restoredProfile.nickname) {
          setVoiceprintStatus(voiceprintGuideStatus(restoredProfile.nickname));
        }
        restoreCurrentApp(memory.currentApp || null);
        clearReplayProject();
        if (hasDevelopmentIntent) {
          nextProfile = restoredProfile;
          effectiveCurrentApp = memory.currentApp || null;
          effectiveBaseMessages = (memory.chatMessages || []).slice(-48);
          preTeacherReply = [preTeacherReply, welcome].filter(Boolean).join('\n');
          reportTheatreInteraction({
            interactionId,
            phase: 'memory_restored',
            message: 'student memory restored by nickname; continuing with development intent',
            studentNickname: restoredProfile.nickname,
            userText: value,
            teacherReply: welcome,
            currentAppTitle: memory.currentApp?.title || '',
            decision: { restoredHistory: true, startedGeneration: true, continuedWithDevelopmentIntent: true },
          });
        } else {
          setTeacherChatMessages([
            ...(memory.chatMessages || []).slice(-48),
            makeTeacherMessage(welcome),
          ]);
          setPrompt('');
          setTeacherChatInput('');
          setGoldenKeyDraft(false);
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
    }

    const studentMessage = makeStudentMessage(value);
    const baseMessages = effectiveBaseMessages;
    const pendingMessages = [...baseMessages, studentMessage].slice(-50);
    const withPreTeacherReply = (reply: string) => [preTeacherReply, reply].filter(Boolean).join('\n');
    const profileOnly = !usingGoldenKey && !usingGoldenUpgrade && (isNamingSelf || isProfileOnlyStudentMessage(value) || value.trim() === nextProfile.nickname);
    const immediateDecision = resolveGenerationDecision({ isActive, hasCurrentApp: Boolean(effectiveCurrentApp?.html), wantsNewApp, wantsRevision, wantsFirstBuild: isAppBuildRequest(value), userText: value, profileOnly });
    const shouldStartImmediately = immediateDecision.shouldStart;
    const shouldReplaceCurrentApp = Boolean(effectiveCurrentApp?.html && wantsNewApp);
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
        currentApp: effectiveCurrentApp,
        updatedAt: new Date().toISOString(),
      });
    }
    if (nextProfile.nickname) {
      clearDeviceAutoLoginSuppression();
    }
    studentProfileRef.current = nextProfile;
    setStudentProfile(nextProfile);
    if (hasCompletedStudentProfile(nextProfile)) {
      updateAchievements((stats) => ({
        ...stats,
        profileCompleted: true,
        voiceprintEnrolled: Boolean(nextProfile.voiceprintEnrolled),
      }));
    }
    setTeacherChatInput('');
    setGoldenKeyDraft(false);
    setGoldenKeyUpgradeDraft(null);

    if (shouldStartImmediately) {
      const startReply = usingGoldenUpgrade
        ? '收到，这轮会在当前作品上继续加强。完成后，请对照验收点比较前后的效果。'
        : '收到，准备提交这个需求。实际生成进度会显示在下方和“任务轨迹”中。';
      const startReplyForDisplay = effectiveCurrentApp?.html ? stripNicknameQuestions(startReply) : appendNicknameQuestion(startReply, nextProfile);
      const reply = withPreTeacherReply([startReplyForDisplay, voiceprintGuideReply].filter(Boolean).join('\n'));
      const teacherMessage = makeTeacherMessage(reply);
      if (!effectiveCurrentApp?.html || shouldReplaceCurrentApp) {
        beginReplayProject(interactionId, [studentMessage, teacherMessage], nextProfile);
      }
      setTeacherChatMessages([...pendingMessages, teacherMessage].slice(-50));
      reportTheatreInteraction({
        interactionId,
        phase: 'generation_decision',
        message: shouldReplaceCurrentApp ? 'new app generation submission scheduled' : 'generation submission scheduled',
        studentNickname: nextProfile.nickname,
        userText: value,
        teacherReply: reply,
        prompt: value,
        currentAppTitle: effectiveCurrentApp?.title || '',
        decision: {
          wantsNewApp,
          wantsRevision,
          shouldStartImmediately,
          shouldReplaceCurrentApp,
          hasCurrentApp: Boolean(effectiveCurrentApp?.html),
        },
      });
      setPrompt(value);
      autoStartMetaRef.current = { interactionId, replaceCurrentApp: shouldReplaceCurrentApp, goldenKeyContext };
      setAutoStartPrompt(value);
      return;
    }

    if (isTaskStatusQuestion(value)) {
      const statusReply = actualTaskReply({ jobStatus: job?.status, jobStage: job?.stage, currentAppTitle: effectiveCurrentApp?.title });
      setTeacherChatMessages([...pendingMessages, makeTeacherMessage(statusReply)].slice(-50));
      reportTheatreInteraction({ interactionId, phase: 'teacher_reply_only', message: 'actual task status reply', studentNickname: nextProfile.nickname, userText: value, teacherReply: statusReply, currentAppTitle: effectiveCurrentApp?.title || '', decision: { shouldStart: false, source: 'actual-task-state' } });
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
        currentAppTitle: effectiveCurrentApp?.title || '',
        decision: { shouldGuideVoiceprint: true, startedGeneration: false },
      });
      return;
    }

    setTeacherChatMessages(pendingMessages);
    setIsTeacherChatting(true);
    try {
      const response = await fetch('/api/teacher-agent', {
        method: 'POST',
        signal: AbortSignal.timeout(35000),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phase: isActive ? 'waiting_chat' : 'chat',
          userText: value,
          currentAppTitle: effectiveCurrentApp?.title || '',
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
      const { shouldStart, shouldReplaceCurrentApp: agentShouldReplaceCurrentApp } = resolveGenerationDecision({ isActive, hasCurrentApp: Boolean(effectiveCurrentApp?.html), wantsNewApp, wantsRevision: agentWantsRevision, wantsFirstBuild, nextAction: payload.nextAction, userText: value, profileOnly });
      const generationPrompt = String(payload.suggestedPrompt || value).trim();
      const startAwareReply = truthfulTeacherReply(reply, { jobStatus: job?.status, jobStage: job?.stage, currentAppTitle: effectiveCurrentApp?.title }, shouldStart);
      const finalReply = shouldStart
        ? (effectiveCurrentApp?.html ? stripNicknameQuestions(startAwareReply) : appendNicknameQuestion(startAwareReply, nextProfile))
        : removeNicknameQuestions(startAwareReply, nextProfile);
      const teacherMessage = makeTeacherMessage(withPreTeacherReply(finalReply));
      if (shouldStart && (!effectiveCurrentApp?.html || agentShouldReplaceCurrentApp)) {
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
        currentAppTitle: effectiveCurrentApp?.title || '',
        decision: {
          nextAction: payload.nextAction || '',
          wantsNewApp,
          wantsFirstBuild,
          wantsRevision: agentWantsRevision,
          shouldStart,
          shouldReplaceCurrentApp: agentShouldReplaceCurrentApp,
          hasCurrentApp: Boolean(effectiveCurrentApp?.html),
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
        currentAppTitle: effectiveCurrentApp?.title || '',
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
    goldenKeyDraft,
    goldenKeyExampleId,
    goldenKeyUpgradeDraft,
    teacherChatMessages,
  ]);

  useEffect(() => {
    sendTeacherChatRef.current = sendTeacherChat;
  }, [sendTeacherChat]);

  const chooseFirstAppSuggestion = useCallback((suggestion: typeof firstAppSuggestions[number]) => {
    const interactionId = createInteractionId();
    setLastInteractionId(interactionId);
    const reply = appendNicknameQuestion(`\u597D\uFF0C\u6211\u4EEC\u5148\u505A${suggestion.label}\u3002\n准备提交需求，请以下方实际任务进度为准。`, studentProfile);
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

  const createJob = async (ideaOverride?: string, options: { speak?: boolean; isRetry?: boolean; interactionId?: string; replaceCurrentApp?: boolean; goldenKeyContext?: GoldenKeyContext } = {}) => {
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
    updateAchievements((stats) => ({ ...stats, promptCount: stats.promptCount + 1 }));
    const started = await startCreateJob(idea, {
      interactionId,
      replaceCurrentApp: options.replaceCurrentApp,
      goldenKeyContext: options.goldenKeyContext,
      userName: studentProfile.nickname,
      deviceId: getTheatreDeviceId(),
    });
    if (!started) {
      setTeacherChatMessages((messages) => [...messages, makeTeacherMessage('这次需求未能完成生成。请查看错误或任务轨迹后重试；我没有在后台继续编写。')].slice(-50));
      reportTheatreInteraction({
        interactionId,
        phase: 'generation_not_completed',
        message: 'startCreateJob did not complete successfully',
        studentNickname: studentProfile.nickname,
        prompt: idea,
        currentAppTitle: currentApp?.title || '',
        decision: { replaceCurrentApp: Boolean(options.replaceCurrentApp), isRetry: Boolean(options.isRetry) },
      });
      return;
    }
    setPrompt('');
    if (options.speak ?? true) {
      const reply = appendNicknameQuestion(`作品生成已完成，请测试效果。`, studentProfile);
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
    void createJob(job.prompt, { speak: false, isRetry: true, interactionId, goldenKeyContext: job.goldenKeyContext });
  };

  useEffect(() => {
    if (!autoStartPrompt || isActive) return;
    const idea = autoStartPrompt;
    const meta = autoStartMetaRef.current;
    autoStartMetaRef.current = {};
    setAutoStartPrompt('');
    void createJob(idea, { speak: false, interactionId: meta.interactionId, replaceCurrentApp: meta.replaceCurrentApp, goldenKeyContext: meta.goldenKeyContext });
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
    <main className={`${styles.shell} ${isAiyaApk ? styles.apkShell : ''}`}>
      <header className={`${styles.topbar} ${isAiyaApk ? styles.apkTopbar : ''}`}>
        <div className={styles.brand} aria-label={apkVersionLabel || 'AIYA'}>
          {apkVersionLabel ? <em className={styles.appVersionBadge}>{apkVersionLabel}</em> : null}
        </div>
        <nav className={styles.nav}>
            {!isAiyaApk ? <ModelSwitcher /> : null}
          <div
            className={`${styles.loginStatus} ${studentProfile.nickname ? styles.loginStatusKnown : ''}`}
            aria-label={`\u767b\u5f55\u72b6\u6001\uff1a${loginStatusName}\uff0c${profileStatusText}\uff0c${voiceprintStatusText}`}
            title={`\u767b\u5f55\u72b6\u6001\uff1a${loginStatusName}\uff0c${profileStatusText}\uff0c${voiceprintStatusText}`}
          >
            <span className={styles.loginStatusDot} aria-hidden="true" />
            <span><strong>{loginStatusName}</strong><small>{profileStatusText}</small></span>
            <span className={`${styles.loginStatusBadge} ${studentProfile.voiceprintEnrolled ? styles.loginStatusBadgeDone : ''}`}>{voiceprintStatusText}</span>
          </div>
          {studentProfile.nickname ? (
            <button className={styles.logoutButton} type="button" onClick={handleLogout}>退出登录</button>
          ) : null}
          <button className={styles.achievementNavButton} type="button" onClick={() => setAchievementPanelOpen((open) => !open)}>成就 {unlockedAchievementCount}/{achievementDefinitions.length}</button>
          {!isAiyaApk ? <button className={styles.guideEntryButton} type="button" onClick={guide.startGuide}>新手引导</button> : null}
          {!isAiyaApk ? (
            <>
              <a href="/create-theatre">旧版</a><a href="/create">Create</a><a href="/dev">Dev</a><a href="/">AIYA</a>
            </>
          ) : null}
        </nav>
      </header>
      <BuildPreferenceSelector />

      <section className={styles.stage}>
        <div className={styles.creatorCredit} aria-label="作者君维，联系微信16675143990">
          <span>作者：君维</span>
          <span aria-hidden="true">·</span>
          <span>联系微信：16675143990</span>
        </div>
        {(apkUpdateState.status === 'available' || apkUpdateState.status === 'downloading' || apkUpdateState.status === 'downloaded') && apkUpdateState.manifest ? (
          <section className={`${styles.apkUpdateBanner} ${apkUpdateState.required ? styles.apkUpdateBannerRequired : ''}`} role="status" aria-live="polite">
            <div className={styles.apkUpdateCopy}>
              <span className={styles.apkUpdateEyebrow}>APK 在线更新</span>
              <h2>发现新版本 {apkUpdateState.manifest.versionName || apkUpdateState.manifest.versionCode}</h2>
              <p>{apkUpdateState.message}</p>
              <small>
                当前：{apkUpdateState.currentVersionName || '1.0'}（{apkUpdateState.currentVersionCode || 1}）
                {' · '}
                最新：{apkUpdateState.manifest.versionName || apkUpdateState.manifest.versionCode}（{apkUpdateState.manifest.versionCode}）
                {apkUpdateState.manifest.apkBytes ? ` · ${formatBytes(apkUpdateState.manifest.apkBytes)}` : ''}
              </small>
              {apkUpdateState.manifest.releaseNotes?.length ? (
                <ul>
                  {apkUpdateState.manifest.releaseNotes.slice(0, 4).map((note) => <li key={note}>{note}</li>)}
                </ul>
              ) : null}
            </div>
            <div className={styles.apkUpdateActions}>
              <button type="button" onClick={handleDownloadApkUpdate} disabled={apkUpdateState.status === 'downloading'}>
                {apkUpdateState.status === 'downloading' ? '后台下载中…' : apkUpdateState.status === 'downloaded' ? '重新下载' : '立即更新'}
              </button>
              {apkUpdateState.status === 'available' ? (
                <button type="button" className={styles.apkUpdateLaterButton} onClick={dismissApkUpdate}>稍后</button>
              ) : null}
            </div>
          </section>
        ) : null}
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

        <section className={styles.achievementDock} data-testid="achievement-dock" aria-label="AIYA 学习成就">
          <button
            type="button"
            className={styles.achievementDockHeader}
            onClick={() => setAchievementPanelOpen((open) => !open)}
            aria-expanded={achievementPanelOpen}
          >
            <span>学习成就</span>
            <strong>{unlockedAchievementCount}/{achievementDefinitions.length}</strong>
            <small>{latestAchievement ? `刚刚解锁：${latestAchievement.title}` : '完成作品、对话和探索会点亮徽章'}</small>
          </button>
          {achievementPanelOpen ? (
            <div className={styles.achievementGrid}>
              {achievementDefinitions.map((achievement) => {
                const unlockedAt = achievementState.unlocked[achievement.id];
                return (
                  <article
                    key={achievement.id}
                    className={[styles.achievementCard, unlockedAt ? styles.achievementUnlocked : styles.achievementLocked].filter(Boolean).join(' ')}
                    style={{ '--achievement-color': achievement.color } as CSSProperties}
                  >
                    <div className={styles.achievementIconWrap}>
                      {achievement.available && achievement.icon ? (
                        <img
                          src={achievement.icon}
                          alt={achievement.title}
                          className={achievement.id === 'optimizer' ? styles.achievementIconCompact : undefined}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <PlaceholderBadge achievement={achievement} />
                      )}
                    </div>
                    <div>
                      <strong>{achievement.title}</strong>
                      <p>{achievement.description}</p>
                      <small>{unlockedAt ? '已解锁' : achievement.condition}</small>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>

        <section className={styles.teacherDialogWindow} data-testid="teacher-dialog-window" aria-label="学生和老师的对话窗口">
          <div className={styles.dialogTitleBar}>
            <div>
              <span className={styles.dialogDot} />
              <strong>老师对话窗口</strong>
              <small>{isActive ? '老师正在生成当前版本' : '可以先和老师互相认识'}</small>
            </div>
            <div className={styles.dialogMeta}>
              {lastInteractionId && !isAiyaApk ? (
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
                  <small>{studentProfile.nickname && !studentProfile.voiceprintEnrolled ? '已建档。之后使用语音输入时会自动完成声纹记录；也可以在这里手动补录。' : '先建档，再按住“登录”或直接用下方语音输入说需求，老师会尝试声纹登录。原始音频不保存，仅保留服务器声纹特征。'}</small>
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
          <GoldenKeyPicker disabled={isActive || isTeacherChatting} onChoose={(example) => {
            setTeacherChatInput(example.prompt);
            setGoldenKeyDraft(true);
            setGoldenKeyExampleId(example.id);
            setGoldenKeyUpgradeDraft(null);
            window.requestAnimationFrame(() => {
              teacherChatInputRef.current?.focus();
              teacherChatInputRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
            });
          }} />
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
          {goldenKeyDraft || goldenKeyUpgradeDraft ? <div className={goldenKeyStyles.draftNote}>
            <span>{goldenKeyUpgradeDraft ? `🔑 ${goldenKeyUpgradeDraft.title} · 修改当前作品，可调整后发送，不会新建作品。` : '🔑 金钥匙 · 新作品需求，可修改后点击发送。发送后会切换到新作品。'}</span>
            <button type="button" onClick={() => { setGoldenKeyDraft(false); setGoldenKeyUpgradeDraft(null); setTeacherChatInput(''); }}>取消填入</button>
          </div> : null}
          <form
            className={styles.teacherChatForm}
            onSubmit={(event) => {
              event.preventDefault();
              void sendTeacherChat();
            }}
          >
            {goldenKeyDraft || goldenKeyUpgradeDraft ? <textarea
              ref={(element) => { teacherChatInputRef.current = element; }}
              className={goldenKeyStyles.draftInput}
              data-guide-id="teacher-chat-input"
              aria-label={goldenKeyUpgradeDraft ? "金钥匙改进意见" : "金钥匙新作品需求"}
              value={teacherChatInput}
              onChange={(event) => setTeacherChatInput(event.target.value)}
              onClick={rememberCursor} onKeyUp={rememberCursor} onSelect={rememberCursor} onFocus={rememberCursor}
            /> : (
            <input
              ref={(element) => { teacherChatInputRef.current = element; }}
              data-guide-id="teacher-chat-input"
              value={teacherChatInput}
              onChange={(event) => setTeacherChatInput(event.target.value)}
              onClick={rememberCursor}
              onKeyUp={rememberCursor}
              onSelect={rememberCursor}
              onFocus={rememberCursor}
              placeholder={isActive ? '等待时可以问：老师，它现在做到哪一步了？' : currentApp ? '例如：给计算器加上发声功能' : '例如：做一个计算器，或者叫我小宇'}
            />
            )}
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
            {currentApp ? (
              <section className={styles.achievementSettlement} aria-label="成就结算">
                <div>
                  <span>本次收获</span>
                  <h3>{recentAchievements.length ? '新徽章已点亮' : '继续创作，点亮更多徽章'}</h3>
                  <p>每完成一个作品、打开源码或下载 HTML，都会记录你的学习成长。</p>
                </div>
                <div className={styles.achievementSettlementBadges}>
                  {(recentAchievements.length ? recentAchievements : achievementDefinitions.filter((item) => achievementState.unlocked[item.id]).slice(-3)).map((achievement) => (
                    <div key={achievement.id} className={styles.achievementMiniBadge} title={achievement.title}>
                      {achievement.available && achievement.icon ? (
                        <img src={achievement.icon} alt={achievement.title} loading="lazy" decoding="async" />
                      ) : <PlaceholderBadge achievement={achievement} />}
                      <span>{achievement.title}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <div className={styles.tabsBar} data-guide-id="demo-preview-tabs">
              <div className={`${styles.tabs} ${traceStyles.toolbar}`} role="tablist" aria-label="作品查看方式">
                <button className={view === 'preview' ? styles.tabActive : ''} onClick={() => setView('preview')} type="button" role="tab" aria-selected={view === 'preview'}>试玩</button>
                <button className={view === 'source' ? styles.tabActive : ''} onClick={handleOpenSource} type="button" role="tab" aria-selected={view === 'source'}>源码</button>
                <button className={view === 'evidence' ? styles.tabActive : ''} onClick={handleOpenEvidence} type="button" role="tab" aria-selected={view === 'evidence'}>验证</button>
                <button className={view === 'replay' ? styles.tabActive : ''} onClick={() => setView('replay')} type="button" role="tab" aria-selected={view === 'replay'}>回放</button>
                <button className={`${traceStyles.tab} ${view === 'trace' ? styles.tabActive : ''}`} onClick={() => setView('trace')} type="button" role="tab" aria-selected={view === 'trace'}>任务轨迹</button>
              <button disabled={!result?.html} onClick={handleDownloadHtml} type="button">下载 HTML</button>
                <button
                  className={apkDownloadState.status === 'building' ? styles.apkBuildActive : ''}
                  disabled={!result?.html || apkDownloadState.status === 'building'}
                  onClick={handleDownloadApk}
                  type="button"
                >
                  {apkDownloadState.status === 'building' ? '\u751f\u6210 APK\u2026' : '\u4e0b\u8f7d APK'}
                </button>
              </div>
            </div>
            {view === 'preview' ? <GoldenKeyJourney app={currentApp} version={visibleAppVersion} disabled={isActive || isTeacherChatting} onChoose={(exampleId, upgrade) => {
              if (!currentApp?.html || isActive || isTeacherChatting) return;
              setGoldenKeyDraft(false);
              setGoldenKeyUpgradeDraft({ exampleId, upgradeId: upgrade.id, targetHtml: currentApp.html, title: upgrade.title });
              setTeacherChatInput(upgrade.prompt);
              window.requestAnimationFrame(() => {
                teacherChatInputRef.current?.focus();
                teacherChatInputRef.current?.scrollIntoView({ block: 'center', behavior: 'instant' });
              });
            }} /> : null}
            {apkDownloadState.message ? (
              <div className={`${styles.apkDownloadStatus} ${styles[`apkDownloadStatus_${apkDownloadState.status}`] || ''}`} role="status">
                <span>{apkDownloadState.message}</span>
                {apkDownloadState.status === 'ready' && apkDownloadState.downloadUrl ? (
                  <a href={apkDownloadState.downloadUrl}>下载 APK</a>
                ) : null}
              </div>
            ) : null}
            {currentApp && view === 'preview' ? (
              <section className={`${styles.previewConfirm} ${hasConfirmedCurrentPreview ? styles.previewConfirmDone : ''}`} aria-label="试玩确认">
                <div>
                  <span>{hasConfirmedCurrentPreview ? '已完成试玩验证' : '先试玩，再点亮成就'}</span>
                  <p>{hasConfirmedCurrentPreview ? '这一版已经由你确认过效果，继续修改或查看验证依据都能记录学习成长。' : '第一枚成就不会在代码刚写完时发放。请先在下方试玩，确认按钮、分数或交互真的可用。'}</p>
                </div>
                <button type="button" onClick={handleConfirmPreview} disabled={hasConfirmedCurrentPreview || !result?.html}>
                  {hasConfirmedCurrentPreview ? '已确认效果可用' : '我已试玩，效果可用'}
                </button>
              </section>
            ) : null}
            {isActive && view !== 'trace' ? (
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
            {view === 'trace' ? <TaskTracePanel build={selectTaskBuild(job, result)} pending={isActive} failed={job?.status === 'failed'} taskId={job?.id} /> : null}
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
                    {!isAiyaApk ? <a className={styles.replayLink} href="/create-theatre/replay">完整回放页</a> : null}
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
                      <iframe className={styles.replayPreview} sandbox="allow-scripts" srcDoc={safePreviewHtml(activeReplayScene.html)} title="AIYA replay preview" />
                    ) : (
                      <pre className={styles.replayDetail}>{activeReplayScene?.detail || '暂无片段。'}</pre>
                    )}
                  </div>
                </div>
              </section>
            ) : null}
            {view === 'preview' ? <iframe className={styles.preview} sandbox="allow-scripts" srcDoc={safePreviewHtml(result?.html)} title="AIYA demo preview" /> : null}
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
      {latestAchievement ? <AchievementUnlockCelebration achievement={latestAchievement} onClose={closeAchievementToast} /> : null}
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
