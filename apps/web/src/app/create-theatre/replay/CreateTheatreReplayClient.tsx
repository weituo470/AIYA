'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { safeHtml } from '../_core/teacher-copy';
import {
  buildReplayScenes,
  createEmptyReplaySample,
  normalizeReplaySample,
  saveReplayToLibrary,
  theatreReplayStorageKey,
  type TheatreReplaySample,
  type TheatreReplayScene,
  type TheatreReplayVersion,
} from '../_core/theatre-replay';
import type { TeacherChatMessage } from '../_core/types';
import { useTeacherVoice } from '../_hooks/useTeacherVoice';
import { useCreateTheatrePublicSettings } from '../../_shared/useCreateTheatrePublicSettings';
import styles from './create-theatre-replay.module.css';

type ArtifactTab = 'preview' | 'code' | 'notes';
type TranscriptEntry =
  | { id: string; kind: 'message'; at: string; message: TeacherChatMessage }
  | { id: string; kind: 'version'; at: string; version: TheatreReplayVersion };

const formatTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const sceneVersion = (scene?: TheatreReplayScene, versions: TheatreReplayVersion[] = []) => {
  if (scene?.version) return scene.version;
  return versions[versions.length - 1];
};

const toTimeValue = (value: string) => {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
};

export default function CreateTheatreReplayClient() {
  const classroomSettings = useCreateTheatrePublicSettings();
  const [sample, setSample] = useState<TheatreReplaySample>(() => createEmptyReplaySample());
  const [selectedSceneIndex, setSelectedSceneIndex] = useState(0);
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(() => new Set());
  const [artifactTabs, setArtifactTabs] = useState<Record<number, ArtifactTab>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [notice, setNotice] = useState('');
  const playRunRef = useRef(0);
  const { speakTeacher, stopTeacherVoice, teacherVoiceStatus, teacherVoiceMessage } = useTeacherVoice();

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(theatreReplayStorageKey);
      const loaded = normalizeReplaySample(raw ? JSON.parse(raw) : null);
      setSample(loaded);
      setSelectedVersionNumber(loaded.versions.at(-1)?.version || null);
    } catch {
      setSample(createEmptyReplaySample());
    }
  }, []);

  const scenes = useMemo(() => buildReplayScenes(sample), [sample]);
  const selectedScene = scenes[Math.min(selectedSceneIndex, Math.max(0, scenes.length - 1))];
  const selectedVersion = useMemo(() => {
    if (selectedVersionNumber) {
      const found = sample.versions.find((version) => version.version === selectedVersionNumber);
      if (found) return found;
    }
    return sceneVersion(selectedScene, sample.versions);
  }, [sample.versions, selectedScene, selectedVersionNumber]);

  const transcriptEntries = useMemo<TranscriptEntry[]>(() => {
    const messages: TranscriptEntry[] = sample.messages.map((message) => ({
      id: `message-${message.id}`,
      kind: 'message',
      at: message.at,
      message,
    }));
    const versions: TranscriptEntry[] = sample.versions.map((version) => ({
      id: `version-${version.version}`,
      kind: 'version',
      at: version.at,
      version,
    }));
    return [...messages, ...versions].sort((left, right) => toTimeValue(left.at) - toTimeValue(right.at));
  }, [sample.messages, sample.versions]);

  useEffect(() => {
    setSelectedSceneIndex((index) => Math.min(index, Math.max(0, scenes.length - 1)));
  }, [scenes.length]);

  const haltPlayback = useCallback(() => {
    playRunRef.current += 1;
    setIsPlaying(false);
    stopTeacherVoice();
  }, [stopTeacherVoice]);

  const selectScene = useCallback((index: number) => {
    haltPlayback();
    const scene = scenes[index];
    setSelectedSceneIndex(index);
    if (scene?.version) setSelectedVersionNumber(scene.version.version);
  }, [haltPlayback, scenes]);

  const selectMessageScene = useCallback((message: TeacherChatMessage) => {
    const index = scenes.findIndex((scene) => scene.id === `${message.id}-message`);
    if (index >= 0) selectScene(index);
  }, [scenes, selectScene]);

  const selectVersionScene = useCallback((version: TheatreReplayVersion) => {
    const index = scenes.findIndex((scene) => scene.version?.version === version.version);
    if (index >= 0) selectScene(index);
    setSelectedVersionNumber(version.version);
  }, [scenes, selectScene]);

  const speakScene = useCallback((scene: TheatreReplayScene | undefined) => {
    if (!scene) return;
    haltPlayback();
    void speakTeacher(scene.narration);
  }, [haltPlayback, speakTeacher]);

  const nextScene = useCallback(() => {
    const next = Math.min(selectedSceneIndex + 1, Math.max(0, scenes.length - 1));
    selectScene(next);
  }, [scenes.length, selectScene, selectedSceneIndex]);

  const previousScene = useCallback(() => {
    const next = Math.max(0, selectedSceneIndex - 1);
    selectScene(next);
  }, [selectScene, selectedSceneIndex]);

  const playFrom = useCallback(async (startIndex: number) => {
    if (!scenes.length) return;
    const runId = playRunRef.current + 1;
    playRunRef.current = runId;
    setIsPlaying(true);
    stopTeacherVoice();

    for (let index = startIndex; index < scenes.length; index += 1) {
      if (playRunRef.current !== runId) return;
      const scene = scenes[index];
      setSelectedSceneIndex(index);
      if (scene.version) setSelectedVersionNumber(scene.version.version);
      await speakTeacher(scene.narration);
    }

    if (playRunRef.current === runId) {
      setIsPlaying(false);
    }
  }, [scenes, speakTeacher, stopTeacherVoice]);

  const toggleVersionExpanded = useCallback((versionNumber: number) => {
    setExpandedVersions((current) => {
      const next = new Set(current);
      if (next.has(versionNumber)) next.delete(versionNumber);
      else next.add(versionNumber);
      return next;
    });
  }, []);

  const setVersionTab = useCallback((versionNumber: number, tab: ArtifactTab) => {
    setArtifactTabs((current) => ({ ...current, [versionNumber]: tab }));
  }, []);

  const saveSample = () => {
    if (!sample.versions.length) {
      setNotice('当前回放为空。请先完成一个项目，再保存学习样本。');
      return;
    }
    const saved = saveReplayToLibrary(sample);
    setSample(saved);
    setNotice('已保存为学习样本。后续可以把它放到新手案例库里。');
  };

  const downloadVersion = (version: TheatreReplayVersion | undefined = selectedVersion) => {
    if (!version?.html) return;
    const blob = new Blob([version.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aiya-replay-v${version.version}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/create-theatre">
          <span className={styles.brandMark}>A</span>
          <div>
            <strong>AIYA 回放课堂</strong>
            <small>对话 · 代码 · 试玩同步复盘</small>
          </div>
        </Link>
        <nav className={styles.nav}>
          <Link href="/create-theatre">返回课堂</Link>
          <button type="button" onClick={saveSample} disabled={!sample.versions.length}>保存样本</button>
        </nav>
      </header>

      <section className={styles.stage}>
        <section className={styles.teacherPanel}>
          <div className={styles.teacherAvatar}>{classroomSettings.teacher.avatar}</div>
          <div className={styles.teacherCopy}>
            <p className={styles.eyebrow}>{classroomSettings.teacher.name} · 回放</p>
            <h1>{sample.title || 'AI 编程课堂回放'}</h1>
            <p>像看聊天一样复盘一次完整创作：老师说了什么、代码怎样变化、每一版能不能试玩，都放在同一个历史窗口里。</p>
          </div>
        </section>

        {notice ? <p className={styles.notice}>{notice}</p> : null}

        <section className={styles.playerBar}>
          <div>
            <span className={styles.liveDot} />
            <div>
              <strong>{selectedScene?.title || '暂无片段'}</strong>
              <small>{teacherVoiceStatus === 'speaking' || teacherVoiceStatus === 'loading' ? teacherVoiceMessage || '老师正在播讲' : '播放会等当前语音结束后再进入下一段'}</small>
            </div>
          </div>
          <div className={styles.playerActions}>
            <button type="button" onClick={previousScene} disabled={selectedSceneIndex <= 0}>上一段</button>
            <button type="button" onClick={() => isPlaying ? haltPlayback() : void playFrom(selectedSceneIndex)} disabled={!scenes.length}>{isPlaying ? '暂停回放' : '播放回放'}</button>
            <button type="button" onClick={() => speakScene(selectedScene)} disabled={!selectedScene}>朗读本段</button>
            <button type="button" onClick={nextScene} disabled={selectedSceneIndex >= scenes.length - 1}>下一段</button>
          </div>
        </section>

        <section className={styles.timeline} aria-label="回放时间轴">
          {!scenes.length ? <p className={styles.empty}>当前没有默认回放。请先在创作课堂完整生成一个项目。</p> : null}
          {scenes.map((scene, index) => (
            <button
              key={scene.id}
              type="button"
              className={[styles.scenePill, index === selectedSceneIndex ? styles.scenePillActive : ''].filter(Boolean).join(' ')}
              onClick={() => selectScene(index)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{scene.title}</strong>
              <small>{scene.type === 'version' ? '作品输出' : scene.type === 'message' ? '对话' : '开场'}</small>
            </button>
          ))}
        </section>

        <section className={styles.replayWindow}>
          <div className={styles.windowHeader}>
            <div>
              <span>课堂历史窗口</span>
              <h2>对话、代码和试玩在同一条时间线里</h2>
            </div>
            <div className={styles.windowStats}>
              <span>{sample.messages.length} 条对话</span>
              <span>{sample.versions.length} 个版本</span>
              <span>{selectedVersion?.lines || 0} 行代码</span>
            </div>
          </div>

          <div className={styles.transcript}>
            {transcriptEntries.length ? transcriptEntries.map((entry) => {
              if (entry.kind === 'message') {
                const message = entry.message;
                return (
                  <article
                    key={entry.id}
                    className={[styles.chatBubble, message.role === 'student' ? styles.chatStudent : styles.chatTeacher].join(' ')}
                    onClick={() => selectMessageScene(message)}
                  >
                    <span>{message.role === 'student' ? '我' : '老师'} · {formatTime(message.at)}</span>
                    <p>{message.text}</p>
                  </article>
                );
              }

              const version = entry.version;
              const expanded = expandedVersions.has(version.version);
              const tab = artifactTabs[version.version] || 'preview';
              return (
                <article key={entry.id} className={[styles.chatBubble, styles.chatTeacher, styles.artifactBubble].join(' ')}>
                  <span>老师 · 第 {version.version} 版输出 · {formatTime(version.at)}</span>
                  <p>第 {version.version} 版完成了。你可以展开查看代码，也可以直接试玩这一版。</p>
                  <section className={styles.artifactCard}>
                    <button
                      type="button"
                      className={styles.artifactSummary}
                      onClick={() => {
                        selectVersionScene(version);
                        toggleVersionExpanded(version.version);
                      }}
                    >
                      <span>V{version.version}</span>
                      <div>
                        <strong>{version.title}</strong>
                        <small>{version.brief}</small>
                      </div>
                      <em>{expanded ? '收起' : '展开'}</em>
                    </button>

                    {expanded ? (
                      <div className={styles.artifactDetail}>
                        <div className={styles.artifactTabs}>
                          <button type="button" className={tab === 'preview' ? styles.tabActive : ''} onClick={() => setVersionTab(version.version, 'preview')}>试玩</button>
                          <button type="button" className={tab === 'code' ? styles.tabActive : ''} onClick={() => setVersionTab(version.version, 'code')}>代码</button>
                          <button type="button" className={tab === 'notes' ? styles.tabActive : ''} onClick={() => setVersionTab(version.version, 'notes')}>说明</button>
                          <button type="button" onClick={() => downloadVersion(version)}>下载 HTML</button>
                        </div>

                        {tab === 'preview' ? (
                          <iframe className={styles.preview} sandbox="allow-scripts" srcDoc={safeHtml(version.html)} title={`AIYA replay version ${version.version}`} />
                        ) : null}

                        {tab === 'code' ? <pre className={styles.code}>{version.html}</pre> : null}

                        {tab === 'notes' ? (
                          <div className={styles.versionNotes}>
                            <strong>这一版做了什么</strong>
                            <p>{version.summary}</p>
                            <small>需求：{version.prompt || '生成一个可运行版本'} · {version.lines} 行 · {version.chars.toLocaleString('zh-CN')} 字符</small>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </section>
                </article>
              );
            }) : (
              <p className={styles.empty}>还没有可回放的对话。请先回到创作课堂，完成一次对话和作品生成。</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
