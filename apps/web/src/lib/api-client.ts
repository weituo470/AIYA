const ACCESS_TOKEN_KEY = 'aiya_access_token';
const REFRESH_TOKEN_KEY = 'aiya_refresh_token';
const PRINCIPAL_KEY = 'aiya_principal';
const DEVICE_ID_KEY = 'aiya_device_id';

export type LoginPayload = {
  phone?: string;
  email?: string;
  password: string;
  deviceId: string;
  platform: string;
};

export type AgentLoginPayload = {
  handle: string;
  apiKey: string;
  deviceId: string;
  platform: string;
};

export type ContactCreatePayload = {
  target?: string;
  targetPrincipalId?: string;
  note?: string;
};

export type LoginResult = {
  accessToken: string;
  refreshToken: string;
  principal?: {
    id: string;
    displayName?: string;
    handle?: string;
    type?: string;
    presence?: string;
    avatarUrl?: string | null;
  };
};

export class AiyaApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'AiyaApiError';
    this.status = status;
    this.code = code;
  }
}

export const getStoredAccessToken = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(ACCESS_TOKEN_KEY) || '';
};

const getStoredRefreshToken = () => {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(REFRESH_TOKEN_KEY) || '';
};

export const getStoredPrincipal = () => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(PRINCIPAL_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

export const persistAuthSession = (result: LoginResult) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, result.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, result.refreshToken);
  if (result.principal) {
    window.localStorage.setItem(PRINCIPAL_KEY, JSON.stringify(result.principal));
  }
};

export const clearAuthSession = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  window.localStorage.removeItem(PRINCIPAL_KEY);
};

const createClientMessageId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toQueryString = (params: Record<string, string | number | undefined> = {}) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  });
  const value = search.toString();
  return value ? `?${value}` : '';
};

const API_BASE_URL = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_BASE_URL ?? (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'http://localhost:3000' : ''))
  : (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000');

export const buildApiClient = (baseUrl = API_BASE_URL) => {
  let refreshPromise: Promise<boolean> | null = null;

  const refreshSession = async () => {
    const refreshToken = getStoredRefreshToken();
    const deviceId = typeof window !== 'undefined' ? window.localStorage.getItem(DEVICE_ID_KEY) || '' : '';
    if (!refreshToken || !deviceId) return false;

    const response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken, deviceId }),
      cache: 'no-store',
    });
    if (!response.ok) {
      clearAuthSession();
      return false;
    }
    const body = await response.json();
    persistAuthSession(body.data as LoginResult);
    return true;
  };

  const request = async (path: string, init: RequestInit = {}, allowRefresh = true): Promise<any> => {
    const token = getStoredAccessToken();
    const hasBody = init.body !== undefined && init.body !== null;
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
      cache: 'no-store',
    });

    if (response.status === 401 && allowRefresh && !path.startsWith('/api/auth/')) {
      refreshPromise ||= refreshSession().finally(() => { refreshPromise = null; });
      if (await refreshPromise) return request(path, init, false);
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new AiyaApiError(body?.error?.message || '请求失败', response.status, body?.error?.code);
    }

    return response.json();
  };

  return {
    login: async (payload: LoginPayload) => {
      if (typeof window !== 'undefined') window.localStorage.setItem(DEVICE_ID_KEY, payload.deviceId);
      const response = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return response.data as LoginResult;
    },
    agentLogin: async (payload: AgentLoginPayload) => {
      if (typeof window !== 'undefined') window.localStorage.setItem(DEVICE_ID_KEY, payload.deviceId);
      const response = await request('/api/auth/agent-login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      return response.data as LoginResult;
    },
    logout: async () => {
      try {
        return await request('/api/auth/logout', { method: 'POST', body: '{}' }, false);
      } finally {
        clearAuthSession();
      }
    },
    logoutAll: async () => {
      try {
        return await request('/api/auth/logout-all', { method: 'POST', body: '{}' }, false);
      } finally {
        clearAuthSession();
      }
    },
    getMe: () => request('/api/principals/me'),
    getConversations: () => request('/api/conversations'),
    createConversation: (payload: { type: 'direct' | 'group'; memberIds: string[]; title?: string }) => request('/api/conversations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    getContacts: () => request('/api/contacts'),
    addContact: (payload: ContactCreatePayload) => request('/api/contacts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    respondToContact: (contactId: string, decision: 'accepted' | 'rejected') => request(`/api/contacts/${contactId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
    getAgents: () => request('/api/agents'),
    getGemma4AgentStatus: () => request('/api/agents/gemma4/status'),
    getApprovals: () => request('/api/approvals'),
    getMessages: (conversationId: string) => request(`/api/conversations/${conversationId}/messages`),
    sendMessage: (conversationId: string, content: { body: string }) => request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ conversationId, type: 'text', content, clientMessageId: createClientMessageId() }),
    }),
    getAdminOverview: () => request('/api/admin/overview'),
    getAdminPrincipals: (params?: { q?: string; type?: string; limit?: number }) =>
      request(`/api/admin/principals${toQueryString(params)}`),
    getAdminConversations: (params?: { limit?: number }) =>
      request(`/api/admin/conversations${toQueryString(params)}`),
    getAdminRisk: (params?: { limit?: number }) =>
      request(`/api/admin/risk${toQueryString(params)}`),
    getAdminAuditEvents: (params?: { limit?: number }) =>
      request(`/api/admin/audit-events${toQueryString(params)}`),
    getAdminSystem: () => request('/api/admin/system'),
  };
};
