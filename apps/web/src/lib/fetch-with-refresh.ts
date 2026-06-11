const REFRESH_PATH = '/api/auth/refresh';
const RECENT_KEY = 'cogniva.auth.refreshed-at';
const RECENT_WINDOW_MS = 10_000;

let inflight: Promise<boolean> | null = null;

function recentlyRefreshed(): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(RECENT_KEY) ?? 0) < RECENT_WINDOW_MS;
  } catch {
    return false;
  }
}

async function callRefresh(rawFetch: typeof fetch): Promise<boolean> {
  try {
    const res = await rawFetch(REFRESH_PATH, { method: 'POST', credentials: 'include' });
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as {
      user?: unknown;
      accessToken?: string;
    } | null;
    const ok = Boolean(data?.user && data?.accessToken);
    if (ok) {
      try {
        localStorage.setItem(RECENT_KEY, String(Date.now()));
      } catch {}
    }
    return ok;
  } catch {
    return false;
  }
}

function refreshOnce(rawFetch: typeof fetch): Promise<boolean> {
  inflight ??= (async () => {
    if (typeof navigator !== 'undefined' && 'locks' in navigator) {
      return navigator.locks.request('cogniva-refresh', async () => {
        if (recentlyRefreshed()) return true;
        return callRefresh(rawFetch);
      });
    }
    if (recentlyRefreshed()) return true;
    return callRefresh(rawFetch);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

declare global {
  interface Window {
    __cgFetchRefreshInstalled?: boolean;
  }
}

export function installGlobalFetchRefresh(): void {
  if (typeof window === 'undefined') return;
  if (window.__cgFetchRefreshInstalled) return;
  window.__cgFetchRefreshInstalled = true;

  const rawFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const res = await rawFetch(input, init);
    if (res.status !== 401) return res;

    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!url.startsWith('/api/') || url.startsWith('/api/auth/')) return res;
    if (input instanceof Request && init === undefined) return res;

    const refreshed = await refreshOnce(rawFetch);
    if (!refreshed) return res;
    return rawFetch(input, init);
  };
}
