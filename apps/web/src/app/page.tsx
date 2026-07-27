'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AiyaApiError,
  buildApiClient,
  clearAuthSession,
  getStoredPrincipal,
  persistAuthSession,
} from '../lib/api-client';
import { useAppQueryClient } from './providers';
import GemmaChatWidget from './GemmaChatWidget';

type TabType = 'chats' | 'contacts' | 'agents' | 'settings';

type Principal = {
  id: string;
  type?: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string | null;
  presence?: string;
};

type ConversationSummary = {
  id: string;
  type?: 'direct' | 'group';
  title?: string;
  kind?: string;
  unreadCount?: number;
  unread?: number;
  preview?: string;
  time?: string;
  lastMessageAt?: string;
  updatedAt?: string;
  lastMessage?: {
    body?: string | null;
    senderId?: string;
    sender?: Principal;
    createdAt?: string;
  } | null;
  members?: Array<{ principalId: string; principal?: Principal }>;
};

type ContactItem = {
  id: string;
  principalId?: string;
  name: string;
  status: string;
  statusCode?: 'pending' | 'accepted' | 'blocked' | 'rejected';
  direction?: 'incoming' | 'outgoing';
  type?: string;
  handle?: string;
  conversationId?: string;
};

type AgentItem = {
  principalId: string;
  name: string;
  handle?: string;
  subtitle: string;
  policy: string;
  presence?: string;
};

const demoChats: ConversationSummary[] = [
  { id: 'demo-1', title: 'Ada × Planner', preview: '我已经根据你的工作偏好建议了一个深度工作时段。', time: '10:30', unread: 2, kind: '演示 · 智能体' },
  { id: 'demo-2', title: '周末项目小队', preview: 'Muse：我建议把品牌气质做得更未来感。', time: '09:15', unread: 4, kind: '演示 · 群组' },
  { id: 'demo-3', title: 'Milo Chen', preview: '我们明天把 Agent 目录页一起过一遍。', time: '昨天', unread: 0, kind: '演示 · 用户' },
];

const decodeJwtPayload = (token: string) => {
  const [, payload] = token.split('.');
  if (!payload) return null;
  return JSON.parse(atob(payload));
};

const friendlyError = (error: unknown) => {
  if (!error) return '';
  if (error instanceof AiyaApiError) {
    if (error.status === 401) return '登录已过期，请重新登录。';
    if (error.status === 403) return '你没有权限访问这项内容。';
    if (error.status >= 500) return '服务暂时不可用，请稍后再试。';
    return error.message;
  }
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return '网络连接失败，请检查网络或稍后重试。';
  }
  return error instanceof Error ? error.message : '请求失败，请稍后再试。';
};

const isUnauthorized = (error: unknown) => error instanceof AiyaApiError && error.status === 401;

export default function Home() {
  const queryClient = useAppQueryClient();
  const api = useMemo(() => buildApiClient(), []);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contactDeepLinkRef = useRef('');

  const [mounted, setMounted] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loginMode, setLoginMode] = useState<'human' | 'agent'>('human');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('chats');
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [sendError, setSendError] = useState('');
  const [contactTarget, setContactTarget] = useState('');
  const [contactNotice, setContactNotice] = useState('');
  const [openingContactId, setOpeningContactId] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = window.localStorage.getItem('aiya_access_token') || '';
    if (storedToken) {
      try {
        const payload = decodeJwtPayload(storedToken);
        if (!payload?.exp || payload.exp * 1000 < Date.now()) {
          clearAuthSession();
        } else {
          setAccessToken(storedToken);
          setPrincipal(getStoredPrincipal());
        }
      } catch {
        clearAuthSession();
      }
    }
    setMounted(true);
  }, []);

  const isAuthed = mounted && Boolean(accessToken);

  const deviceId = useMemo(() => {
    if (typeof window === 'undefined') return 'web-browser';
    const existing = window.localStorage.getItem('aiya_device_id');
    if (existing) return existing;
    const created = `web-${crypto.randomUUID()}`;
    window.localStorage.setItem('aiya_device_id', created);
    return created;
  }, []);

  const updateConversationUrl = useCallback((conversationId: string | null = null) => {
    if (typeof window === 'undefined') return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('contactPrincipalId');
    if (conversationId) {
      nextUrl.searchParams.set('conversationId', conversationId);
    } else {
      nextUrl.searchParams.delete('conversationId');
    }
    window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  }, []);

  const handleLogout = useCallback(() => {
    void api.logout().catch(() => clearAuthSession());
    queryClient.clear();
    setAccessToken('');
    setPrincipal(null);
    setSelectedConversationId(null);
    setActiveTab('chats');
    setSendError('');
    updateConversationUrl(null);
  }, [api, queryClient, updateConversationUrl]);

  const meQuery = useQuery({
    queryKey: ['me', accessToken],
    queryFn: async () => (await api.getMe()).data as Principal,
    retry: false,
    enabled: isAuthed,
  });

  const conversationsQuery = useQuery({
    queryKey: ['conversations', accessToken],
    queryFn: async () => (await api.getConversations()).data.items as ConversationSummary[],
    retry: false,
    enabled: isAuthed,
  });

  const contactsQuery = useQuery({
    queryKey: ['contacts', accessToken],
    queryFn: async () => (await api.getContacts()).data.items,
    retry: false,
    enabled: isAuthed,
  });

  const agentsQuery = useQuery({
    queryKey: ['agents', accessToken],
    queryFn: async () => (await api.getAgents()).data.items,
    retry: false,
    enabled: isAuthed,
  });

  const gemma4StatusQuery = useQuery({
    queryKey: ['agents', 'gemma4-status', accessToken],
    queryFn: async () => (await api.getGemma4AgentStatus()).data,
    retry: false,
    enabled: isAuthed,
  });

  const messagesQuery = useQuery({
    queryKey: ['messages', selectedConversationId, accessToken],
    queryFn: async () => {
      if (!selectedConversationId) return [];
      const result = await api.getMessages(selectedConversationId);
      return result.data.items || [];
    },
    retry: false,
    refetchInterval: selectedConversationId ? 3000 : false,
    refetchIntervalInBackground: true,
    enabled: Boolean(selectedConversationId) && isAuthed,
  });

  useEffect(() => {
    if (meQuery.data) {
      setPrincipal(meQuery.data);
    }
  }, [meQuery.data]);

  useEffect(() => {
    const authError = [meQuery.error, conversationsQuery.error, contactsQuery.error, agentsQuery.error, messagesQuery.error]
      .find((error) => isUnauthorized(error));
    if (authError) handleLogout();
  }, [agentsQuery.error, contactsQuery.error, conversationsQuery.error, handleLogout, meQuery.error, messagesQuery.error]);

  const addContactMutation = useMutation({
    mutationFn: async (payload: { target?: string; targetPrincipalId?: string }) => api.addContact(payload),
    onMutate: () => setContactNotice(''),
    onSuccess: async (response: any) => {
      const item = response?.data;
      const targetName = item?.target?.displayName || item?.addressee?.displayName || item?.requester?.displayName || '联系人';
      setContactTarget('');
      setContactNotice(item?.status === 'accepted' ? `已添加 ${targetName}` : `已向 ${targetName} 发送好友请求`);
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (error) => setContactNotice(friendlyError(error)),
  });

  const respondContactMutation = useMutation({
    mutationFn: async ({ contactId, decision }: { contactId: string; decision: 'accepted' | 'rejected' }) =>
      api.respondToContact(contactId, decision),
    onMutate: () => setContactNotice(''),
    onSuccess: async (_response, variables) => {
      setContactNotice(variables.decision === 'accepted' ? '已通过好友请求' : '已拒绝好友请求');
      await queryClient.invalidateQueries({ queryKey: ['contacts'] });
    },
    onError: (error) => setContactNotice(friendlyError(error)),
  });

  const openContactConversationMutation = useMutation({
    mutationFn: async (contact: ContactItem) => {
      if (!contact.principalId) throw new Error('联系人身份缺失');
      const response = await api.createConversation({ type: 'direct', memberIds: [contact.principalId] });
      return response.data as ConversationSummary;
    },
    onMutate: (contact) => {
      setOpeningContactId(contact.id);
      setContactNotice('');
    },
    onSuccess: async (conversation) => {
      setActiveTab('chats');
      setSelectedConversationId(conversation.id);
      updateConversationUrl(conversation.id);
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
      await queryClient.invalidateQueries({ queryKey: ['messages', conversation.id] });
    },
    onError: (error) => setContactNotice(friendlyError(error)),
    onSettled: () => setOpeningContactId(null),
  });

  const sendMessageMutation = useMutation({
    mutationFn: async (content: { body: string }) => {
      if (!selectedConversationId) throw new Error('No conversation selected');
      return api.sendMessage(selectedConversationId, content);
    },
    onMutate: () => setSendError(''),
    onSuccess: async () => {
      setMessageInput('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['messages', selectedConversationId] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
      ]);
    },
    onError: (error) => setSendError(friendlyError(error)),
  });

  const handleLogin = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const cleanIdentifier = identifier.trim();
    if (!cleanIdentifier || !password || loginLoading) return;

    setLoginLoading(true);
    setLoginError('');
    try {
      const result = loginMode === 'agent'
        ? await api.agentLogin({ handle: cleanIdentifier, apiKey: password, deviceId, platform: 'web' })
        : await api.login(cleanIdentifier.includes('@')
          ? { email: cleanIdentifier, password, deviceId, platform: 'web' }
          : { phone: cleanIdentifier, password, deviceId, platform: 'web' });
      persistAuthSession(result);
      setAccessToken(result.accessToken);
      setPrincipal(result.principal || null);
      setShowLogin(false);
      setPassword('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['me'] }),
        queryClient.invalidateQueries({ queryKey: ['conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
        queryClient.invalidateQueries({ queryKey: ['agents'] }),
      ]);
    } catch (error) {
      setLoginError(friendlyError(error));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleAddContact = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = contactTarget.trim();
    if (!target || addContactMutation.isPending) return;
    addContactMutation.mutate({ target });
  };

  const handleAddAgent = (agent: AgentItem) => {
    if (!agent.principalId || addContactMutation.isPending) return;
    addContactMutation.mutate({ targetPrincipalId: agent.principalId });
  };

  const handleSendMessage = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = messageInput.trim();
    if (!body || !selectedConversationId || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate({ body });
  };

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messagesQuery.data, scrollToBottom]);

  const conversations = conversationsQuery.data || [];
  const directConversationByPrincipalId = new Map<string, string>();
  if (principal?.id) {
    conversations.forEach((conversation) => {
      if (conversation.type !== 'direct') return;
      conversation.members?.forEach((member) => {
        if (member.principalId && member.principalId !== principal.id) {
          directConversationByPrincipalId.set(member.principalId, conversation.id);
        }
      });
    });
  }
  const contacts: ContactItem[] = isAuthed
    ? (contactsQuery.data || []).map((item: any) => {
        const principalItem = item.target || (item.requesterId === principal?.id ? item.addressee : item.requester);
        const pendingText = item.status === 'pending'
          ? item.direction === 'incoming' ? '待你通过' : '等待对方通过'
          : '';
        const presenceText = principalItem?.presence === 'online' ? '在线' : principalItem?.presence === 'busy' ? '忙碌' : '离线';
        return {
          id: item.id || principalItem?.id || item.requesterId || item.addresseeId,
          principalId: principalItem?.id,
          name: principalItem?.displayName || '未知联系人',
          handle: principalItem?.handle,
          conversationId: principalItem?.id ? directConversationByPrincipalId.get(principalItem.id) : undefined,
          status: pendingText || presenceText,
          statusCode: item.status,
          direction: item.direction,
          type: principalItem?.type === 'agent' ? '智能体' : '用户',
        };
      })
    : [];
  const acceptedContactKeys = new Set((contactsQuery.data || [])
    .filter((item: any) => item.status === 'accepted')
    .map((item: any) => item.target?.id || (item.requesterId === principal?.id ? item.addresseeId : item.requesterId)));
  const agents: AgentItem[] = isAuthed
    ? (agentsQuery.data || []).map((item: any) => ({
        principalId: item.principalId || item.principal?.id,
        name: item.principal?.displayName || item.externalAgentId || '未命名智能体',
        handle: item.principal?.handle,
        subtitle: `${item.modelProvider || 'model'} · ${item.modelName || 'unknown'}`,
        policy: item.publishStatus === 'published' ? '已发布' : item.publishStatus || '默认策略',
        presence: item.principal?.presence,
      }))
    : [];
  const gemma4Status = gemma4StatusQuery.data;

  const selectedConversation = conversations.find((item) => item.id === selectedConversationId);
  const messages = messagesQuery.data || [];
  const currentUserId = principal?.id;
  const agentMember = selectedConversation?.members?.find((member) => member.principal?.type === 'agent');
  const lastMessage = messages[messages.length - 1];
  const waitingForAgentResponse = Boolean(
    selectedConversationId &&
    agentMember &&
    lastMessage &&
    lastMessage.senderId === currentUserId &&
    lastMessage.senderType !== 'agent'
  );
  const displayChats = isAuthed ? conversations : demoChats;
  const totalUnread = conversations.reduce((sum, item) => sum + (item.unreadCount ?? item.unread ?? 0), 0);

  const getAvatarInitial = (name?: string | null) => (name || 'U').charAt(0).toUpperCase();

  const formatTime = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    if (Number.isNaN(date.getTime())) return '';
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  const conversationPreview = (chat: ConversationSummary) => chat.preview || chat.lastMessage?.body || '暂无消息';
  const conversationTime = (chat: ConversationSummary) => chat.time || formatTime(chat.lastMessageAt || chat.lastMessage?.createdAt || chat.updatedAt);
  const conversationUnread = (chat: ConversationSummary) => chat.unreadCount ?? chat.unread ?? 0;

  const switchTab = (tab: TabType) => {
    setActiveTab(tab);
    setSelectedConversationId(null);
    setSendError('');
    updateConversationUrl(null);
  };

  const openLogin = (mode: 'human' | 'agent' = 'human') => {
    setLoginMode(mode);
    setLoginError('');
    setShowLogin(true);
  };

  const openConversationById = useCallback((conversationId: string) => {
    setActiveTab('chats');
    setSelectedConversationId(conversationId);
    setSendError('');
    updateConversationUrl(conversationId);
  }, [updateConversationUrl]);

  const closeConversation = useCallback(() => {
    setSelectedConversationId(null);
    setSendError('');
    updateConversationUrl(null);
  }, [updateConversationUrl]);

  useEffect(() => {
    if (!isAuthed || typeof window === 'undefined') return;
    const conversationId = new URLSearchParams(window.location.search).get('conversationId');
    if (!conversationId || selectedConversationId === conversationId) return;
    if (conversations.some((conversation) => conversation.id === conversationId)) {
      setActiveTab('chats');
      setSelectedConversationId(conversationId);
      setSendError('');
    }
  }, [conversations, isAuthed, selectedConversationId]);

  useEffect(() => {
    if (!isAuthed || typeof window === 'undefined' || openContactConversationMutation.isPending) return;
    const contactPrincipalId = new URLSearchParams(window.location.search).get('contactPrincipalId');
    if (!contactPrincipalId || contactDeepLinkRef.current === contactPrincipalId) return;
    const contact = contacts.find((item) => item.principalId === contactPrincipalId && item.statusCode === 'accepted');
    if (!contact) return;
    contactDeepLinkRef.current = contactPrincipalId;
    if (contact.conversationId) {
      openConversationById(contact.conversationId);
      return;
    }
    openContactConversationMutation.mutate(contact);
  }, [contacts, isAuthed, openConversationById, openContactConversationMutation]);

  const navButton = (tab: TabType, icon: string, label: string) => (
    <button type="button" className={`navItem ${activeTab === tab ? 'active' : ''}`} onClick={() => switchTab(tab)}>
      <span className="navItemIcon">{icon}</span>
      <span>{label}</span>
      {tab === 'chats' && totalUnread > 0 && <span className="navBadge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
    </button>
  );

  const queryError = conversationsQuery.error || contactsQuery.error || agentsQuery.error;

  if (!mounted) {
    return (
      <div className="appShell centeredShell">
        <div className="loadingState">正在启动 Aiya…</div>
      </div>
    );
  }

  return (
    <div className="appShell">
      <aside className="sideNav" aria-label="主导航">
        <div className="sideNavBrand">
          <div className="brandMark">A</div>
          <div>
            <strong>Aiya</strong>
            <span>商用通讯工作台</span>
          </div>
        </div>
        <div className="sideNavUser">
          <div className="userHeaderAvatar">{getAvatarInitial(principal?.displayName || principal?.handle || '访')}</div>
          <div className="userHeaderInfo">
            <strong>{principal?.displayName || principal?.handle || '访客模式'}</strong>
            <p>{isAuthed ? `${principal?.type === 'agent' ? 'Agent' : '用户'} 已连接 · 同源 API` : '登录后同步真实数据'}</p>
          </div>
        </div>
        <nav className="sideNavMenu">
          {navButton('chats', '💬', '消息')}
          {navButton('contacts', '👥', '联系人')}
          {navButton('agents', '🤖', '智能体')}
          {navButton('settings', '⚙️', '设置')}
        </nav>
        {!isAuthed && (
          <div className="sideNavLoginActions">
            <button type="button" className="primaryPillButton" onClick={() => openLogin()}>用户登录</button>
            <button type="button" className="inlineButton agentLoginShortcut" onClick={() => openLogin('agent')}>Agent 登录</button>
          </div>
        )}
      </aside>

      <div className="mainContent">
        <header className="topBar">
          <h1>
            {activeTab === 'chats' && (selectedConversationId ? selectedConversation?.title || '聊天' : '消息')}
            {activeTab === 'contacts' && '联系人'}
            {activeTab === 'agents' && '智能体'}
            {activeTab === 'settings' && '设置'}
          </h1>
          <div className="topBarActions">
            {activeTab === 'chats' && selectedConversationId && <button type="button" onClick={closeConversation} aria-label="返回">←</button>}
            {activeTab === 'chats' && !selectedConversationId && <button type="button" onClick={isAuthed ? () => conversationsQuery.refetch() : () => openLogin()} aria-label={isAuthed ? '刷新会话' : '登录'}>{isAuthed ? '↻' : '登录'}</button>}
          </div>
        </header>

        {queryError && isAuthed && (
          <div className="statusBanner error" role="alert">
            <span>{friendlyError(queryError)}</span>
            <button type="button" onClick={() => queryClient.invalidateQueries()}>重试</button>
          </div>
        )}

        {activeTab === 'chats' && !selectedConversationId && (
          <div className="chatList">
            <div className="chatListHeader">
              {isAuthed && principal && (
                <div className="chatListUserHeader">
                  <div className="chatListUserAvatar">{getAvatarInitial(principal.displayName || principal.handle)}</div>
                  <div className="chatListUserInfo">
                    <span className="chatListUserName">{principal.displayName || principal.handle || '用户'}</span>
                    <span className="chatListUserStatus">已连接 · {conversationsQuery.isFetching ? '同步中' : '在线'}</span>
                  </div>
                </div>
              )}

              <div className="sectionTitleRow">
                <div>
                  <h2>消息</h2>
                  <p>{isAuthed ? `${conversations.length} 个会话 · ${totalUnread} 条未读` : '登录后查看真实消息；下方是演示会话'}</p>
                </div>
                {!isAuthed && <button type="button" className="inlineButton primary" onClick={() => openLogin()}>登录</button>}
              </div>
              <GemmaChatWidget />
            </div>

            {isAuthed && conversationsQuery.isLoading ? (
              <div className="loadingState">正在同步会话…</div>
            ) : displayChats.length > 0 ? (
              displayChats.map((chat) => (
                <a
                  key={chat.id}
                  href={isAuthed ? `/?conversationId=${encodeURIComponent(chat.id)}` : '#login'}
                  className={`chatItem${chat.id === selectedConversationId ? ' active' : ''}`}
                  onClick={(event) => {
                    if (!isAuthed) {
                      event.preventDefault();
                      openLogin();
                      return;
                    }
                    event.preventDefault();
                    openConversationById(chat.id);
                  }}
                >
                  <div className="chatAvatar">
                    {getAvatarInitial(chat.title)}
                    {chat.members?.some((member) => member.principal?.presence === 'online') && <span className="onlineDot" />}
                  </div>
                  <div className="chatInfo">
                    <div className="chatInfoHeader">
                      <strong>{chat.title || '未命名会话'}</strong>
                      <span className="chatTime">{conversationTime(chat)}</span>
                    </div>
                    <p className="chatPreview">{conversationPreview(chat)}</p>
                    <div className="chatMeta">
                      {conversationUnread(chat) > 0 && <span className="chatBadge">{conversationUnread(chat)}</span>}
                      <span className="chatTag">{chat.kind || (chat.type === 'group' ? '群组' : '用户')}</span>
                    </div>
                  </div>
                </a>
              ))
            ) : (
              <div className="emptyState">
                <div className="emptyStateIcon">💬</div>
                <p>暂无会话</p>
                <p>先从联系人或智能体发起一次对话，新的消息会出现在这里。</p>
                <div className="emptyStateActions">
                  <button type="button" className="inlineButton" onClick={() => conversationsQuery.refetch()}>刷新</button>
                  <button type="button" className="inlineButton primary" onClick={() => switchTab('contacts')}>查看联系人</button>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'chats' && selectedConversationId && (
          <div className="chatDetail">
            <div className="chatHeader">
              <button type="button" className="backButton" onClick={closeConversation}>←</button>
              <div className="chatHeaderInfo">
                <h2>{selectedConversation?.title || '聊天'}</h2>
                <p>
                  {selectedConversation?.type === 'direct' ? '直接会话' : '群组'} · {
                    waitingForAgentResponse ? '智能体正在思考' : messagesQuery.isFetching ? '同步中' : `${messages.length} 条消息`
                  }
                </p>
              </div>
              <div className="chatHeaderActions">
                <button type="button" onClick={() => messagesQuery.refetch()}>↻</button>
              </div>
            </div>

            <div className="messagesContainer">
              {messagesQuery.isLoading ? (
                <div className="loadingState">正在加载消息…</div>
              ) : messagesQuery.isError ? (
                <div className="inlineError" role="alert">
                  {friendlyError(messagesQuery.error)}
                  <button type="button" onClick={() => messagesQuery.refetch()}>重试</button>
                </div>
              ) : messages.length > 0 ? (
                <>
                  {messages.map((msg: any) => {
                    const isOwn = msg.senderId === currentUserId;
                    const senderName = msg.sender?.displayName || (msg.senderType === 'human' ? '用户' : '智能体');
                    return (
                      <div key={msg.id} className={`messageGroup ${isOwn ? 'own' : 'other'}`}>
                        {!isOwn && <span className="messageSender">{senderName}</span>}
                        <div className="messageBubble">{msg.body || '[非文本消息]'}</div>
                        <span className="messageTime">{formatTime(msg.createdAt)}</span>
                      </div>
                    );
                  })}
                  {waitingForAgentResponse && (
                    <div className="messageGroup other agentThinking">
                      <span className="messageSender">{agentMember?.principal?.displayName || '智能体'}</span>
                      <div className="messageBubble typingBubble">
                        <span className="typingDots"><i /> <i /> <i /></span>
                        <span>正在思考，请稍候…</span>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="emptyState">
                  <div className="emptyStateIcon">💭</div>
                  <p>还没有消息</p>
                  <p>发送第一条消息，让这个会话开始流动。</p>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="messageInput" onSubmit={handleSendMessage}>
              {sendError && <p className="composerError" role="alert">{sendError}</p>}
              <div className="messageInputForm">
                <input
                  value={messageInput}
                  onChange={(event) => setMessageInput(event.target.value)}
                  placeholder="输入消息…"
                  aria-label="输入消息"
                />
                <button type="submit" className="sendButton" disabled={!messageInput.trim() || sendMessageMutation.isPending}>
                  {sendMessageMutation.isPending ? '…' : '↑'}
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'contacts' && (
          <div className="tabView">
            <div className="sectionTitleRow">
              <div>
                <h2>联系人</h2>
                <p>{isAuthed ? `${contacts.length} 个已同步联系人` : '登录后同步你的联系人网络'}</p>
              </div>
              {isAuthed && <button type="button" className="inlineButton" onClick={() => contactsQuery.refetch()}>刷新</button>}
            </div>
            {!isAuthed ? (
              <LockedState title="登录后查看联系人" onLogin={() => openLogin()} />
            ) : (
              <>
                <form className="contactAddCard" onSubmit={handleAddContact}>
                  <div>
                    <strong>添加好友或 Agent</strong>
                    <p>输入手机号、邮箱、handle 或 @handle。添加 Agent 会默认通过；添加人类用户会发送好友请求。</p>
                  </div>
                  <div className="contactAddForm">
                    <input
                      value={contactTarget}
                      onChange={(event) => setContactTarget(event.target.value)}
                      placeholder="例如 13800138001 或 @gemma4"
                      aria-label="输入好友或 Agent"
                    />
                    <button type="submit" disabled={!contactTarget.trim() || addContactMutation.isPending}>
                      {addContactMutation.isPending ? '添加中…' : '添加'}
                    </button>
                  </div>
                  {contactNotice && <p className={`contactNotice ${addContactMutation.isError || respondContactMutation.isError ? 'error' : ''}`}>{contactNotice}</p>}
                </form>

                {contactsQuery.isLoading ? (
                  <div className="loadingState">正在同步联系人…</div>
                ) : contactsQuery.isError ? (
                  <div className="inlineError" role="alert">{friendlyError(contactsQuery.error)}<button type="button" onClick={() => contactsQuery.refetch()}>重试</button></div>
                ) : contacts.length > 0 ? (
                  contacts.map((contact) => {
                    const contactHref = contact.conversationId
                      ? `/?conversationId=${encodeURIComponent(contact.conversationId)}`
                      : contact.principalId
                        ? `/?contactPrincipalId=${encodeURIComponent(contact.principalId)}`
                        : '#';
                    const contactContent = (
                      <>
                        <div className="contactAvatar">{getAvatarInitial(contact.name)}</div>
                        <div className="contactInfo">
                          <strong>{contact.name}</strong>
                          <p>
                            {contact.type || '用户'} · {contact.handle ? `@${contact.handle} · ` : ''}{contact.status}
                            {contact.statusCode === 'accepted' && (openingContactId === contact.id ? ' · 打开中…' : ' · 点击对话')}
                          </p>
                        </div>
                      </>
                    );

                    if (contact.statusCode === 'accepted') {
                      return (
                        <a
                          key={contact.id}
                          href={contactHref}
                          className="contactItem"
                          onClick={(event) => {
                            event.preventDefault();
                            if (openContactConversationMutation.isPending) return;
                            if (contact.conversationId) {
                              openConversationById(contact.conversationId);
                              return;
                            }
                            openContactConversationMutation.mutate(contact);
                          }}
                        >
                          {contactContent}
                        </a>
                      );
                    }

                    return (
                      <div key={contact.id} className="contactItem pending">
                        {contactContent}
                        {contact.direction === 'incoming' && (
                          <div className="contactActions">
                            <button
                              type="button"
                              className="inlineButton primary"
                              disabled={respondContactMutation.isPending}
                              onClick={() => respondContactMutation.mutate({ contactId: contact.id, decision: 'accepted' })}
                            >
                              通过
                            </button>
                            <button
                              type="button"
                              className="inlineButton"
                              disabled={respondContactMutation.isPending}
                              onClick={() => respondContactMutation.mutate({ contactId: contact.id, decision: 'rejected' })}
                            >
                              拒绝
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="emptyState"><div className="emptyStateIcon">👥</div><p>暂无联系人</p><p>添加人类好友或 Agent 后会出现在这里。</p></div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'agents' && (
          <div className="tabView">
            <div className="sectionTitleRow">
              <div>
                <h2>智能体</h2>
                <p>{isAuthed ? `${agents.length} 个可用智能体` : '登录后查看可授权的 AI Agent'}</p>
              </div>
              {isAuthed && <button type="button" className="inlineButton" onClick={() => agentsQuery.refetch()}>刷新</button>}
            </div>
            {isAuthed && (
              <div className="agentStatusCard">
                <div>
                  <span className="agentStatusEyebrow">Gemma4 Agent Login</span>
                  <strong>{gemma4Status?.agent?.principal?.displayName || 'Gemma4 Agent'}</strong>
                  <p>
                    {gemma4StatusQuery.isLoading
                      ? '正在读取 Gemma4 接入状态…'
                      : gemma4Status?.configured
                        ? `模型 ${gemma4Status.model || 'gemma4'} 已配置，Agent handle：@${gemma4Status.agentHandle}`
                        : 'Gemma4 模型地址尚未配置；填入 GEMMA4_BASE_URL 后即可启用模型调用。'}
                  </p>
                </div>
                <div className="agentStatusActions">
                  <span className={`agentStatusPill ${gemma4Status?.agentReady ? 'ready' : 'pending'}`}>
                    {gemma4Status?.agentReady ? 'Agent 可登录' : '等待种子'}
                  </span>
                  <button type="button" className="inlineButton" onClick={() => openLogin('agent')}>Agent 登录</button>
                </div>
              </div>
            )}
            {!isAuthed ? (
              <LockedState title="登录后查看智能体目录" onLogin={() => openLogin()} />
            ) : agentsQuery.isLoading ? (
              <div className="loadingState">正在同步智能体…</div>
            ) : agentsQuery.isError ? (
              <div className="inlineError" role="alert">{friendlyError(agentsQuery.error)}<button type="button" onClick={() => agentsQuery.refetch()}>重试</button></div>
            ) : agents.length > 0 ? (
              agents.map((agent) => (
                <div key={agent.name} className="agentCard">
                  <div className="agentHeader">
                    <div className="agentAvatar">{getAvatarInitial(agent.name)}</div>
                    <div className="agentInfo">
                      <strong>{agent.name}</strong>
                      <p>{agent.subtitle}</p>
                    </div>
                  </div>
                  <div className="agentFooter">
                    <span className="agentPolicy">{agent.policy} · {agent.handle ? `@${agent.handle} · ` : ''}{agent.presence || '离线'}</span>
                    <button
                      type="button"
                      className="inlineButton"
                      disabled={!agent.principalId || acceptedContactKeys.has(agent.principalId) || addContactMutation.isPending}
                      onClick={() => handleAddAgent(agent)}
                    >
                      {acceptedContactKeys.has(agent.principalId) ? '已是好友' : '加为好友'}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="emptyState"><div className="emptyStateIcon">🤖</div><p>暂无可用智能体</p><p>发布智能体后会显示在这里。</p></div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="tabView">
            <h2>设置</h2>
            <div className="userHeader">
              <div className="userHeaderAvatar">{getAvatarInitial(principal?.displayName || principal?.handle || 'U')}</div>
              <div className="userHeaderInfo">
                <strong>{principal?.displayName || principal?.handle || '未登录'}</strong>
                <p>{isAuthed ? '在线 · 会话已加密签名' : '未连接'}</p>
              </div>
            </div>

            <div className="settingsSection">
              <h3>连接状态</h3>
              <div className="settingsItem static">
                <div className="settingsItemLeft"><div className="settingsItemIcon">🌐</div><span>API 路由</span></div>
                <span className="settingsItemRight">同源 /api</span>
              </div>
              <div className="settingsItem static">
                <div className="settingsItemLeft"><div className="settingsItemIcon">🔒</div><span>登录状态</span></div>
                <span className="settingsItemRight">{isAuthed ? '有效' : '未登录'}</span>
              </div>
              {isAuthed && (
                <a className="settingsItem adminEntry" href="/admin">
                  <div className="settingsItemLeft"><div className="settingsItemIcon">🛡️</div><span>管理后台</span></div>
                  <span className="settingsItemRight">运营控制台</span>
                </a>
              )}
            </div>

            {isAuthed ? (
              <button type="button" className="logoutButton" onClick={handleLogout}>退出登录</button>
            ) : (
              <button type="button" className="loginButton" onClick={() => openLogin()}>登录账号</button>
            )}
          </div>
        )}
      </div>

      <nav className="bottomNav" aria-label="底部导航">
        {navButton('chats', '💬', '消息')}
        {navButton('contacts', '👥', '联系人')}
        {navButton('agents', '🤖', '智能体')}
        {navButton('settings', '⚙️', '设置')}
      </nav>

      {showLogin && (
        <div className="loginOverlay" onClick={(event) => event.target === event.currentTarget && setShowLogin(false)}>
          <form className="loginCard" onSubmit={handleLogin}>
            <button type="button" className="loginClose" onClick={() => setShowLogin(false)} aria-label="关闭登录">×</button>
            <h2>{loginMode === 'agent' ? 'Agent 登录 Aiya' : '登录 Aiya'}</h2>
            <p>{loginMode === 'agent' ? '使用 Agent handle 和登录 key 接入 Aiya 通讯身份。' : '登录后同步真实消息、联系人和智能体。'}</p>
            <div className="loginModeSwitch" role="tablist" aria-label="登录类型">
              <button type="button" className={loginMode === 'human' ? 'active' : ''} onClick={() => { setLoginMode('human'); setLoginError(''); }}>
                用户
              </button>
              <button type="button" className={loginMode === 'agent' ? 'active' : ''} onClick={() => { setLoginMode('agent'); setLoginError(''); }}>
                Agent
              </button>
            </div>
            <input
              className="loginInput"
              placeholder={loginMode === 'agent' ? 'Agent handle，例如 gemma4' : '手机号或邮箱'}
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              autoComplete="username"
            />
            <input
              className="loginInput"
              type="password"
              placeholder={loginMode === 'agent' ? 'Agent 登录 key' : '密码'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            <button className="loginButton" type="submit" disabled={loginLoading || !identifier.trim() || !password}>{loginLoading ? '登录中…' : '登录'}</button>
            <p className="loginHint">
              {loginMode === 'agent'
                ? '默认 Agent handle：gemma4；登录 key 由服务端种子脚本生成，不在前端公开。'
                : <>测试账号: <strong>13800138000</strong> / <strong>password</strong></>}
            </p>
            {loginError && <p className="loginError" role="alert">{loginError}</p>}
          </form>
        </div>
      )}
    </div>
  );
}

function LockedState({ title, onLogin }: { title: string; onLogin: () => void }) {
  return (
    <div className="emptyState lockedState">
      <div className="emptyStateIcon">🔐</div>
      <p>{title}</p>
      <p>你的消息和联系人只会在登录后加载。</p>
      <button type="button" className="inlineButton primary" onClick={onLogin}>登录账号</button>
    </div>
  );
}
