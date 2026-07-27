'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import styles from './dev.module.css';

type DevEvent = { id?: string; at: string; type: string; text: string };
type DevSession = {
  id: string;
  title: string;
  status: string;
  workspace: string;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string | null;
  events: DevEvent[];
};
type DevFile = { path: string; bytes: number; updatedAt?: string; content?: string };
type DevDiagnostics = {
  codex?: {
    command: string;
    model: string;
    authMode: string;
    ready: boolean;
    warnings: string[];
    nativeReady?: boolean;
    nativeWarnings?: string[];
  };
  claude?: {
    command: string;
    resolvedCommand: string;
    model: string;
    baseUrl: string;
    hasApiKey: boolean;
    ready: boolean;
    warnings: string[];
  };
};

const modeOptions = [
  { value: 'claude-code', label: 'Claude Code', description: '稳定可用 · DeepPraxis Anthropic' },
  { value: 'codex-native', label: 'Codex CLI', description: '稳定可用 · 原生命令行' },
];
const modelOptions = [
  { value: 'qwen3.7-max', label: 'Claude Code · Qwen3.7 Max' },
  { value: 'gpt-5.4-mini', label: 'Codex CLI · Native' },
];
const supportedModels = new Set(modelOptions.map((item) => item.value));
const isTerminalProvider = (provider?: string) => provider === 'codex-native' || provider === 'claude-code';
const isVisibleSession = (item: DevSession) => item.status !== 'failed' && isTerminalProvider(item.provider);

const formatTime = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--';
const formatBytes = (bytes?: number) => !bytes ? '0 B' : bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;

function visibleEventLines(event: DevEvent) {
  const text = cleanEventText(event);
  if (!text) return [];
  const label = event.type === 'user'
    ? '你'
    : event.type === 'stdout'
      ? '助手'
      : event.type === 'error'
        ? '错误'
        : event.type === 'done'
          ? '完成'
          : event.type;
  if (event.type === 'done' && /^exit code 0$/i.test(text)) return [];
  return [`${formatTime(event.at)}  ${label}  ${text}`];
}

function cleanEventText(event: DevEvent) {
  if (event.type === 'command') return '';
  if (event.type === 'system' && /^(workspace created|starting Codex CLI)/i.test(event.text)) return '';
  if (event.type !== 'stdout') return event.text.trim();
  const raw = event.text.trimStart();
  if (/^exec\r?\n/i.test(raw)
    || /^\d{4}-\d{2}-\d{2}T.*\bERROR\b.*codex_core::tools/i.test(raw)
    || /^exited\s+\d+\s+in\s+/i.test(raw)
    || /^succeeded\s+in\s+\d+/i.test(raw)) {
    return '';
  }

  const lines = event.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isInternalCodexLine(line));

  return dedupeAdjacent(lines).join('\n').trim();
}

function isInternalCodexLine(line: string) {
  return /^codex$/i.test(line)
    || /^OpenAI Codex/i.test(line)
    || /^-+$/.test(line)
    || /^\d{4}-\d{2}-\d{2}T.*\b(WARN|INFO|DEBUG|TRACE)\b/i.test(line)
    || /^\d{4}-\d{2}-\d{2}T.*\bERROR\b.*codex_core/i.test(line)
    || /^WARN\b/i.test(line)
    || /^ERROR\s+codex_core/i.test(line)
    || /^exec\s+"/i.test(line)
    || /^Exit code:/i.test(line)
    || /^succeeded\s+in\s+\d+/i.test(line)
    || /^workdir:/i.test(line)
    || /^(model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):/i.test(line)
    || /^user($|\s)/i.test(line)
    || /^Reconnecting\.\.\./i.test(line)
    || /F(?:i)?nish signing in via/i.test(line)
    || /link.*authenticate/i.test(line)
    || /^Press esc to cancel/i.test(line)
    || /^\[redacted sensitive log line\]$/i.test(line);
}

function dedupeAdjacent(lines: string[]) {
  const result: string[] = [];
  for (const line of lines) {
    if (result[result.length - 1] !== line) result.push(line);
  }
  return result;
}

function dedupeTerminalLines(lines: string[]) {
  const result: string[] = [];
  const seenRecent = new Set<string>();
  for (const line of lines) {
    const key = line.replace(/^\d{2}:\d{2}:\d{2}\s+\S+\s+/, '').trim();
    if (!key || seenRecent.has(key)) continue;
    result.push(line);
    seenRecent.add(key);
    if (seenRecent.size > 80) {
      const oldest = result[Math.max(0, result.length - 80)]?.replace(/^\d{2}:\d{2}:\d{2}\s+\S+\s+/, '').trim();
      if (oldest) seenRecent.delete(oldest);
    }
  }
  return result;
}

function buildTerminalWsUrl(sessionId: string, provider: string, cols: number, rows: number) {
  const configured = process.env.NEXT_PUBLIC_AIYA_DEV_RUNNER_WS_URL;
  const url = configured
    ? new URL(configured)
    : new URL('/terminal', window.location.href);
  if (!configured) {
    url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.hostname = window.location.hostname;
    url.port = '3335';
  }
  url.searchParams.set('sessionId', sessionId);
  url.searchParams.set('provider', provider);
  url.searchParams.set('cols', String(cols));
  url.searchParams.set('rows', String(rows));
  return url.toString();
}

export default function DevTerminalClient() {
  const [sessions, setSessions] = useState<DevSession[]>([]);
  const [session, setSession] = useState<DevSession | null>(null);
  const [mode, setMode] = useState('claude-code');
  const [model, setModel] = useState('qwen3.7-max');
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<DevFile[]>([]);
  const [selectedPath, setSelectedPath] = useState('');
  const [selectedFile, setSelectedFile] = useState<DevFile | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [error, setError] = useState('');
  const [diagnostics, setDiagnostics] = useState<DevDiagnostics | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<HTMLDivElement | null>(null);
  const isNativeMode = mode === 'codex-native' || session?.provider === 'codex-native';
  const isClaudeMode = mode === 'claude-code' || session?.provider === 'claude-code';
  const diagnosticReady = isClaudeMode
    ? Boolean(diagnostics?.claude?.ready)
    : Boolean(diagnostics?.codex?.nativeReady);
  const diagnosticTitle = isClaudeMode
    ? (diagnostics?.claude?.ready ? 'Claude Code 已就绪' : 'Claude Code 需要处理')
    : (diagnostics?.codex?.nativeReady ? 'Codex CLI 已登录' : 'Codex CLI 未登录');
  const diagnosticDetail = isClaudeMode
    ? `claude · ${diagnostics?.claude?.model || 'qwen3.7-max'} · DeepPraxis Anthropic`
    : 'codex · native CLI · slash commands';
  const diagnosticWarnings = isClaudeMode
    ? (diagnostics?.claude?.warnings || [])
    : (diagnostics?.codex?.nativeWarnings || []);

  const terminalText = useMemo(() => {
    const lines = session?.events?.length
      ? session.events.flatMap(visibleEventLines)
      : ['AIYA Dev Terminal', '创建或选择一个 session，然后输入任务。', 'Codex 会在隔离 workspace 里执行。'];
    return dedupeTerminalLines(lines).slice(-600).join('\n');
  }, [session?.events]);

  useEffect(() => {
    void refreshSessions(true);
    void refreshDiagnostics();
  }, []);

  useEffect(() => {
    if (!session?.id) return;
    const source = new EventSource(`/api/dev/sessions/${encodeURIComponent(session.id)}/events`);
    source.onmessage = (message) => {
      const payload = JSON.parse(message.data);
      if (payload.session) setSession(payload.session);
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [session?.id]);

  useEffect(() => {
    if (!session?.id) return;
    void refreshFiles();
    if (session.status !== 'running') return;
    const timer = window.setInterval(() => void refreshFiles(), 2500);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.status]);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [terminalText]);

  useEffect(() => {
    if (!session?.id || !isTerminalProvider(session.provider) || !xtermRef.current) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let terminal: any = null;
    let fitAddon: any = null;
    let dataDisposable: { dispose: () => void } | null = null;

    const connect = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !xtermRef.current) return;
      xtermRef.current.innerHTML = '';
      terminal = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontFamily: 'Cascadia Mono, Consolas, Menlo, Monaco, monospace',
        fontSize: 15,
        lineHeight: 1.25,
        scrollback: 3000,
        convertEol: true,
        allowProposedApi: true,
        theme: {
          background: '#0b0b0b',
          foreground: '#e8e8e3',
          cursor: '#e8e8e3',
          selectionBackground: '#264f78',
          black: '#000000',
          red: '#f14c4c',
          green: '#23d18b',
          yellow: '#f5f543',
          blue: '#3b8eea',
          magenta: '#d670d6',
          cyan: '#29b8db',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff',
        },
      });
      fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(xtermRef.current);
      fitAddon.fit();
      terminal.focus();

      socket = new WebSocket(buildTerminalWsUrl(session.id, session.provider, terminal.cols, terminal.rows));
      socket.onopen = () => {
        if (!socket || !terminal || !fitAddon) return;
        fitAddon.fit();
        socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      };
      socket.onmessage = (message) => terminal?.write(typeof message.data === 'string' ? message.data : '');
      socket.onclose = () => {
        if (!disposed) terminal?.write('\r\n\x1b[90m[连接已关闭]\x1b[0m\r\n');
      };
      socket.onerror = () => terminal?.write('\r\n\x1b[31m[WebSocket 连接失败]\x1b[0m\r\n');
      dataDisposable = terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }));
      });
      const onResize = () => {
        if (!terminal || !fitAddon) return;
        fitAddon.fit();
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    };

    let cleanupResize: undefined | (() => void);
    connect().then((cleanup) => { cleanupResize = cleanup; }).catch((err) => setError(err instanceof Error ? err.message : '终端启动失败'));
    return () => {
      disposed = true;
      cleanupResize?.();
      dataDisposable?.dispose();
      socket?.close();
      terminal?.dispose();
    };
  }, [session?.id, session?.provider]);

  useEffect(() => {
    if (!selectedPath || !session?.id) return;
    void loadFile(selectedPath);
  }, [selectedPath, session?.id]);

  async function refreshSessions(autoCreate = false) {
    try {
      const response = await fetch('/api/dev/sessions', { cache: 'no-store' });
      const payload = await response.json();
      const items: DevSession[] = payload.items || [];
      const usableItems = items.filter(isVisibleSession);
      setSessions(usableItems);
      if (!session && usableItems.length) {
        const preferred = usableItems[0];
        if (preferred) {
          setSession(preferred);
          setMode(preferred.provider === 'claude-code' ? 'claude-code' : 'codex-native');
          setModel(preferred.provider === 'claude-code' ? 'qwen3.7-max' : 'gpt-5.4-mini');
        }
      } else if (!session && autoCreate) {
        await createSession();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法连接 dev-runner');
    }
  }

  async function refreshDiagnostics() {
    try {
      const response = await fetch('/api/dev/diagnostics', { cache: 'no-store' });
      const payload = await response.json();
      setDiagnostics(payload);
    } catch {
      setDiagnostics(null);
    }
  }

  async function createSession() {
    setError('');
    const response = await fetch('/api/dev/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: mode === 'claude-code' ? 'Claude Code' : 'Codex CLI',
        provider: mode,
        model: mode === 'claude-code' ? 'qwen3.7-max' : 'gpt-5.4-mini',
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '创建 session 失败');
    setSession(payload.session);
    setMode(payload.session.provider || mode);
    setSessions((current) => [payload.session, ...current.filter((item) => item.id !== payload.session.id)]);
    setFiles([]);
    setSelectedPath('');
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!session || !input.trim() || session.status === 'running') return;
    setError('');
    const content = input.trim();
    setInput('');
    try {
      const response = await fetch(`/api/dev/sessions/${encodeURIComponent(session.id)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, model: session.provider === 'claude-code' ? 'qwen3.7-max' : 'gpt-5.4-mini' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '发送失败');
      setSession(payload.session);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    }
  }

  async function refreshFiles() {
    if (!session) return;
    const response = await fetch(`/api/dev/sessions/${encodeURIComponent(session.id)}/files`, { cache: 'no-store' });
    const payload = await response.json();
    const tree: DevFile[] = payload.tree || [];
    setFiles(tree);
    if (!selectedPath && tree.length) setSelectedPath(tree.find((file) => file.path === 'index.html')?.path || tree[0].path);
  }

  async function loadFile(path: string) {
    if (!session) return;
    const response = await fetch(`/api/dev/sessions/${encodeURIComponent(session.id)}/files?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
    const payload = await response.json();
    setSelectedFile(payload.file || null);
  }

  const sidebarSessions = sessions.filter(
    (item, index, list) => list.findIndex((candidate) => candidate.provider === item.provider) === index,
  );

  return (
    <main className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={session?.status === 'running' ? styles.pulse : styles.dot} />
          <div>
            <strong>AIYA Dev Terminal</strong>
            <small>browser entry · server Codex workspace</small>
          </div>
        </div>
        <div className={styles.topMeta}>
          <span>session {session?.id?.slice(-8) || 'none'}</span>
          <span>{session?.status || 'idle'}</span>
          <span>{session?.model || model}</span>
        </div>
        <nav><a href="/create">Create</a><a href="/">AIYA</a></nav>
      </header>

      <section className={`${styles.layout} ${inspectorCollapsed ? styles.layoutInspectorCollapsed : ''}`}>
        <aside className={styles.sidebar}>
          <button className={styles.primary} onClick={() => void createSession()}>新建 session</button>
          <section className={diagnosticReady ? styles.diagnosticOk : styles.diagnosticWarn}>
            <strong>{diagnosticTitle}</strong>
            <span>{diagnosticDetail}</span>
            {diagnosticWarnings.map((warning) => <p key={warning}>{warning}</p>)}
            {isNativeMode && !diagnosticReady ? <code>codex login</code> : null}
            {isClaudeMode && !diagnosticReady ? <code>ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL</code> : null}
            <button type="button" onClick={() => void refreshDiagnostics()}>重新检测</button>
          </section>
          <div className={styles.modeSwitch}>
            <span>模式</span>
            {modeOptions.map((item) => (
              <button
                key={item.value}
                type="button"
                className={mode === item.value ? styles.modeActive : styles.modeButton}
                onClick={() => setMode(item.value)}
              >
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </button>
            ))}
          </div>
          <div className={styles.sessionList}>
            {sidebarSessions.map((item) => (
              <button key={item.id} className={item.id === session?.id ? styles.activeSession : styles.sessionButton} onClick={() => { setSession(item); setMode(item.provider === 'claude-code' ? 'claude-code' : 'codex-native'); setModel(item.provider === 'claude-code' ? 'qwen3.7-max' : 'gpt-5.4-mini'); }}>
                <strong>{item.title}</strong>
                <span>{item.provider === 'claude-code' ? 'Claude Code' : 'Codex CLI'} · {item.status} · {item.id.slice(-8)}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className={styles.terminalPane}>
          <div className={styles.chrome}><span /><span /><span /><strong>{session?.workspace || 'workspace not created'}</strong></div>
          {isTerminalProvider(session?.provider) ? (
            <div className={styles.xtermHost} ref={xtermRef} />
          ) : (
            <div ref={terminalRef} className={styles.terminal}>
              <pre className={styles.terminalOutput}>{terminalText}</pre>
            </div>
          )}
          {!isTerminalProvider(session?.provider) ? (
            <form className={styles.inputBar} onSubmit={sendMessage}>
              <span>aiya-dev$</span>
              <input value={input} onChange={(event) => setInput(event.target.value)} disabled={!session || session.status === 'running'} placeholder="输入给 Codex 的任务..." />
              <button disabled={!session || !input.trim() || session.status === 'running'}>{session?.status === 'running' ? '运行中' : '发送'}</button>
            </form>
          ) : null}
          {error ? <p className={styles.error}>{error}</p> : null}
        </section>

        <aside className={inspectorCollapsed ? styles.inspectorCollapsed : styles.inspector}>
          <div className={styles.tabs}>
            {inspectorCollapsed ? null : (
              <>
                <button className={!showPreview ? styles.tabActive : styles.tab} onClick={() => setShowPreview(false)}>文件</button>
                <button className={showPreview ? styles.tabActive : styles.tab} onClick={() => setShowPreview(true)}>预览</button>
                <button className={styles.tab} onClick={() => void refreshFiles()}>刷新</button>
              </>
            )}
            <button
              className={styles.collapseButton}
              type="button"
              aria-pressed={inspectorCollapsed}
              onClick={() => setInspectorCollapsed((current) => !current)}
            >
              {inspectorCollapsed ? '展开' : '收起'}
            </button>
          </div>
          {inspectorCollapsed ? (
            <button className={styles.collapsedRail} type="button" onClick={() => setInspectorCollapsed(false)}>
              <span>文件 / 预览</span>
            </button>
          ) : showPreview ? (
              session ? <iframe className={styles.preview} src={`/api/dev/sessions/${encodeURIComponent(session.id)}/preview?ts=${Date.now()}`} /> : <div className={styles.empty}>暂无 session</div>
            ) : (
              <div className={styles.fileMode}>
                <div className={styles.fileTree}>
                  {files.map((file) => (
                    <button key={file.path} className={file.path === selectedPath ? styles.fileActive : styles.fileButton} onClick={() => setSelectedPath(file.path)}>
                      <span>{file.path}</span><small>{formatBytes(file.bytes)}</small>
                    </button>
                  ))}
                </div>
                <pre className={styles.code}>{selectedFile?.content || '选择一个文件查看内容。'}</pre>
              </div>
            )}
        </aside>
      </section>
    </main>
  );
}
