'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './page.module.css';

type ModelMode = 'default' | 'fast' | 'quality';
type HermesProfileForm = {
  baseUrl: string;
  model: string;
  apiKey: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  clearApiKey?: boolean;
  updatedAt?: string;
};
type ClassroomSettings = {
  teacher: { name: string; avatar: string };
  modelMode: ModelMode;
  hermesProfiles: Record<ModelMode, HermesProfileForm>;
  updatedAt?: string;
};
type RuntimeModelConfig = {
  baseUrl: string;
  model: string;
  modelMode: ModelMode;
  apiType: string;
  provider: string;
  timeoutMs: number;
  maxTurns: number;
  maxTokens: number;
  jsonMode: boolean;
  thinkingMode: string;
  source: 'admin-profile' | 'environment';
  hasApiKey: boolean;
  apiKeyMasked: string;
};
type ModelChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
  model?: string;
  durationMs?: number;
};
type ModelChatResult = {
  content: string;
  model: string;
  status: number;
  durationMs: number;
  completedAt: string;
};
type EndpointCheck = {
  ok: boolean;
  url: string;
  status?: number;
  durationMs: number;
  error?: string;
};
type ModelTestResult = {
  ok: boolean;
  available: boolean;
  testedAt: string;
  totalDurationMs: number;
  model: string;
  discovery: EndpointCheck & {
    modelCount?: number;
    modelFound?: boolean;
    sampleModels?: string[];
  };
  completion: EndpointCheck & {
    responsePreview?: string;
    returnedModel?: string;
  };
};
type AdminStudent = {
  id: string;
  nickname: string;
  updatedAt?: string;
  lastSeenAt?: string;
  voiceprint?: { sampleCount?: number; updatedAt?: string } | null;
  latestSession?: { messageCount: number; hasCurrentApp: boolean; updatedAt: string } | null;
};
type AdminTaskProcessEvent = {
  id: string;
  at?: string | null;
  stage: string;
  status: string;
  title: string;
  summary?: string;
  detail?: unknown;
};
type AdminTaskProcess = {
  modelFailover?: unknown[];
  generationAttempts?: unknown[];
  timeline?: AdminTaskProcessEvent[];
};
type AdminTaskConversationEntry = {
  id: string;
  role: 'user' | 'teacher' | 'system';
  text: string;
  at?: string | null;
  phase: string;
  source: string;
  detail?: unknown;
};
type AdminTask = {
  id: string;
  diagnosticId: string;
  clientTaskId?: string | null;
  interactionId?: string | null;
  userKey: string;
  userName: string;
  studentId?: string | null;
  deviceId?: string | null;
  sessionId?: string | null;
  source: string;
  appId?: string | null;
  appVersion?: string | null;
  status: 'started' | 'succeeded' | 'failed' | 'cancelled' | string;
  stage: string;
  idea: string;
  request?: unknown;
  currentApp?: unknown;
  result?: unknown;
  error?: unknown;
  attempts?: unknown;
  modelMode?: string | null;
  model?: string | null;
  provider?: string | null;
  apiType?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  startedAt: string;
  finishedAt?: string | null;
  updatedAt?: string;
  process?: AdminTaskProcess;
  conversation?: AdminTaskConversationEntry[];
  interactionEvents?: unknown[];
  diagnosticEvents?: unknown[];
};
type AdminPayload = {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  settings?: ClassroomSettings;
  runtimeModel?: RuntimeModelConfig;
  runtimeModels?: Partial<Record<ModelMode, RuntimeModelConfig>>;
  kpis?: {
    studentCount: number;
    voiceprintCount: number;
    sessionCount: number;
    taskCount?: number;
    failedTaskCount?: number;
    runningTaskCount?: number;
    succeededTaskCount?: number;
  };
  students?: AdminStudent[];
  tasks?: AdminTask[];
  taskPage?: { offset: number; limit: number; filteredTotal: number; hasMore: boolean };
};

const tokenKey = 'aiya:create-theatre-admin-token';
const emptyHermesProfile = (): HermesProfileForm => ({
  baseUrl: '',
  model: '',
  apiKey: '',
  hasApiKey: false,
  apiKeyMasked: '',
});
const defaultSettings: ClassroomSettings = {
  teacher: { name: 'AIYA老师', avatar: '师' },
  modelMode: 'default',
  hermesProfiles: {
    default: emptyHermesProfile(),
    fast: emptyHermesProfile(),
    quality: emptyHermesProfile(),
  },
};
const modelOptions: Array<{ id: ModelMode; label: string; note: string }> = [
  { id: 'default', label: '默认稳定', note: '日常课堂主模型，优先保证稳定性。' },
  { id: 'fast', label: '速度优先', note: '快速试错和简单应用生成。' },
  { id: 'quality', label: '质量优先', note: '复杂游戏、交互和精修任务。' },
];
const formatTime = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
};
const formatDuration = (value?: number | null) => {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} 秒`;
};
const taskStatusLabel = (status: string) => ({
  started: '进行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已撤销',
}[status] || status || '未知');
const prettyJson = (value: unknown) => {
  if (value == null) return '无';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};
const valueRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
);
const processStatusLabel = (status: string) => ({
  started: '进行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已撤销',
}[status] || status || '未知');
const normalizeProfile = (profile?: Partial<HermesProfileForm>): HermesProfileForm => ({
  baseUrl: profile?.baseUrl || '',
  model: profile?.model || '',
  apiKey: '',
  hasApiKey: Boolean(profile?.hasApiKey),
  apiKeyMasked: profile?.apiKeyMasked || '',
  updatedAt: profile?.updatedAt,
});
const normalizeSettings = (
  settings?: Partial<ClassroomSettings>,
  runtimeModels?: Partial<Record<ModelMode, RuntimeModelConfig>>,
  runtimeModel?: RuntimeModelConfig,
): ClassroomSettings => {
  const normalized: ClassroomSettings = {
    teacher: {
      name: settings?.teacher?.name || defaultSettings.teacher.name,
      avatar: settings?.teacher?.avatar || defaultSettings.teacher.avatar,
    },
    modelMode: settings?.modelMode || defaultSettings.modelMode,
    hermesProfiles: {
      default: normalizeProfile(settings?.hermesProfiles?.default),
      fast: normalizeProfile(settings?.hermesProfiles?.fast),
      quality: normalizeProfile(settings?.hermesProfiles?.quality),
    },
    updatedAt: settings?.updatedAt,
  };
  const effectiveRuntimeModels = { ...runtimeModels };
  if (runtimeModel && !effectiveRuntimeModels[runtimeModel.modelMode]) {
    effectiveRuntimeModels[runtimeModel.modelMode] = runtimeModel;
  }
  (['default', 'fast', 'quality'] as ModelMode[]).forEach((mode) => {
    const profile = normalized.hermesProfiles[mode];
    const effective = effectiveRuntimeModels[mode];
    if (effective && !profile.baseUrl && !profile.model) {
      normalized.hermesProfiles[mode] = {
        ...profile,
        baseUrl: effective.baseUrl,
        model: effective.model,
        hasApiKey: effective.hasApiKey,
        apiKeyMasked: effective.apiKeyMasked,
      };
    }
  });
  return normalized;
};

export default function CreateTheatreAdminPage() {
  const [token, setToken] = useState('');
  const [data, setData] = useState<AdminPayload | null>(null);
  const [settingsForm, setSettingsForm] = useState<ClassroomSettings>(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingModel, setTestingModel] = useState(false);
  const [operationPassword, setOperationPassword] = useState('');
  const [chatMessages, setChatMessages] = useState<ModelChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatting, setChatting] = useState(false);
  const [modelTest, setModelTest] = useState<ModelTestResult | null>(null);
  const [taskStatus, setTaskStatus] = useState('all');
  const [taskSearch, setTaskSearch] = useState('');
  const [expandedTaskId, setExpandedTaskId] = useState('');
  const [taskDetails, setTaskDetails] = useState<Record<string, AdminTask>>({});
  const [loadingTaskId, setLoadingTaskId] = useState('');
  const [showcaseTaskId, setShowcaseTaskId] = useState('');
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [activeTaskQuery, setActiveTaskQuery] = useState({ status: 'all', search: '' });
  const [message, setMessage] = useState('输入管理员口令后读取课堂数据。');

  useEffect(() => {
    const saved = window.localStorage.getItem(tokenKey) || '';
    setToken(saved);
    if (saved) void load(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const students = useMemo(() => data?.students || [], [data]);
  const tasks = useMemo(() => data?.tasks || [], [data]);
  const visibleTasks = useMemo(() => {
    const search = taskSearch.trim().toLocaleLowerCase();
    return tasks.filter((task) => {
      if (taskStatus !== 'all' && task.status !== taskStatus) return false;
      if (!search) return true;
      return [
        task.diagnosticId,
        task.clientTaskId,
        task.interactionId,
        task.userName,
        task.userKey,
        task.deviceId,
        task.idea,
        task.model,
        task.source,
      ].some((value) => String(value || '').toLocaleLowerCase().includes(search));
    });
  }, [taskSearch, taskStatus, tasks]);
  const savedSettings = normalizeSettings(data?.settings, data?.runtimeModels, data?.runtimeModel);
  const activeMode = settingsForm.modelMode;
  const activeProfile = settingsForm.hermesProfiles[activeMode];
  const savedActiveProfile = savedSettings.hermesProfiles[activeMode];
  const selectedRuntimeModel = data?.runtimeModels?.[activeMode]
    || (data?.runtimeModel?.modelMode === activeMode ? data.runtimeModel : undefined);
  const activeOption = modelOptions.find((option) => option.id === activeMode) || modelOptions[0];

  const updateActiveProfile = (patch: Partial<HermesProfileForm>) => {
    setSettingsForm((current) => ({
      ...current,
      hermesProfiles: {
        ...current.hermesProfiles,
        [current.modelMode]: {
          ...current.hermesProfiles[current.modelMode],
          ...patch,
        },
      },
    }));
    setModelTest(null);
    setChatMessages([]);
  };

  const load = async (nextToken = token) => {
    setLoading(true);
    setMessage('正在读取服务端数据...');
    try {
      const response = await fetch('/api/admin/create-theatre?taskLimit=500', {
        headers: nextToken ? { 'x-admin-token': nextToken } : {},
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as AdminPayload | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '读取失败：' + response.status);
      const nextSettings = normalizeSettings(payload.settings, payload.runtimeModels, payload.runtimeModel);
      window.localStorage.setItem(tokenKey, nextToken);
      setData(payload);
      setSettingsForm(nextSettings);
      setModelTest(null);
      setMessage('已更新：' + formatTime(payload.generatedAt));
    } catch (error) {
      setData(null);
      setMessage(error instanceof Error ? error.message : '读取失败');
    } finally {
      setLoading(false);
    }
  };

  const loadTaskPage = async (reset: boolean) => {
    setLoadingTasks(true);
    try {
      const offset = reset ? 0 : tasks.length;
      const query = reset
        ? { status: taskStatus, search: taskSearch.trim() }
        : activeTaskQuery;
      if (reset) setActiveTaskQuery(query);
      const params = new URLSearchParams({
        tasksOnly: '1',
        taskLimit: '500',
        taskOffset: String(offset),
        taskStatus: query.status,
        taskSearch: query.search,
      });
      const response = await fetch(`/api/admin/create-theatre?${params.toString()}`, {
        headers: token ? { 'x-admin-token': token } : {},
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as AdminPayload | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `读取任务失败：${response.status}`);
      setData((current) => {
        const incoming = payload.tasks || [];
        const nextTasks = reset
          ? incoming
          : [...(current?.tasks || []), ...incoming.filter((task) => !(current?.tasks || []).some((item) => item.id === task.id))];
        return current
          ? { ...current, tasks: nextTasks, taskPage: payload.taskPage }
          : { ok: true, tasks: nextTasks, taskPage: payload.taskPage };
      });
      setExpandedTaskId('');
      setMessage(`任务查询完成：返回 ${payload.tasks?.length || 0} 条。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取任务失败');
    } finally {
      setLoadingTasks(false);
    }
  };

  const toggleTaskDetails = async (task: AdminTask) => {
    if (expandedTaskId === task.id) {
      setExpandedTaskId('');
      return;
    }
    setExpandedTaskId(task.id);
    if (taskDetails[task.id]) return;
    setLoadingTaskId(task.id);
    try {
      const response = await fetch(`/api/admin/create-theatre?taskId=${encodeURIComponent(task.id)}`, {
        headers: token ? { 'x-admin-token': token } : {},
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; task?: AdminTask; error?: string } | null;
      if (!response.ok || !payload?.ok || !payload.task) {
        throw new Error(payload?.error || `读取任务详情失败：${response.status}`);
      }
      setTaskDetails((current) => ({ ...current, [task.id]: payload.task! }));
    } catch (error) {
      setExpandedTaskId('');
      setMessage(error instanceof Error ? error.message : '读取任务详情失败');
    } finally {
      setLoadingTaskId('');
    }
  };

  const copyTaskRecord = async (task: AdminTask) => {
    try {
      await navigator.clipboard.writeText(prettyJson(task));
      setMessage(`已复制完整任务记录：${task.diagnosticId}`);
    } catch {
      setMessage('复制失败，请在下方“完整任务记录”中手动复制。');
    }
  };

  const downloadTaskRecord = (task: AdminTask) => {
    const blob = new Blob([prettyJson(task)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `aiya-task-${task.diagnosticId}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(`已导出完整任务记录：${task.diagnosticId}`);
  };

  const setTaskShowcase = async (task: AdminTask, enabled: boolean) => {
    setShowcaseTaskId(task.id);
    try {
      const response = await fetch('/api/admin/create-theatre', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
        },
        body: JSON.stringify({ action: 'set_task_showcase', taskId: task.id, enabled }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; task?: AdminTask; message?: string; error?: string } | null;
      if (!response.ok || !payload?.ok || !payload.task) throw new Error(payload?.error || '设置展示作品失败。');
      setTaskDetails((current) => ({ ...current, [task.id]: payload.task! }));
      setMessage(payload.message || (enabled ? '已设为优秀作品展示。' : '已取消优秀作品展示。'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '设置展示作品失败。');
    } finally {
      setShowcaseTaskId('');
    }
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    setMessage('正在加密保存课堂配置...');
    try {
      const response = await fetch('/api/admin/create-theatre', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
        },
        body: JSON.stringify({
          action: 'save_settings',
          operationPassword,
          teacher: settingsForm.teacher,
          modelMode: activeMode,
          hermesProfile: {
            baseUrl: activeProfile.baseUrl,
            model: activeProfile.model,
            apiKey: activeProfile.apiKey,
            clearApiKey: Boolean(activeProfile.clearApiKey),
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '保存失败：' + response.status);
      const nextSettings = normalizeSettings(payload.settings, payload.runtimeModels, payload.runtimeModel);
      setSettingsForm(nextSettings);
      setData((current) => current
        ? { ...current, settings: payload.settings, runtimeModel: payload.runtimeModel, runtimeModels: payload.runtimeModels }
        : { ok: true, settings: payload.settings, runtimeModel: payload.runtimeModel, runtimeModels: payload.runtimeModels });
      setOperationPassword('');
      setMessage('课堂配置已保存：' + formatTime(payload.updatedAt));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setSavingSettings(false);
    }
  };

  const testModel = async () => {
    setTestingModel(true);
    setModelTest(null);
    setMessage('正在检测「' + activeOption.label + '」模型...');
    try {
      const hasUnsavedProfileChanges = Boolean(
        activeProfile.apiKey
        || activeProfile.clearApiKey
        || activeProfile.baseUrl !== savedActiveProfile.baseUrl
        || activeProfile.model !== savedActiveProfile.model
      );
      const response = await fetch('/api/admin/create-theatre', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
        },
        body: JSON.stringify({
          action: 'test_hermes_model',
          modelMode: activeMode,
          ...(hasUnsavedProfileChanges
            ? {
                hermesProfile: {
                  baseUrl: activeProfile.baseUrl,
                  model: activeProfile.model,
                  apiKey: activeProfile.apiKey,
                },
              }
            : {}),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '检测失败：' + response.status);
      if (!hasUnsavedProfileChanges) await load(token);
      setModelTest(payload.result as ModelTestResult);
      setMessage(payload.result?.available
        ? '模型可用，真实调用耗时 ' + (payload.result.completion?.durationMs ?? '—') + ' ms。'
        : '模型不可用：' + (payload.result?.completion?.error || '真实调用未通过'));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '检测失败');
    } finally {
      setTestingModel(false);
    }
  };

  const sendModelChat = async () => {
    const content = chatInput.trim();
    if (!content || chatting || !activeProfile.baseUrl || !activeProfile.model) return;
    const userMessage: ModelChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
    };
    const requestMessages = [...chatMessages, userMessage]
      .filter((message) => !message.error)
      .slice(-12)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    setChatMessages((current) => [...current, userMessage]);
    setChatInput('');
    setChatting(true);
    setMessage('正在与「' + activeOption.label + '」对话...');
    try {
      const response = await fetch('/api/admin/create-theatre', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
        },
        body: JSON.stringify({
          action: 'chat_hermes_model',
          modelMode: activeMode,
          hermesProfile: {
            baseUrl: activeProfile.baseUrl,
            model: activeProfile.model,
            apiKey: activeProfile.apiKey,
          },
          messages: requestMessages,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '对话失败：' + response.status);
      const result = payload.result as ModelChatResult;
      setChatMessages((current) => [...current, {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: result.content,
        model: result.model,
        durationMs: result.durationMs,
      }]);
      setMessage('模型已回复，耗时 ' + result.durationMs + ' ms。');
    } catch (error) {
      const errorText = error instanceof Error ? error.message : '模型对话失败';
      setChatMessages((current) => [...current, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: errorText,
        error: true,
      }]);
      setMessage(errorText);
    } finally {
      setChatting(false);
    }
  };

  const clearVoiceprints = async () => {
    if (!window.confirm('确定清空全部声纹档案吗？学生昵称和课堂记录会保留。')) return;
    setLoading(true);
    setMessage('正在清空声纹档案...');
    try {
      const response = await fetch('/api/admin/create-theatre', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
        },
        body: JSON.stringify({ action: 'clear_voiceprints' }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '清空失败：' + response.status);
      setMessage('已清空 ' + (payload.deletedVoiceprints ?? 0) + ' 条声纹档案。');
      await load(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '清空失败');
    } finally {
      setLoading(false);
    }
  };

  const deleteStudent = async (student: AdminStudent) => {
    if (!window.confirm('确定删除学生「' + student.nickname + '」吗？这会同时删除该学生的课堂会话、作品记录和声纹档案。')) return;
    setLoading(true);
    setMessage('正在删除学生「' + student.nickname + '」...');
    try {
      const response = await fetch('/api/admin/create-theatre', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'x-admin-token': token } : {}),
        },
        body: JSON.stringify({ action: 'delete_student', studentId: student.id }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '删除失败：' + response.status);
      setMessage('已删除学生「' + (payload.deletedStudent || student.nickname) + '」，同时删除 '
        + (payload.deletedSessions ?? 0) + ' 个会话、' + (payload.deletedVoiceprints ?? 0) + ' 条声纹。');
      await load(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.shell}>
      <section className={styles.topbar}>
        <div>
          <p className={styles.eyebrow}>AIYA CREATE THEATRE · ADMIN</p>
          <h1>创作课堂后台</h1>
          <p>管理老师展示、Hermes 模型连接、学生建档和声纹档案。模型密钥只在服务端加密保存，不会返回到浏览器。</p>
        </div>
        <div className={styles.tokenBox}>
          <label htmlFor="admin-token">管理员口令</label>
          <div className={styles.tokenRow}>
            <input
              id="admin-token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="CREATE_THEATRE_ADMIN_TOKEN"
              autoComplete="current-password"
            />
            <button className={styles.button} type="button" onClick={() => void load()} disabled={loading}>
              {loading ? '读取中' : '刷新'}
            </button>
          </div>
          <button className={styles.dangerButton} type="button" onClick={() => void clearVoiceprints()} disabled={loading}>
            清空声纹档案
          </button>
          <div className={styles.status} aria-live="polite">{message}</div>
        </div>
      </section>

      <section className={styles.configGrid}>
        <section className={styles.panelSoft}>
          <div className={styles.panelTitleRow}>
            <div>
              <p className={styles.eyebrow}>CLASSROOM CONFIG</p>
              <h2>老师与 Hermes</h2>
            </div>
            <div className={styles.teacherPreview}>
              <span>{settingsForm.teacher.avatar || '师'}</span>
              <strong>{settingsForm.teacher.name || 'AIYA老师'}</strong>
            </div>
          </div>

          <div className={styles.formGrid}>
            <label>
              老师名字
              <input
                value={settingsForm.teacher.name}
                onChange={(event) => setSettingsForm((current) => ({
                  ...current,
                  teacher: { ...current.teacher, name: event.target.value.slice(0, 24) },
                }))}
                placeholder="例如：小雅老师"
              />
            </label>
            <label>
              老师头像文字/emoji
              <input
                value={settingsForm.teacher.avatar}
                onChange={(event) => setSettingsForm((current) => ({
                  ...current,
                  teacher: { ...current.teacher, avatar: event.target.value.slice(0, 8) },
                }))}
                placeholder="例如：师、雅、🧑‍🏫"
              />
            </label>
          </div>

          <div className={styles.modelChoices}>
            {modelOptions.map((option) => {
              const profile = settingsForm.hermesProfiles[option.id];
              return (
                <button
                  key={option.id}
                  className={styles.modelChoice + (activeMode === option.id ? ' ' + styles.modelChoiceActive : '')}
                  type="button"
                  onClick={() => {
                    setSettingsForm((current) => ({ ...current, modelMode: option.id }));
                    setModelTest(null);
                    setChatMessages([]);
                    setChatInput('');
                  }}
                >
                  <span className={styles.modelChoiceTop}>
                    <strong>{option.label}</strong>
                    <i className={profile.baseUrl && profile.model ? styles.configuredDot : styles.unconfiguredDot} />
                  </span>
                  <span>{profile.model || '未配置模型'}</span>
                  <small>{profile.hasApiKey ? 'Key ' + profile.apiKeyMasked : option.note}</small>
                </button>
              );
            })}
          </div>

          {selectedRuntimeModel && (
            <section className={styles.runtimePanel}>
              <div className={styles.runtimeHeader}>
                <div>
                  <p className={styles.eyebrow}>SELECTED RUNTIME</p>
                  <h3>所选配置槽实际参数</h3>
                </div>
                <span className={styles.runtimeSource}>
                  {selectedRuntimeModel.source === 'admin-profile' ? '后台配置' : '环境变量回退'}
                </span>
              </div>
              <dl className={styles.runtimeGrid}>
                <div><dt>配置槽</dt><dd>{activeOption.label}</dd></div>
                <div><dt>模型名称</dt><dd>{selectedRuntimeModel.model || '未配置'}</dd></div>
                <div className={styles.runtimeWide}><dt>API URL</dt><dd>{selectedRuntimeModel.baseUrl || '未配置'}</dd></div>
                <div className={styles.runtimeWide}><dt>API Key</dt><dd>{selectedRuntimeModel.hasApiKey ? selectedRuntimeModel.apiKeyMasked : '未配置'}</dd></div>
                <div><dt>接口 / 提供方</dt><dd>{selectedRuntimeModel.apiType} / {selectedRuntimeModel.provider}</dd></div>
                <div><dt>超时</dt><dd>{selectedRuntimeModel.timeoutMs} ms</dd></div>
                <div><dt>最大 Token</dt><dd>{selectedRuntimeModel.maxTokens}</dd></div>
                <div><dt>最大轮次</dt><dd>{selectedRuntimeModel.maxTurns}</dd></div>
                <div><dt>JSON 模式</dt><dd>{selectedRuntimeModel.jsonMode ? '开启' : '关闭'}</dd></div>
                <div><dt>Thinking</dt><dd>{selectedRuntimeModel.thinkingMode || '默认'}</dd></div>
              </dl>
              {selectedRuntimeModel.source === 'environment' && (
                <p className={styles.runtimeHint}>当前“{activeOption.label}”来自服务器环境变量回退；保存后将迁移为后台加密配置。</p>
              )}
            </section>
          )}

          <section className={styles.hermesEditor}>
            <div className={styles.hermesEditorHeader}>
              <div>
                <p className={styles.eyebrow}>ACTIVE CONNECTION</p>
                <h3>{activeOption.label}</h3>
              </div>
              <span className={styles.connectionBadge
                + (modelTest?.available ? ' ' + styles.connectionBadgeOk : modelTest ? ' ' + styles.connectionBadgeFail : '')}>
                {testingModel ? '检测中' : modelTest?.available ? '模型可用' : modelTest ? '模型不可用' : '未检测'}
              </span>
            </div>

            <div className={styles.connectionFields}>
              <label>
                Hermes URL
                <input
                  value={activeProfile.baseUrl}
                  onChange={(event) => updateActiveProfile({ baseUrl: event.target.value.slice(0, 500) })}
                  placeholder="https://api.example.com 或 http://127.0.0.1:4000"
                  autoComplete="url"
                />
              </label>
              <label>
                模型名称
                <input
                  value={activeProfile.model}
                  onChange={(event) => updateActiveProfile({ model: event.target.value.slice(0, 200) })}
                  placeholder="例如：deepseek-chat、gpt-4.1"
                />
              </label>
              <label className={styles.keyField}>
                API Key
                <input
                  type="password"
                  value={activeProfile.apiKey}
                  onChange={(event) => updateActiveProfile({
                    apiKey: event.target.value.slice(0, 1000),
                    clearApiKey: false,
                  })}
                  placeholder={activeProfile.hasApiKey
                    ? '已保存 ' + activeProfile.apiKeyMasked + '，留空不修改'
                    : '输入 API Key；本地无鉴权服务可留空'}
                  autoComplete="new-password"
                />
              </label>
            </div>

            <div className={styles.keyMeta}>
              <span>
                {activeProfile.clearApiKey
                  ? '保存后将清除当前 Key'
                  : activeProfile.hasApiKey
                    ? '服务端已保存：' + activeProfile.apiKeyMasked
                    : '尚未保存 API Key'}
              </span>
              {(activeProfile.hasApiKey || activeProfile.clearApiKey) && (
                <button
                  type="button"
                  onClick={() => updateActiveProfile({
                    apiKey: '',
                    clearApiKey: !activeProfile.clearApiKey,
                  })}
                >
                  {activeProfile.clearApiKey ? '取消清除' : '清除已保存 Key'}
                </button>
              )}
            </div>

            <section className={styles.modelChat}>
              <div className={styles.modelChatHeader}>
                <div>
                  <p className={styles.eyebrow}>MODEL CHAT</p>
                  <h4>模型对话测试</h4>
                  <span>直接使用当前表单中的 URL、模型和 Key，不会修改课堂配置。</span>
                </div>
                {chatMessages.length > 0 && (
                  <button
                    className={styles.chatClear}
                    type="button"
                    onClick={() => { setChatMessages([]); setChatInput(''); }}
                    disabled={chatting}
                  >
                    清空对话
                  </button>
                )}
              </div>

              <div className={styles.chatTranscript} aria-live="polite">
                {chatMessages.length === 0 ? (
                  <div className={styles.chatEmpty}>
                    <strong>对话窗口已就绪</strong>
                    <span>输入一个问题，可以直观检查模型的回答质量和延迟。</span>
                  </div>
                ) : chatMessages.map((chatMessage) => (
                  <article
                    className={styles.chatMessage
                      + (chatMessage.role === 'user' ? ' ' + styles.chatMessageUser : ' ' + styles.chatMessageAssistant)
                      + (chatMessage.error ? ' ' + styles.chatMessageError : '')}
                    key={chatMessage.id}
                  >
                    <div className={styles.chatMessageMeta}>
                      <strong>{chatMessage.role === 'user' ? '我' : '模型'}</strong>
                      {chatMessage.durationMs !== undefined && <span>{chatMessage.durationMs} ms · {chatMessage.model}</span>}
                    </div>
                    <p>{chatMessage.content}</p>
                  </article>
                ))}
                {chatting && <div className={styles.chatTyping}>模型正在回复...</div>}
              </div>

              <div className={styles.chatComposer}>
                <textarea
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value.slice(0, 4000))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void sendModelChat();
                    }
                  }}
                  placeholder="输入问题，Enter 发送，Shift + Enter 换行"
                  disabled={chatting || !activeProfile.baseUrl || !activeProfile.model}
                  rows={3}
                />
                <button
                  className={styles.buttonPrimary}
                  type="button"
                  onClick={() => void sendModelChat()}
                  disabled={chatting || !chatInput.trim() || !activeProfile.baseUrl || !activeProfile.model}
                >
                  {chatting ? '回复中' : '发送'}
                </button>
              </div>
            </section>

            <div className={styles.operationGate}>
              <label>
                修改操作密码
                <input
                  type="password"
                  value={operationPassword}
                  onChange={(event) => setOperationPassword(event.target.value.slice(0, 64))}
                  placeholder="请输入操作密码后保存"
                  autoComplete="off"
                />
              </label>
              <span>检测不需要操作密码；保存、切换生效配置或清除 Key 时必须验证。</span>
            </div>

            <div className={styles.configActions}>
              <span>保存会将「{activeOption.label}」设为课堂当前模型；空 Key 会保留原 Key。</span>
              <div className={styles.actionGroup}>
                <button
                  className={styles.button}
                  type="button"
                  onClick={() => void testModel()}
                  disabled={testingModel || loading || !activeProfile.baseUrl || !activeProfile.model}
                >
                  {testingModel ? '正在检测' : '检测模型'}
                </button>
                <button
                  className={styles.buttonPrimary}
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={savingSettings || loading || !activeProfile.baseUrl || !activeProfile.model || !operationPassword}
                >
                  {savingSettings ? '保存中' : '保存并启用'}
                </button>
              </div>
            </div>

            {modelTest && (
              <section className={styles.testResult + ' '
                + (modelTest.available ? styles.testResultOk : styles.testResultFail)}>
                <div className={styles.testResultSummary}>
                  <strong>{modelTest.available ? '连接成功，模型可以生成内容' : '连接失败，模型暂不可用'}</strong>
                  <span>{modelTest.totalDurationMs} ms · {formatTime(modelTest.testedAt)}</span>
                </div>
                <div className={styles.testChecks}>
                  <div>
                    <span>模型发现</span>
                    <strong>{modelTest.discovery.ok
                      ? modelTest.discovery.modelFound
                        ? '已找到目标模型'
                        : '已连接，未发现目标模型（共 ' + (modelTest.discovery.modelCount ?? 0) + ' 个）'
                      : '接口不支持或连接失败'}</strong>
                    <small>HTTP {modelTest.discovery.status ?? '—'} · {modelTest.discovery.durationMs} ms</small>
                    {modelTest.discovery.error && <code>{modelTest.discovery.error}</code>}
                  </div>
                  <div>
                    <span>真实生成</span>
                    <strong>{modelTest.completion.ok ? '通过' : '失败'}</strong>
                    <small>HTTP {modelTest.completion.status ?? '—'} · {modelTest.completion.durationMs} ms</small>
                    <code>{modelTest.completion.responsePreview || modelTest.completion.error || '无响应内容'}</code>
                  </div>
                </div>
              </section>
            )}
          </section>
        </section>

        <section className={styles.kpis}>
          <div className={styles.kpi}>
            <span>当前模型</span>
            <strong className={styles.kpiText}>{savedSettings.hermesProfiles[savedSettings.modelMode].model || '未配置'}</strong>
          </div>
          <div className={styles.kpi}>
            <span>学生档案</span>
            <strong>{data?.kpis?.studentCount ?? '—'}</strong>
          </div>
          <div className={styles.kpi}>
            <span>课堂会话</span>
            <strong>{data?.kpis?.sessionCount ?? '—'}</strong>
          </div>
          <div className={styles.kpi}>
            <span>生成任务</span>
            <strong>{data?.kpis?.taskCount ?? '—'}</strong>
          </div>
          <div className={styles.kpi}>
            <span>失败任务</span>
            <strong className={styles.kpiDanger}>{data?.kpis?.failedTaskCount ?? '—'}</strong>
          </div>
        </section>
      </section>

      <section className={styles.taskPanel}>
        <div className={styles.taskHeader}>
          <div>
            <span className={styles.eyebrow}>任务审计</span>
            <h2>每个用户的每一次任务</h2>
            <p>保留请求、用户与设备、模型、耗时、生成结果及完整失败诊断。默认显示最近 500 条。</p>
          </div>
          <button className={styles.buttonSecondary} type="button" onClick={() => void load()} disabled={loading}>
            刷新任务
          </button>
        </div>

        <div className={styles.taskFilters}>
          <input
            className={styles.taskSearch}
            value={taskSearch}
            onChange={(event) => setTaskSearch(event.target.value)}
            placeholder="搜索用户、设备、需求、任务 ID 或模型"
          />
          <div className={styles.taskStatusFilters}>
            {[
              ['all', '全部'],
              ['failed', '只看失败'],
              ['started', '进行中'],
              ['succeeded', '成功'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={styles.taskFilterButton + (taskStatus === value ? ' ' + styles.taskFilterButtonActive : '')}
                onClick={() => setTaskStatus(value)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={styles.buttonSecondary}
              onClick={() => void loadTaskPage(true)}
              disabled={loadingTasks}
            >
              {loadingTasks ? '查询中' : '查询全部历史'}
            </button>
          </div>
        </div>

        <div className={styles.taskSummary}>
          <span>当前显示 <strong>{visibleTasks.length}</strong> 条</span>
          <span>成功 {data?.kpis?.succeededTaskCount ?? 0}</span>
          <span>进行中 {data?.kpis?.runningTaskCount ?? 0}</span>
          <span className={styles.taskSummaryDanger}>失败 {data?.kpis?.failedTaskCount ?? 0}</span>
        </div>

        {visibleTasks.length === 0 ? (
          <div className={styles.empty}>暂无匹配任务。新版本客户端提交任务后会自动出现在这里。</div>
        ) : (
          <div className={styles.taskList}>
            {visibleTasks.map((task) => {
              const expanded = expandedTaskId === task.id;
              const detail = taskDetails[task.id] || task;
              const statusClass = task.status === 'failed'
                ? styles.taskFailed
                : task.status === 'succeeded'
                  ? styles.taskSucceeded
                  : styles.taskRunning;
              const showcaseEnabled = valueRecord(valueRecord(detail.result).showcase).enabled === true;
              return (
                <article className={styles.taskItem + ' ' + statusClass} key={task.id}>
                  <div className={styles.taskTopLine}>
                    <span className={styles.taskStatus}>{taskStatusLabel(task.status)}</span>
                    <strong>{task.userName || '匿名用户'}</strong>
                    <span>{task.source || 'unknown'}</span>
                    <time>{formatTime(task.startedAt)}</time>
                  </div>
                  <div className={styles.taskIdea}>{task.idea || '未记录需求内容'}</div>
                  <div className={styles.taskMeta}>
                    <span>模型：{task.model || '未进入模型阶段'}</span>
                    <span>阶段：{task.stage || '—'}</span>
                    <span>耗时：{formatDuration(task.durationMs)}</span>
                    <span>HTTP：{task.httpStatus ?? '—'}</span>
                    <span>设备：{task.deviceId || '未提供'}</span>
                  </div>
                  {task.status === 'failed' && (
                    <div className={styles.taskErrorPreview}>{prettyJson(task.error).slice(0, 800)}</div>
                  )}
                  <div className={styles.taskActions}>
                    <code>{task.diagnosticId}</code>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(task.diagnosticId)}
                    >
                      复制诊断 ID
                    </button>
                    <button type="button" onClick={() => void toggleTaskDetails(task)} disabled={loadingTaskId === task.id}>
                      {loadingTaskId === task.id ? '读取中' : expanded ? '收起完整信息' : '查看完整信息'}
                    </button>
                  </div>
                  {expanded && (
                    <div className={styles.taskDetails}>
                      <div className={styles.taskDetailToolbar}>
                        <div>
                          <strong>完整任务档案</strong>
                          <span>请求、模型切换、生成校验、结果与服务端诊断均保留</span>
                        </div>
                        {detail.status === 'succeeded' && (
                          <button
                            type="button"
                            onClick={() => void setTaskShowcase(detail, !showcaseEnabled)}
                            disabled={showcaseTaskId === detail.id}
                          >
                            {showcaseTaskId === detail.id
                              ? '保存中'
                              : showcaseEnabled
                                ? '取消优秀作品展示'
                                : '设为优秀作品展示'}
                          </button>
                        )}
                        <button type="button" onClick={() => void copyTaskRecord(detail)}>复制完整 JSON</button>
                        <button type="button" onClick={() => downloadTaskRecord(detail)}>下载任务档案</button>
                      </div>
                      <dl className={styles.taskIdentityGrid}>
                        <div><dt>用户键</dt><dd>{detail.userKey}</dd></div>
                        <div><dt>学生 ID</dt><dd>{detail.studentId || '—'}</dd></div>
                        <div><dt>客户端任务 ID</dt><dd>{detail.clientTaskId || '—'}</dd></div>
                        <div><dt>交互 ID</dt><dd>{detail.interactionId || '—'}</dd></div>
                        <div><dt>会话 ID</dt><dd>{detail.sessionId || '—'}</dd></div>
                        <div><dt>应用</dt><dd>{detail.appId || '—'} {detail.appVersion || ''}</dd></div>
                        <div><dt>模型配置</dt><dd>{detail.modelMode || '—'} / {detail.model || '—'}</dd></div>
                        <div><dt>Provider / API</dt><dd>{detail.provider || '—'} / {detail.apiType || '—'}</dd></div>
                        <div><dt>开始时间</dt><dd>{formatTime(detail.startedAt)}</dd></div>
                        <div><dt>结束时间</dt><dd>{formatTime(detail.finishedAt || undefined)}</dd></div>
                        <div><dt>总耗时</dt><dd>{formatDuration(detail.durationMs)}</dd></div>
                      </dl>

                      <section className={styles.taskConversationPanel}>
                        <div className={styles.taskProcessHeader}>
                          <div>
                            <span>USER ↔ TEACHER</span>
                            <h3>用户与老师的交互过程</h3>
                          </div>
                          <strong>{detail.conversation?.length || 0} 条可读消息</strong>
                        </div>
                        {detail.conversation?.length ? (
                          <div className={styles.taskConversation}>
                            {detail.conversation.map((entry) => {
                              const isUser = entry.role === 'user';
                              const isTeacher = entry.role === 'teacher';
                              const roleLabel = isUser ? (detail.userName || '用户') : isTeacher ? settingsForm.teacher.name : '系统记录';
                              return (
                                <article
                                  className={`${styles.taskMessageRow} ${
                                    isUser
                                      ? styles.taskMessageUser
                                      : isTeacher
                                        ? styles.taskMessageTeacher
                                        : styles.taskMessageSystem
                                  }`}
                                  key={entry.id}
                                >
                                  <div className={styles.taskMessageAvatar}>
                                    {isUser
                                      ? (detail.userName || '用户').slice(0, 1)
                                      : isTeacher
                                        ? settingsForm.teacher.avatar.slice(0, 2)
                                        : '记'}
                                  </div>
                                  <div className={styles.taskMessageContent}>
                                    <div className={styles.taskMessageMeta}>
                                      <strong>{roleLabel}</strong>
                                      <span>{entry.phase}</span>
                                      <time>{formatTime(entry.at || undefined)}</time>
                                    </div>
                                    <p>{entry.text}</p>
                                    <details>
                                      <summary>查看这条交互的来源</summary>
                                      <pre>{prettyJson({ source: entry.source, phase: entry.phase, detail: entry.detail })}</pre>
                                    </details>
                                  </div>
                                </article>
                              );
                            })}
                          </div>
                        ) : (
                          <div className={styles.taskProcessEmpty}>这条旧任务没有可恢复的对话文本，仍可查看下方请求与诊断原文。</div>
                        )}
                      </section>

                      <section className={styles.taskProcessPanel}>
                        <div className={styles.taskProcessHeader}>
                          <div>
                            <span>PROCESS TRACE</span>
                            <h3>任务全过程</h3>
                          </div>
                          <strong>{detail.process?.timeline?.length || 0} 个关键节点</strong>
                        </div>
                        {detail.process?.timeline?.length ? (
                          <div className={styles.taskTimeline}>
                            {detail.process.timeline.map((event, index) => (
                              <article className={styles.taskTimelineItem} key={event.id || `${event.stage}-${index}`}>
                                <div className={`${styles.taskTimelineDot} ${
                                  event.status === 'failed'
                                    ? styles.taskTimelineDotFailed
                                    : event.status === 'started'
                                      ? styles.taskTimelineDotRunning
                                      : styles.taskTimelineDotSucceeded
                                }`}>{index + 1}</div>
                                <div className={styles.taskTimelineBody}>
                                  <div className={styles.taskTimelineMeta}>
                                    <strong>{event.title}</strong>
                                    <span>{processStatusLabel(event.status)}</span>
                                    <time>{formatTime(event.at || undefined)}</time>
                                  </div>
                                  {event.summary && <p>{event.summary}</p>}
                                  <details>
                                    <summary>查看本阶段原始数据</summary>
                                    <pre>{prettyJson(event.detail)}</pre>
                                  </details>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.taskProcessEmpty}>旧任务暂无结构化节点，原始记录仍可在下方完整查看。</div>
                        )}
                      </section>

                      {!!detail.process?.modelFailover?.length && (
                        <section className={styles.taskFailoverPanel}>
                          <div className={styles.taskProcessHeader}>
                            <div><span>MODEL ROUTING</span><h3>模型配置调用与切换</h3></div>
                            <strong>{detail.process.modelFailover.length} 次调用</strong>
                          </div>
                          <div className={styles.taskFailoverGrid}>
                            {detail.process.modelFailover.map((entry, index) => {
                              const item = valueRecord(entry);
                              const status = String(item.status || 'unknown');
                              const error = valueRecord(item.error);
                              return (
                                <article className={`${styles.taskFailoverCard} ${status === 'failed' ? styles.taskFailoverFailed : styles.taskFailoverSucceeded}`} key={`${String(item.configFingerprint || '')}-${index}`}>
                                  <div><span>#{Number(item.sequence) || index + 1}</span><strong>{processStatusLabel(status)}</strong></div>
                                  <h4>{String(item.model || '未记录模型')}</h4>
                                  <p>{String(item.mode || 'unknown')} · {String(item.provider || 'unknown')} · {String(item.apiType || 'unknown')}</p>
                                  <small>耗时 {formatDuration(typeof item.durationMs === 'number' ? item.durationMs : null)}</small>
                                  {status === 'failed' && <pre>{String(error.message || prettyJson(item.error))}</pre>}
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      )}

                      {[
                        ['请求信息', detail.request],
                        ['原作品快照', detail.currentApp],
                        ['生成结果（包含完整 HTML）', detail.result],
                        ['失败诊断', detail.error],
                        ['模型与生成尝试原始记录', detail.attempts],
                        ['交互事件原始记录', detail.interactionEvents],
                        ['服务端诊断事件', detail.diagnosticEvents],
                        ['完整任务记录', detail],
                      ].map(([label, value]) => (
                        <details className={styles.taskDetailBlock} key={String(label)} open={String(label) === '失败诊断' && detail.status === 'failed'}>
                          <summary>{String(label)}</summary>
                          <pre>{prettyJson(value)}</pre>
                        </details>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
            {data?.taskPage?.hasMore && (
              <button
                className={styles.taskLoadMore}
                type="button"
                onClick={() => void loadTaskPage(false)}
                disabled={loadingTasks}
              >
                {loadingTasks ? '加载中' : `加载更多（共 ${data.taskPage.filteredTotal} 条）`}
              </button>
            )}
          </div>
        )}
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <span>学生</span><span>声纹</span><span>会话</span><span>作品</span><span>最后更新</span><span>操作</span>
        </div>
        {students.length === 0 ? (
          <div className={styles.empty}>暂无数据，或尚未通过管理员验证。</div>
        ) : students.map((student) => (
          <article className={styles.student} key={student.id}>
            <div><strong>{student.nickname}</strong><span className={styles.muted}>{student.id}</span></div>
            <div>
              <span className={styles.pill + (student.voiceprint ? '' : ' ' + styles.pillOff)}>
                {student.voiceprint ? '已录入 · ' + (student.voiceprint.sampleCount || 1) + ' 次' : '未录入'}
              </span>
            </div>
            <div><strong>{student.latestSession?.messageCount ?? 0}</strong><span className={styles.muted}>条消息</span></div>
            <div>
              <span className={styles.pill + (student.latestSession?.hasCurrentApp ? '' : ' ' + styles.pillOff)}>
                {student.latestSession?.hasCurrentApp ? '有作品' : '暂无作品'}
              </span>
            </div>
            <div className={styles.muted}>{formatTime(student.latestSession?.updatedAt || student.updatedAt)}</div>
            <div>
              <button className={styles.deleteStudentButton} type="button" onClick={() => void deleteStudent(student)} disabled={loading}>
                删除学生
              </button>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
