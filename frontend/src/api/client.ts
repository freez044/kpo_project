// HTTP-клиент: единственное место, где браузер ходит на сервер.
//
// Access-токен живёт только в памяти страницы (не в localStorage). Refresh-токен — в HttpOnly-cookie,
// его JavaScript не видит: после перезагрузки страницы сеанс восстанавливает refreshSession().
// Получив 401 UNAUTHORIZED, клиент один раз обновляет сеанс и повторяет запрос.

import { mockFetch } from './mock/server';
import type { AuthResult } from './types';

const BASE = '/api/v1';

/**
 * mock — ответы даёт src/api/mock/server.ts, сервер не нужен, данные не сохраняются;
 * real — запросы идут на настоящий бэкенд (в разработке Vite проксирует /api на 127.0.0.1:8000).
 * Переключается переменной VITE_API_MODE (см. frontend/.env.example); по умолчанию — mock.
 */
export const API_MODE: 'mock' | 'real' = import.meta.env?.VITE_API_MODE === 'real' ? 'real' : 'mock';

const transport: (url: string, init: RequestInit) => Promise<Response> =
  API_MODE === 'mock' ? mockFetch : (url, init) => fetch(url, init);

export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

let accessToken: string | null = null;
let sessionLostHandler: (() => void) | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

/** Вызывается, когда сервер отклонил обновление сеанса: пользователя нужно отправить на вход. */
export function onSessionLost(handler: (() => void) | null) {
  sessionLostHandler = handler;
}

async function send(path: string, method: string, body: unknown, withToken: boolean): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (withToken && accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await transport(BASE + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Нет связи с сервером. Проверьте подключение.');
  }
}

async function readError(res: Response): Promise<ApiError> {
  let code = 'INTERNAL_ERROR';
  let message = 'Что-то пошло не так. Попробуйте ещё раз.';
  let field: string | undefined;
  try {
    const data = await res.json();
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      field = data.error.field ?? undefined;
    }
  } catch {
    // тело не JSON — оставляем сообщение по умолчанию
  }
  return new ApiError(res.status, code, message, field);
}

let refreshing: Promise<AuthResult> | null = null;

/**
 * Обменять refresh-cookie на новый access-токен.
 * Параллельные вызовы делят один запрос: сервер отзывает старый refresh-токен при каждом обновлении,
 * и второй одновременный запрос с тем же токеном был бы отклонён (так бывает, например, в React StrictMode).
 */
export function refreshSession(): Promise<AuthResult> {
  if (!refreshing) {
    refreshing = (async () => {
      const res = await send('/auth/refresh', 'POST', undefined, false);
      if (!res.ok) throw await readError(res);
      const data = (await res.json()) as AuthResult;
      accessToken = data.accessToken;
      return data;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** false — запрос без токена (вход, регистрация, выход). */
  auth?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;

  let res = await send(path, method, body, auth);

  if (res.status === 401 && auth) {
    const error = await readError(res);
    if (error.code !== 'UNAUTHORIZED') throw error;
    try {
      await refreshSession();
    } catch (refreshError) {
      accessToken = null;
      // Выходим только если сервер отказал; при обрыве сети сеанс остаётся, можно повторить позже.
      if (refreshError instanceof ApiError && refreshError.status === 401) sessionLostHandler?.();
      throw error;
    }
    res = await send(path, method, body, auth);
  }

  if (!res.ok) throw await readError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
