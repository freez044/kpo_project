import { request, setAccessToken } from './client';
import type { AuthResult, ProfilePatch, RegisterInput, User } from './types';

async function startSession(path: string, body: unknown): Promise<User> {
  const result = await request<AuthResult>(path, { method: 'POST', body, auth: false });
  setAccessToken(result.accessToken);
  return result.user;
}

export const register = (input: RegisterInput) => startSession('/auth/register', input);

export const login = (email: string, password: string) =>
  startSession('/auth/login', { email, password });

/** Выход на этом устройстве; на других устройствах сеанс остаётся. */
export async function logout(): Promise<void> {
  try {
    await request<void>('/auth/logout', { method: 'POST', auth: false });
  } finally {
    setAccessToken(null);
  }
}

export const updateProfile = (patch: ProfilePatch) =>
  request<User>('/me', { method: 'PATCH', body: patch });
