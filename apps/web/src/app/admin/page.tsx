'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AiyaApiError,
  buildApiClient,
  clearAuthSession,
  getStoredAccessToken,
  getStoredPrincipal,
  persistAuthSession,
} from '../../lib/api-client';
import { useAppQueryClient } from '../providers';

type AdminTab = 'overview' | 'principals' | 'conversations' | 'risk' | 'system';

type AdminPrincipal = {
  id: string;
  type: 'human' | 'agent';
  handle: string;
  displayName: string;
  presence?: string;
  trustScore?: number;
  isSuspended?: boolean;
  isDiscoverable?: boolean;
  createdAt?: string;
  humanProfile?: {
    phone?: string | null;
    email?: string | null;
    locale?: string;
    isPhoneVerified?: boolean;
    isEmailVerified?: boolean;
    lastLoginAt?: string | null;
  } | null;
  agentProfile?: {
    modelProvider?: string;
    modelName?: string;
    isActive?: boolean;
    publishStatus?: string;
    version?: string;
  } | null;
};

type AdminMessage = {
  id: string;
  type?: string;
  snippet?: string;
  moderationStatus?: string;
  createdAt?: string;
  sender?: AdminPrincipal | null;
  conversation?: {
    id: string;
    title?: string | null;
    type?: string;
  } | null;
};

type AdminConversation = {
  id: string;
  type: string;
  title?: string | null;
  isArchived?: boolean;
  isFrozen?: boolean;
  lastMessageAt?: string | null;
  updatedAt?: string;
  counts?: {
    members: number;
    messages: number;
    approvalRequests: number;
    moderationCases: number;
  } | null;
  members?: Array<{
    principalId: string;
    role: string;
    unreadCount?: number;
    principal?: AdminPrincipal | null;
  }>;
  lastMessage?: AdminMessage | null;
};

type AdminOverview = {
  generatedAt: string;
  kpis: {
    totalPrincipals: number;
    humanPrincipals: number;
    agentPrincipals: number;
    totalConversations: number;
    totalMessages: number;
    activeSessions24h: number;
  };
  risk: {
    pendingApprovals: number;
    openModerationCases: number;
    suspendedPrincipals: number;
    frozenConversations: number;
  };
  recentMessages: AdminMessage[];
};

type AdminRisk = {
  moderationCases: Array<{
    id: string;
    targetType: string;
    status: string;
    reasonCode: string;
    source: string;
    notes?: string;
    createdAt?: string;
    principal?: AdminPrincipal | null;
    conversation?: { id: string; title?: string | null; type?: string; isFrozen?: boolean } | null;
    message?: { id: string; snippet?: string; moderationStatus?: string; createdAt?: string } | null;
  }>;
  approvalRequests: Array<{
    id: string;
    summary: string;
    status: string;
    expiresAt?: string | null;
    createdAt?: string;
    agent?: AdminPrincipal | null;
    human?: AdminPrincipal | null;
    capability?: { name: string; slug: string; riskLevel: string } | null;
  }>;
};

type AdminSystem = {
  generatedAt: string;
  service: string;
  env: string;
  database: string;
  admin: {
    configured: boolean;
    handleRules: number;
    principalIdRules: number;
  };
  capabilities: Record<string, string>;
};

type AuditEvent = {
  id: string;
  eventType: string;
  actorType: string;
  targetTable?: string | null;
  targetId?: string | null;
  createdAt?: string;
  actorPrincipal?: AdminPrincipal | null;
  targetPrincipal?: AdminPrincipal | null;
};

const tabs: Array<{ id: AdminTab; label: string; caption: string }> = [
  { id: 'overview', label: '总览', caption: '运营健康与风险水位' },
  { id: 'principals', label: '用户与 Agent', caption: '主体目录与准入状态' },
  { id: 'conversations', label: '会话', caption: '群组、私聊与消息活跃' },
  { id: 'risk', label: '风控', caption: '审批、审核与异常内容' },
  { id: 'system', label: '系统', caption: '服务状态、审计与扩展能力' },
];

const numberFormatter = new Intl.NumberFormat('zh-CN');

const formatNumber = (value?: number) => numberFormatter.format(value ?? 0);

const formatTime = (value?: string | null) => {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const friendlyAdminError = (error: unknown) => {
  if (error instanceof AiyaApiError) {
    if (error.status === 401) return '登录状态已失效，请重新登录。';
    if (error.status === 403) return '当前账号没有管理后台权限，请使用已配置的管理员账号。';
    if (error.status >= 500) return '管理服务暂时不可用，请稍后重试。';
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return '请求失败，请稍后重试。';
};

const statusTone = (status?: string) => {
  if (!status) return 'neutral';
  if (['online', 'active', 'ok', 'clean', 'approved', 'success'].includes(status)) return 'success';
  if (['pending', 'busy', 'needs_review', 'flagged', 'draft', 'medium'].includes(status)) return 'warning';
  if (['blocked', 'suspended', 'rejected', 'failure', 'degraded', 'high'].includes(status)) return 'danger';
  return 'neutral';
};

const makeDeviceId = () => {
  if (typeof window === 'undefined') return 'admin-web';
  const existing = window.localStorage.getItem('aiya_admin_device_id');
  if (existing) return existing;
  const created = `admin-web-${crypto.randomUUID()}`;
  window.localStorage.setItem('aiya_admin_device_id', created);
  return created;
};

function StatusPill({ label, tone }: { label?: string | number | null; tone?: string }) {
  return <span className={`adminPill ${tone || statusTone(String(label || ''))}`}>{label ?? '—'}</span>;
}

function MetricCard({
  label,
  value,
  meta,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  meta: string;
  tone?: 'default' | 'good' | 'warn' | 'danger';
}) {
  return (
    <article className={`adminMetric ${tone}`}>
      <span className="adminMetricLabel">{label}</span>
      <strong className="adminMetricValue">{typeof value === 'number' ? formatNumber(value) : value}</strong>
      <span className="adminMetricMeta">{meta}</span>
    </article>
  );
}

function EntityCell({ principal }: { principal?: AdminPrincipal | null }) {
  if (!principal) return <span className="adminMuted">未知主体</span>;
  return (
    <div className="adminEntity">
      <span className="adminAvatar">{principal.displayName?.[0] || principal.handle?.[0] || 'A'}</span>
      <span>
        <strong>{principal.displayName || principal.handle}</strong>
        <small>{principal.type} · @{principal.handle}</small>
      </span>
    </div>
  );
}

function EmptyState({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="adminEmpty">
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

export default function AdminPage() {
  const queryClient = useAppQueryClient();
  const api = useMemo(() => buildApiClient(), []);
  const [mounted, setMounted] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [principal, setPrincipal] = useState<AdminPrincipal | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [principalSearch, setPrincipalSearch] = useState('');
  const [principalSearchInput, setPrincipalSearchInput] = useState('');
  const [principalType, setPrincipalType] = useState('all');

  useEffect(() => {
    setAccessToken(getStoredAccessToken());
    setPrincipal(getStoredPrincipal());
    setMounted(true);
  }, []);

  const isAuthed = mounted && Boolean(accessToken);
  const deviceId = useMemo(() => makeDeviceId(), []);

  const overviewQuery = useQuery({
    queryKey: ['admin', 'overview', accessToken],
    queryFn: async () => (await api.getAdminOverview()).data as AdminOverview,
    enabled: isAuthed,
    retry: false,
  });

  const principalsQuery = useQuery({
    queryKey: ['admin', 'principals', accessToken, principalSearch, principalType],
    queryFn: async () => (await api.getAdminPrincipals({
      q: principalSearch,
      type: principalType === 'all' ? undefined : principalType,
      limit: 50,
    })).data as { items: AdminPrincipal[] },
    enabled: isAuthed,
    retry: false,
  });

  const conversationsQuery = useQuery({
    queryKey: ['admin', 'conversations', accessToken],
    queryFn: async () => (await api.getAdminConversations({ limit: 40 })).data as { items: AdminConversation[] },
    enabled: isAuthed,
    retry: false,
  });

  const riskQuery = useQuery({
    queryKey: ['admin', 'risk', accessToken],
    queryFn: async () => (await api.getAdminRisk({ limit: 30 })).data as AdminRisk,
    enabled: isAuthed,
    retry: false,
  });

  const auditQuery = useQuery({
    queryKey: ['admin', 'audit', accessToken],
    queryFn: async () => (await api.getAdminAuditEvents({ limit: 30 })).data as { items: AuditEvent[] },
    enabled: isAuthed,
    retry: false,
  });

  const systemQuery = useQuery({
    queryKey: ['admin', 'system', accessToken],
    queryFn: async () => (await api.getAdminSystem()).data as AdminSystem,
    enabled: isAuthed,
    retry: false,
  });

  const allErrors = [
    overviewQuery.error,
    principalsQuery.error,
    conversationsQuery.error,
    riskQuery.error,
    auditQuery.error,
    systemQuery.error,
  ].filter(Boolean);
  const accessError = allErrors.find((error) => error instanceof AiyaApiError && [401, 403].includes(error.status));

  const handleLogout = () => {
    void api.logout().catch(() => clearAuthSession());
    queryClient.clear();
    setAccessToken('');
    setPrincipal(null);
    setPassword('');
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanIdentifier = identifier.trim();
    if (!cleanIdentifier || !password || loginLoading) return;

    setLoginLoading(true);
    setLoginError('');
    try {
      const result = await api.login(cleanIdentifier.includes('@')
        ? { email: cleanIdentifier, password, deviceId, platform: 'web' }
        : { phone: cleanIdentifier, password, deviceId, platform: 'web' });
      persistAuthSession(result);
      setAccessToken(result.accessToken);
      setPrincipal(result.principal as AdminPrincipal);
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    } catch (error) {
      setLoginError(friendlyAdminError(error));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin'] });
  };

  const handlePrincipalSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPrincipalSearch(principalSearchInput.trim());
  };

  const overview = overviewQuery.data;
  const system = systemQuery.data;
  const loading = !mounted || (isAuthed && overviewQuery.isLoading && !overview);

  if (!isAuthed) {
    return (
      <main className="adminShell adminLoginShell">
        <section className="adminLoginCard">
          <a className="adminBackLink" href="/">← 返回 Aiya 工作台</a>
          <span className="adminBrandKicker">AIYA CONTROL</span>
          <h1>商用管理后台</h1>
          <p>
            后台使用服务端管理员白名单校验。请使用已授权账号登录，后续可扩展为 RBAC、租户与计费权限模型。
          </p>
          <form onSubmit={handleLogin} className="adminLoginForm">
            <label>
              管理员账号
              <input
                className="adminInput"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                placeholder="手机号或邮箱"
                autoComplete="username"
              />
            </label>
            <label>
              密码
              <input
                className="adminInput"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="请输入密码"
                type="password"
                autoComplete="current-password"
              />
            </label>
            {loginError && <div className="adminInlineError">{loginError}</div>}
            <button className="adminButton primary" type="submit" disabled={loginLoading || !identifier.trim() || !password}>
              {loginLoading ? '正在验证…' : '进入管理后台'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="adminShell">
      <header className="adminTopbar">
        <div>
          <a className="adminBackLink" href="/">← 返回工作台</a>
          <span className="adminBrandKicker">AIYA CONTROL</span>
          <h1>商用管理后台</h1>
          <p>面向上线运营的主体、会话、风控与系统观测入口。当前版本默认只读，避免误操作生产数据。</p>
        </div>
        <div className="adminIdentityCard">
          <EntityCell principal={principal} />
          <div className="adminIdentityActions">
            <button className="adminButton ghost" type="button" onClick={handleRefresh}>刷新</button>
            <button className="adminButton dangerGhost" type="button" onClick={handleLogout}>退出</button>
          </div>
        </div>
      </header>

      <div className="adminMainGrid">
        <aside className="adminRail">
          <nav className="adminNav" aria-label="管理后台导航">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                className={`adminTab ${activeTab === tab.id ? 'active' : ''}`}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                <strong>{tab.label}</strong>
                <span>{tab.caption}</span>
              </button>
            ))}
          </nav>
          <section className="adminRailCard">
            <span className="adminMuted">权限策略</span>
            <strong>{system?.admin.configured ? '管理员白名单已启用' : '管理员白名单未配置'}</strong>
            <p>生产环境必须由 API 服务端校验，前端仅负责展示。</p>
          </section>
        </aside>

        <section className="adminWorkspace">
          {loading && <EmptyState title="正在加载管理数据" copy="正在读取生产 API 的运营指标与系统状态。" />}

          {accessError && (
            <section className="adminPanel adminAccessPanel">
              <h2>无法进入管理后台</h2>
              <p>{friendlyAdminError(accessError)}</p>
              <div className="adminActions">
                <button className="adminButton primary" type="button" onClick={handleLogout}>重新登录</button>
                <a className="adminButton ghost" href="/">返回工作台</a>
              </div>
            </section>
          )}

          {!accessError && activeTab === 'overview' && overview && (
            <>
              <section className="adminHero">
                <div>
                  <span className="adminBrandKicker">OPERATIONS OVERVIEW</span>
                  <h2>实时运营总览</h2>
                  <p>最近生成时间：{formatTime(overview.generatedAt)}。优先关注风控水位、会话活跃与系统健康。</p>
                </div>
                <StatusPill label={system?.database === 'ok' ? '数据库正常' : '数据库异常'} tone={system?.database === 'ok' ? 'success' : 'danger'} />
              </section>

              <div className="adminKpiGrid">
                <MetricCard label="总主体数" value={overview.kpis.totalPrincipals} meta={`${formatNumber(overview.kpis.humanPrincipals)} 人类 · ${formatNumber(overview.kpis.agentPrincipals)} Agent`} />
                <MetricCard label="会话数" value={overview.kpis.totalConversations} meta="未归档会话" />
                <MetricCard label="消息数" value={overview.kpis.totalMessages} meta="未删除消息" />
                <MetricCard label="24h 活跃会话端" value={overview.kpis.activeSessions24h} meta="未撤销在线设备" tone="good" />
                <MetricCard label="待审批" value={overview.risk.pendingApprovals} meta="Agent 操作审批" tone={overview.risk.pendingApprovals ? 'warn' : 'good'} />
                <MetricCard label="待处理风控" value={overview.risk.openModerationCases} meta="审核、封禁或需复核" tone={overview.risk.openModerationCases ? 'danger' : 'good'} />
              </div>

              <div className="adminGridTwo">
                <section className="adminPanel">
                  <div className="adminPanelHeader">
                    <div>
                      <span className="adminBrandKicker">RISK WATERLINE</span>
                      <h3>风险水位</h3>
                    </div>
                    <button className="adminButton ghost" type="button" onClick={() => setActiveTab('risk')}>查看风控</button>
                  </div>
                  <div className="adminStatusRows">
                    <div><span>待审批请求</span><StatusPill label={overview.risk.pendingApprovals} tone={overview.risk.pendingApprovals ? 'warning' : 'success'} /></div>
                    <div><span>开放审核案件</span><StatusPill label={overview.risk.openModerationCases} tone={overview.risk.openModerationCases ? 'danger' : 'success'} /></div>
                    <div><span>冻结会话</span><StatusPill label={overview.risk.frozenConversations} tone={overview.risk.frozenConversations ? 'warning' : 'success'} /></div>
                    <div><span>停权主体</span><StatusPill label={overview.risk.suspendedPrincipals} tone={overview.risk.suspendedPrincipals ? 'danger' : 'success'} /></div>
                  </div>
                </section>

                <section className="adminPanel">
                  <div className="adminPanelHeader">
                    <div>
                      <span className="adminBrandKicker">LIVE FEED</span>
                      <h3>最新消息流</h3>
                    </div>
                    <button className="adminButton ghost" type="button" onClick={() => setActiveTab('conversations')}>查看会话</button>
                  </div>
                  <div className="adminMiniList">
                    {overview.recentMessages.length ? overview.recentMessages.map((message) => (
                      <article key={message.id} className="adminMessageItem">
                        <EntityCell principal={message.sender} />
                        <p>{message.snippet || '非文本消息'}</p>
                        <small>{formatTime(message.createdAt)} · {message.conversation?.title || message.conversation?.type || '未命名会话'}</small>
                      </article>
                    )) : <EmptyState title="暂无消息" copy="系统还没有可展示的消息活动。" />}
                  </div>
                </section>
              </div>
            </>
          )}

          {!accessError && activeTab === 'principals' && (
            <section className="adminPanel">
              <div className="adminPanelHeader">
                <div>
                  <span className="adminBrandKicker">DIRECTORY</span>
                  <h2>用户与 Agent</h2>
                  <p>只展示运营必要信息；手机号、邮箱已脱敏。</p>
                </div>
              </div>
              <form className="adminSearchBar" onSubmit={handlePrincipalSearch}>
                <input className="adminInput" value={principalSearchInput} onChange={(event) => setPrincipalSearchInput(event.target.value)} placeholder="搜索 handle / 昵称 / 手机 / 邮箱" />
                <select className="adminSelect" value={principalType} onChange={(event) => setPrincipalType(event.target.value)}>
                  <option value="all">全部主体</option>
                  <option value="human">人类用户</option>
                  <option value="agent">Agent</option>
                </select>
                <button className="adminButton primary" type="submit">搜索</button>
              </form>
              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>主体</th>
                      <th>状态</th>
                      <th>信任</th>
                      <th>联系方式 / 模型</th>
                      <th>创建时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(principalsQuery.data?.items || []).map((item) => (
                      <tr key={item.id}>
                        <td><EntityCell principal={item} /></td>
                        <td>
                          <StatusPill label={item.isSuspended ? 'suspended' : item.presence || 'offline'} tone={item.isSuspended ? 'danger' : statusTone(item.presence)} />
                        </td>
                        <td>{item.trustScore ?? '—'}</td>
                        <td>
                          {item.type === 'human' ? (
                            <span className="adminMuted">{item.humanProfile?.phone || '未绑定手机'} · {item.humanProfile?.email || '未绑定邮箱'}</span>
                          ) : (
                            <span className="adminMuted">{item.agentProfile?.modelProvider || 'provider'} / {item.agentProfile?.modelName || 'model'} · {item.agentProfile?.publishStatus || 'draft'}</span>
                          )}
                        </td>
                        <td>{formatTime(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!principalsQuery.data?.items?.length && <EmptyState title="暂无主体" copy="没有匹配当前筛选条件的用户或 Agent。" />}
              </div>
            </section>
          )}

          {!accessError && activeTab === 'conversations' && (
            <section className="adminPanel">
              <div className="adminPanelHeader">
                <div>
                  <span className="adminBrandKicker">CONVERSATIONS</span>
                  <h2>会话运营</h2>
                  <p>用于排查会话冻结、消息活跃、成员结构与审核压力。</p>
                </div>
              </div>
              <div className="adminTableWrap">
                <table className="adminTable">
                  <thead>
                    <tr>
                      <th>会话</th>
                      <th>成员 / 消息</th>
                      <th>状态</th>
                      <th>最近消息</th>
                      <th>更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(conversationsQuery.data?.items || []).map((item) => (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.title || (item.type === 'direct' ? '私聊会话' : '未命名群组')}</strong>
                          <small className="adminBlockMuted">{item.type} · {item.id}</small>
                        </td>
                        <td>{formatNumber(item.counts?.members)} 成员 · {formatNumber(item.counts?.messages)} 消息</td>
                        <td>
                          <div className="adminPillStack">
                            <StatusPill label={item.isFrozen ? 'frozen' : 'active'} tone={item.isFrozen ? 'danger' : 'success'} />
                            {item.counts?.moderationCases ? <StatusPill label={`${item.counts.moderationCases} 风控`} tone="warning" /> : null}
                          </div>
                        </td>
                        <td>
                          <span className="adminMuted">{item.lastMessage?.snippet || '暂无消息'}</span>
                        </td>
                        <td>{formatTime(item.lastMessageAt || item.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!conversationsQuery.data?.items?.length && <EmptyState title="暂无会话" copy="系统还没有可展示的会话。" />}
              </div>
            </section>
          )}

          {!accessError && activeTab === 'risk' && (
            <div className="adminGridTwo">
              <section className="adminPanel">
                <div className="adminPanelHeader">
                  <div>
                    <span className="adminBrandKicker">APPROVALS</span>
                    <h2>Agent 审批</h2>
                    <p>高风险能力必须留痕并可回溯。</p>
                  </div>
                </div>
                <div className="adminMiniList">
                  {(riskQuery.data?.approvalRequests || []).map((item) => (
                    <article key={item.id} className="adminRiskItem">
                      <div className="adminRiskTop">
                        <StatusPill label={item.status} tone={statusTone(item.status)} />
                        <small>{formatTime(item.createdAt)}</small>
                      </div>
                      <strong>{item.summary}</strong>
                      <p>{item.capability?.name || item.capability?.slug || '未知能力'} · {item.agent?.displayName || 'Agent'} → {item.human?.displayName || '用户'}</p>
                    </article>
                  ))}
                  {!riskQuery.data?.approvalRequests?.length && <EmptyState title="暂无待展示审批" copy="目前没有近期 Agent 审批记录。" />}
                </div>
              </section>

              <section className="adminPanel">
                <div className="adminPanelHeader">
                  <div>
                    <span className="adminBrandKicker">MODERATION</span>
                    <h2>内容审核</h2>
                    <p>集中查看 flagged、blocked 与 needs_review 状态。</p>
                  </div>
                </div>
                <div className="adminMiniList">
                  {(riskQuery.data?.moderationCases || []).map((item) => (
                    <article key={item.id} className="adminRiskItem">
                      <div className="adminRiskTop">
                        <StatusPill label={item.status} tone={statusTone(item.status)} />
                        <small>{formatTime(item.createdAt)}</small>
                      </div>
                      <strong>{item.reasonCode}</strong>
                      <p>{item.targetType} · {item.message?.snippet || item.notes || item.conversation?.title || '未提供摘要'}</p>
                    </article>
                  ))}
                  {!riskQuery.data?.moderationCases?.length && <EmptyState title="暂无开放审核案件" copy="当前没有 flagged、blocked 或 needs_review 案件。" />}
                </div>
              </section>
            </div>
          )}

          {!accessError && activeTab === 'system' && (
            <>
              <section className="adminPanel">
                <div className="adminPanelHeader">
                  <div>
                    <span className="adminBrandKicker">SYSTEM READINESS</span>
                    <h2>系统状态与扩展能力</h2>
                    <p>后台第一版采用只读控制台，为后续 RBAC、租户、计费、封禁与审计动作预留结构。</p>
                  </div>
                </div>
                <div className="adminCapabilityGrid">
                  <article className="adminCapability">
                    <span>服务</span>
                    <strong>{system?.service || 'aiya-api'}</strong>
                    <small>{system?.env || 'unknown'}</small>
                  </article>
                  <article className="adminCapability">
                    <span>数据库</span>
                    <strong>{system?.database || 'unknown'}</strong>
                    <small>在线健康检查</small>
                  </article>
                  <article className="adminCapability">
                    <span>管理员规则</span>
                    <strong>{system?.admin.configured ? '已配置' : '未配置'}</strong>
                    <small>{system?.admin.handleRules || 0} handle · {system?.admin.principalIdRules || 0} id</small>
                  </article>
                </div>
                <div className="adminCapabilityGrid">
                  {Object.entries(system?.capabilities || {}).map(([key, value]) => (
                    <article key={key} className="adminCapability compact">
                      <span>{key}</span>
                      <StatusPill label={value} tone={value === 'planned' ? 'warning' : 'success'} />
                    </article>
                  ))}
                </div>
              </section>

              <section className="adminPanel">
                <div className="adminPanelHeader">
                  <div>
                    <span className="adminBrandKicker">AUDIT TRAIL</span>
                    <h2>审计事件</h2>
                    <p>当前读取最近事件；后续可扩展为导出、条件筛选与合规留存。</p>
                  </div>
                </div>
                <div className="adminTableWrap">
                  <table className="adminTable">
                    <thead>
                      <tr>
                        <th>事件</th>
                        <th>操作者</th>
                        <th>目标</th>
                        <th>时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(auditQuery.data?.items || []).map((item) => (
                        <tr key={item.id}>
                          <td>{item.eventType}</td>
                          <td>{item.actorPrincipal?.displayName || item.actorType}</td>
                          <td>{item.targetTable || '—'} · {item.targetId || item.targetPrincipal?.displayName || '—'}</td>
                          <td>{formatTime(item.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!auditQuery.data?.items?.length && <EmptyState title="暂无审计事件" copy="后续管理动作上线后会在此展示审计轨迹。" />}
                </div>
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
