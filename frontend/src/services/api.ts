import type { Session } from '../types/user';
let accessToken: string | null = null;
let refreshing: Promise<Session> | null = null;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, body?: unknown, token?: string | null, method?: string, timeoutMs = 15000): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/v1' + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(0, 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error?.message || 'Сервер временно недоступен. Попробуйте ещё раз.');
  }
  return response.status === 204 ? undefined as T : response.json();
}

export function authRequest<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, body);
}

export function refresh(): Promise<Session> {
  // One rotation at a time, including StrictMode double mounting.
  if (!refreshing) {
    const rotate = () => request<Session>('/auth/refresh', {});
    const operation = navigator.locks ? navigator.locks.request('planner-refresh', rotate) : rotate();
    refreshing = operation.then(async result => { const session = await result; accessToken = session.accessToken; return session; }).finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiRequest<T>(path: string, method = 'GET', body?: unknown, timeoutMs = 15000): Promise<T> {
  const originalUser = accessToken;
  try { return await request<T>(path, body, accessToken, method, timeoutMs); }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await refresh();
    // A different browser tab may have switched the shared cookie to another account.
    const subject = (token: string | null) => token ? JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub : null;
    if (subject(originalUser) !== subject(accessToken)) {
      window.dispatchEvent(new Event('planner-account-change'));
      throw new ApiError(401, 'Аккаунт изменился в другой вкладке. Откройте своё пространство заново.');
    }
    return request<T>(path, body, accessToken, method, timeoutMs);
  }
}

export function clearAccessToken() { accessToken = null; }
export function setAccessToken(token: string) { accessToken = token; }
export async function logoutSession() {
  if (refreshing) await refreshing.catch(() => undefined);
  await request('/auth/logout', {});
  clearAccessToken();
}
