export interface Feed {
  id: string;
  url: string;
  name: string;
  description?: string;
  checkInterval: number;
  active: boolean;
  lastCheckedAt?: string;
  createdAt: string;
  updatedAt: string;
  _count?: { subscriptions: number };
}

export interface Subscription {
  id: string;
  feedId: string;
  feed: { id: string; name: string; url: string };
  chatId: string;
  chatName?: string;
  active: boolean;
  createdAt: string;
}

export interface BotChat {
  chatId: string;
  chatName: string;
  chatType: string;
  isAdmin: boolean;
  updatedAt: string;
}

export interface BotStatus {
  started: boolean;
  connecting: boolean;
  connected: boolean;
  botId: number | null;
  username: string | null;
  lastConnectedAt: string | null;
  lastLaunchError: string | null;
  lastLaunchErrorAt: string | null;
  knownChats: number;
}

export interface Stats {
  totalFeeds: number;
  totalSubs: number;
  itemsDelivered24h: number;
  recentActivity: ActivityItem[];
}

export interface ActivityItem {
  id: string;
  feedName: string;
  articleTitle?: string;
  chatId?: string;
  deliveredAt: string;
}

const TOKEN_KEY = 'auth_token';

// Auth storage now uses sessionStorage for login state tracking only
// Actual JWT is stored in httpOnly cookie by the server
export const authStorage = {
  getToken: () => sessionStorage.getItem(TOKEN_KEY),
  setToken: (_token: string) => {
    // Token is now stored in httpOnly cookie, but we store a flag for UI state
    sessionStorage.setItem(TOKEN_KEY, 'authenticated');
  },
  clearToken: () => sessionStorage.removeItem(TOKEN_KEY),
  isAuthenticated: () => sessionStorage.getItem(TOKEN_KEY) !== null,
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Cookies are sent automatically by the browser
  const res = await fetch(`/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    credentials: 'same-origin', // Include cookies for same-origin requests
    ...options,
  });

  if (res.status === 401) {
    authStorage.clearToken();
    window.location.href = '/login';
    return new Promise(() => {});  // never resolves; navigation is in flight
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  // Auth
  login: (password: string) =>
    request<{ ok: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),
  logout: () =>
    request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
    }),
  getAuthStatus: () =>
    request<{ passwordFromEnv: boolean }>('/auth/status'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // Feeds
  getFeeds: () => request<Feed[]>('/feeds'),
  createFeed: (data: { url: string; name: string; checkInterval: number }) =>
    request<Feed>('/feeds', { method: 'POST', body: JSON.stringify(data) }),
  updateFeed: (id: string, data: Partial<Feed>) =>
    request<Feed>(`/feeds/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFeed: (id: string) => request<void>(`/feeds/${id}`, { method: 'DELETE' }),
  refreshFeed: (id: string) =>
    request<{ message: string }>(`/feeds/${id}/refresh`, { method: 'POST' }),
  forcePushFeed: (id: string) =>
    request<{ cleared: number; message: string }>(`/feeds/${id}/force-push`, { method: 'POST' }),

  // Subscriptions
  getSubscriptions: () => request<Subscription[]>('/subscriptions'),
  createSubscription: (data: { feedId: string; chatId: string; chatName?: string }) =>
    request<Subscription>('/subscriptions', { method: 'POST', body: JSON.stringify(data) }),
  toggleSubscription: (id: string, active: boolean) =>
    request<Subscription>(`/subscriptions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),
  deleteSubscription: (id: string) =>
    request<void>(`/subscriptions/${id}`, { method: 'DELETE' }),

  importFeeds: (feeds: Array<{ url: string; name: string; checkInterval?: number }>) =>
    request<{ imported: Feed[]; skipped: Array<{ url: string; reason: string }>; failed: Array<{ url: string; reason: string }> }>(
      '/feeds/import',
      { method: 'POST', body: JSON.stringify({ feeds }) }
    ),

  bulkCreateSubscriptions: (data: { feedIds: string[]; chatId: string; chatName?: string }) =>
    request<{ created: number }>('/subscriptions/bulk', { method: 'POST', body: JSON.stringify(data) }),

  // Stats
  getStats: () => request<Stats>('/stats'),

  // Bot
  getBotStatus: () => request<BotStatus>('/bot/status'),
  getBotChats: (adminOnly = true) =>
    request<BotChat[]>(`/bot/chats${adminOnly ? '?adminOnly=true' : ''}`),
  syncBotChats: () =>
    request<{ updated: number; removed: number }>('/bot/chats/sync', { method: 'POST' }),
};
