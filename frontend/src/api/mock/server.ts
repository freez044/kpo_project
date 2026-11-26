// Мок-сервер: отвечает на запросы так же, как будет отвечать настоящий бэкенд (docs/contracts.md):
// те же пути, коды, формат ошибок и поля camelCase. Данные лежат в памяти страницы и пропадают
// при перезагрузке. Включён, пока VITE_API_MODE не равен «real» (см. src/api/client.ts).
//
// Тестовый вход: demo@example.com / demo12345

import type { Task, TaskPriority, TaskSection, TaskStatus, User } from '../types';

export const mockSettings = { latencyMs: 150 };

const STATUSES: TaskStatus[] = ['BACKLOG', 'PLANNED', 'IN_PROGRESS', 'IN_HOLD', 'DONE', 'CANCELLED'];
const PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const SECTIONS: TaskSection[] = ['STUDY', 'PERSONAL'];
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

interface StoredUser extends User {
  password: string;
  failedLogins: number;
  lockedUntil: number | null;
}
type StoredTask = Task & { userId: string };

const users: StoredUser[] = [
  {
    id: 'u-demo',
    email: 'demo@example.com',
    password: 'demo12345',
    firstName: 'Иван',
    lastName: 'Иванов',
    studyGroup: 'ПИН-31',
    timezone: 'Europe/Moscow',
    aiHistoryEnabled: true,
    failedLogins: 0,
    lockedUntil: null,
  },
];
const tasks: StoredTask[] = [];
// «Cookie» с refresh-токеном: одно устройство, живёт до перезагрузки страницы.
let refreshOwner: string | null = null;

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public field?: string) {
    super(message);
  }
}

const reply = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let counter = 0;
const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${++counter}`;

const publicUser = ({ password: _p, failedLogins: _f, lockedUntil: _l, ...user }: StoredUser): User => user;

function authResult(user: StoredUser) {
  return { accessToken: `mock-access.${user.id}`, expiresIn: 900, user: publicUser(user) };
}

function currentUser(headers: Record<string, string>): StoredUser {
  const match = /^Bearer mock-access\.(.+)$/.exec(headers.Authorization ?? '');
  const user = match && users.find((u) => u.id === match[1]);
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход в учётную запись');
  return user;
}

// ── проверки (те же правила, что в контракте и в базе) ──────────────────────

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function text(body: any, key: string, label: string, max: number, required = true): string | null {
  const value = body?.[key];
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    if (required) throw new HttpError(422, 'VALIDATION_ERROR', label, key);
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > max) throw new HttpError(422, 'VALIDATION_ERROR', label, key);
  return value.trim();
}

function timezone(value: unknown): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(value) });
    return String(value);
  } catch {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Неизвестный часовой пояс', 'timezone');
  }
}

function deadline(value: unknown): string | null {
  if (value === null) return null;
  const bad = () => new HttpError(422, 'VALIDATION_ERROR', 'Укажите срок в формате даты и времени с часовым поясом', 'deadline');
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) throw bad();
  return new Date(value).toISOString();
}

function duration(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 1440) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Длительность — от 1 до 1440 минут', 'durationMinutes');
  }
  return value as number;
}

function oneOf<T extends string>(value: unknown, list: T[], label: string, field: string): T {
  if (!list.includes(value as T)) throw new HttpError(422, 'VALIDATION_ERROR', label, field);
  return value as T;
}

const isOverdue = (t: Task) =>
  t.deadline !== null && Date.parse(t.deadline) < Date.now() && t.status !== 'DONE' && t.status !== 'CANCELLED';

const publicTask = ({ userId: _u, ...task }: StoredTask): Task => ({ ...task, isOverdue: isOverdue(task) });

// ── маршруты ────────────────────────────────────────────────────────────────

interface Ctx {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
  headers: Record<string, string>;
}

function startSession(user: StoredUser, status: number) {
  refreshOwner = user.id;
  return reply(status, authResult(user));
}

function route({ method, path, query, body, headers }: Ctx): Response {
  // --- вход и выход -------------------------------------------------------
  if (method === 'POST' && path === '/auth/register') {
    const email = (text(body, 'email', 'Укажите корректный email', 254) as string).toLowerCase();
    if (!EMAIL.test(email)) throw new HttpError(422, 'VALIDATION_ERROR', 'Укажите корректный email', 'email');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Пароль должен быть не короче 8 символов', 'password');
    }
    const user: StoredUser = {
      id: newId(),
      email,
      password: body.password,
      firstName: text(body, 'firstName', 'Укажите имя', 100) as string,
      lastName: text(body, 'lastName', 'Укажите фамилию', 100) as string,
      studyGroup: text(body, 'studyGroup', 'Группа не длиннее 50 символов', 50, false),
      timezone: timezone(body.timezone),
      aiHistoryEnabled: true,
      failedLogins: 0,
      lockedUntil: null,
    };
    if (users.some((u) => u.email === email)) {
      throw new HttpError(409, 'EMAIL_TAKEN', 'Этот email уже зарегистрирован', 'email');
    }
    users.push(user);
    return startSession(user, 201);
  }

  if (method === 'POST' && path === '/auth/login') {
    const user = users.find((u) => u.email === String(body?.email ?? '').trim().toLowerCase());
    if (!user) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      const minutes = Math.max(1, Math.ceil((user.lockedUntil - Date.now()) / 60000));
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Слишком много неудачных попыток входа. Повторите через ${minutes} мин.`);
    }
    if (user.password !== body?.password) {
      user.failedLogins += 1;
      if (user.failedLogins >= MAX_FAILED_LOGINS) {
        user.failedLogins = 0;
        user.lockedUntil = Date.now() + LOCK_MINUTES * 60000;
        throw new HttpError(429, 'TOO_MANY_ATTEMPTS', `Слишком много неудачных попыток входа. Повторите через ${LOCK_MINUTES} мин.`);
      }
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
    }
    user.failedLogins = 0;
    user.lockedUntil = null;
    return startSession(user, 200);
  }

  if (method === 'POST' && path === '/auth/refresh') {
    const user = users.find((u) => u.id === refreshOwner);
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Требуется вход в учётную запись');
    return startSession(user, 200);
  }

  if (method === 'POST' && path === '/auth/logout') {
    refreshOwner = null;
    return reply(204);
  }

  // --- дальше нужен вход --------------------------------------------------
  const user = currentUser(headers);

  if (path === '/me' && method === 'GET') return reply(200, publicUser(user));

  if (path === '/me' && method === 'PATCH') {
    const patch: Partial<User> = {};
    if ('firstName' in body) patch.firstName = text(body, 'firstName', 'Укажите имя', 100) as string;
    if ('lastName' in body) patch.lastName = text(body, 'lastName', 'Укажите фамилию', 100) as string;
    if ('studyGroup' in body) patch.studyGroup = text(body, 'studyGroup', 'Группа не длиннее 50 символов', 50, false);
    if ('timezone' in body) patch.timezone = timezone(body.timezone);
    Object.assign(user, patch);
    return reply(200, publicUser(user));
  }

  // --- задачи -------------------------------------------------------------
  if (path === '/tasks' && method === 'GET') {
    let list = tasks.filter((t) => t.userId === user.id).map(publicTask);
    const status = query.get('status');
    const priority = query.get('priority');
    const section = query.get('section');
    const overdue = query.get('overdue');
    if (status) list = list.filter((t) => t.status === status);
    if (priority) list = list.filter((t) => t.priority === priority);
    if (section) list = list.filter((t) => t.section === section);
    if (query.get('goalId')) list = list.filter((t) => t.goalId === query.get('goalId'));
    if (query.get('categoryId')) list = list.filter((t) => t.categoryId === query.get('categoryId'));
    if (overdue) list = list.filter((t) => t.isOverdue === (overdue === 'true'));
    return reply(200, list);
  }

  if (path === '/tasks' && method === 'POST') {
    const now = new Date().toISOString();
    const status = 'status' in body && body.status !== null ? oneOf(body.status, STATUSES, 'Недопустимый статус', 'status') : 'BACKLOG';
    const task: StoredTask = {
      id: newId(),
      userId: user.id,
      title: text(body, 'title', 'Укажите название задачи', 200) as string,
      description: typeof body.description === 'string' ? body.description : '',
      status,
      priority: 'priority' in body && body.priority !== null ? oneOf(body.priority, PRIORITIES, 'Недопустимый приоритет', 'priority') : 'MEDIUM',
      section: 'section' in body && body.section !== null ? oneOf(body.section, SECTIONS, 'Недопустимый раздел', 'section') : 'STUDY',
      deadline: 'deadline' in body ? deadline(body.deadline) : null,
      goalId: null,
      categoryId: null,
      durationMinutes: 'durationMinutes' in body ? duration(body.durationMinutes) : null,
      sortOrder: null,
      source: 'MANUAL',
      completedAt: status === 'DONE' ? now : null,
      isOverdue: false,
      createdAt: now,
      updatedAt: now,
    };
    tasks.push(task);
    return reply(201, publicTask(task));
  }

  const match = /^\/tasks\/([^/]+)$/.exec(path);
  if (match) {
    const task = tasks.find((t) => t.id === match[1] && t.userId === user.id);
    if (!task) throw new HttpError(404, 'NOT_FOUND', 'Задача не найдена');

    if (method === 'GET') return reply(200, publicTask(task));

    if (method === 'DELETE') {
      tasks.splice(tasks.indexOf(task), 1);
      return reply(204);
    }

    if (method === 'PATCH') {
      // Меняются только переданные поля; null очищает необязательное поле.
      const patch: Partial<Task> = {};
      if ('title' in body) patch.title = text(body, 'title', 'Укажите название задачи', 200) as string;
      if ('description' in body) patch.description = typeof body.description === 'string' ? body.description : '';
      if ('status' in body) patch.status = oneOf(body.status, STATUSES, 'Недопустимый статус', 'status');
      if ('priority' in body) patch.priority = oneOf(body.priority, PRIORITIES, 'Недопустимый приоритет', 'priority');
      if ('section' in body) patch.section = oneOf(body.section, SECTIONS, 'Недопустимый раздел', 'section');
      if ('deadline' in body) patch.deadline = deadline(body.deadline);
      if ('durationMinutes' in body) patch.durationMinutes = duration(body.durationMinutes);
      Object.assign(task, patch, { updatedAt: new Date().toISOString() });
      // Как триггер в базе (ФТ-30): DONE ставит completedAt, выход из DONE очищает.
      if (patch.status) task.completedAt = patch.status === 'DONE' ? task.completedAt ?? task.updatedAt : null;
      return reply(200, publicTask(task));
    }
  }

  throw new HttpError(404, 'NOT_FOUND', 'Не найдено');
}

/** Вместо fetch: принимает те же аргументы, что client.ts передаёт настоящему fetch. */
export async function mockFetch(url: string, init: RequestInit = {}): Promise<Response> {
  await new Promise((resolve) => setTimeout(resolve, mockSettings.latencyMs));
  const [pathWithPrefix, queryString = ''] = url.split('?');
  const ctx: Ctx = {
    method: init.method ?? 'GET',
    path: pathWithPrefix.replace(/^\/api\/v1/, ''),
    query: new URLSearchParams(queryString),
    body: typeof init.body === 'string' ? JSON.parse(init.body) : {},
    headers: (init.headers ?? {}) as Record<string, string>,
  };
  try {
    return route(ctx);
  } catch (error) {
    if (error instanceof HttpError) {
      return reply(error.status, {
        error: { code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) },
      });
    }
    throw error;
  }
}
