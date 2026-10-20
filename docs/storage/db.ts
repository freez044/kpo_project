/**
 * Adaptive AI Planner — локальное хранилище данных пользователя (IndexedDB через Dexie 4).
 *
 * Установка:  npm i dexie dexie-export-import
 * React:      npm i dexie-react-hooks   (хук useLiveQuery для автообновления экранов)
 *
 * Соглашения:
 *  - все даты и время хранятся строками ISO 8601 в UTC ("2026-10-19T18:00:00.000Z"),
 *    поэтому они правильно сортируются в индексах; в интерфейсе показываются в часовом поясе профиля;
 *  - статусы и приоритеты хранятся кодами из таблицы 1 ТЗ;
 *  - длительности хранятся в минутах (целое положительное число);
 *  - необязательные поля отсутствуют в записи (а не равны null), чтобы не попадать в индексы.
 */
import Dexie, { type Table } from 'dexie';
import { exportDB, importInto, peakImportFile } from 'dexie-export-import';

// ───────────────────────────── Коды из таблицы 1 ТЗ ─────────────────────────────

export type GoalStatus = 'ACTIVE' | 'IN_HOLD' | 'COMPLETED' | 'CANCELLED';
export type TaskStatus = 'BACKLOG' | 'PLANNED' | 'IN_PROGRESS' | 'IN_HOLD' | 'DONE' | 'CANCELLED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

// ───────────────────────────────── Сущности ─────────────────────────────────────

/** ФТ-01. Профиль: одна запись с id = 'me'. */
export interface Profile {
  id: 'me';
  name: string;
  studyGroup: string;          // учебная группа для расписания ОРИОКС
  timezone: string;            // IANA, например 'Europe/Moscow'
  aiHistoryEnabled: boolean;   // ФТ-19: пользователь может отключить историю
  createdAt: string;
}

/** ФТ-07. Категория. Название уникально. */
export interface Category {
  id?: number;
  name: string;
  color?: string;              // '#RRGGBB'
}

/** ФТ-05. Цель. */
export interface Goal {
  id?: number;
  title: string;
  description: string;
  status: GoalStatus;
  deadline?: string;
  categoryId?: number;
  estimateMinutes?: number;    // хранится отдельно от оценок задач (ФТ-05)
  createdAt: string;
  updatedAt: string;
}

/** ФТ-03, ФТ-04, ФТ-06. Задача. */
export interface Task {
  id?: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: Priority;
  deadline?: string;
  goalId?: number;
  categoryId?: number;
  estimateMinutes?: number;
  order?: number;              // порядок внутри цели (из декомпозиции ИИ, ФТ-17)
  completedAt?: string;        // ставится при переходе в DONE, удаляется при выходе из DONE (ФТ-04)
  source: 'manual' | 'ai';     // создана вручную или по подтверждённому предложению ИИ
  createdAt: string;
  updatedAt: string;
}

/** ФТ-10. Личное событие или запланированный интервал задачи в календаре. */
export interface CalendarEvent {
  id?: number;
  kind: 'personal' | 'task_slot';
  title: string;
  start: string;
  end: string;                 // всегда позже start (НД-04)
  description?: string;
  taskId?: number;             // только для kind = 'task_slot'
}

/** ФТ-11. Учебное занятие из ОРИОКС или файла расписания. Только для просмотра. */
export interface Lesson {
  id?: number;
  subject: string;
  lessonType?: string;         // лекция, семинар, лабораторная
  room?: string;
  teacher?: string;
  start: string;
  end: string;
  source: 'orioks' | 'file';
}

/** ФТ-12. Учебное задание / контрольное мероприятие из ОРИОКС. Ключ — id из ОРИОКС. */
export interface Assignment {
  externalId: string;
  subject: string;
  title: string;
  deadline?: string;
  isDone?: boolean;            // если ОРИОКС отдаёт признак выполнения
  fetchedAt: string;
}

/** ФТ-14. Рабочая сессия. Активная сессия — без endedAt. */
export interface WorkSession {
  id?: number;
  taskId: number;
  startedAt: string;
  endedAt?: string;
  note?: string;
}

/** ФТ-15. Файл, прикреплённый ровно к одному объекту: задаче или цели. */
export interface StoredFile {
  id?: number;
  ownerType: 'task' | 'goal';
  ownerId: number;
  name: string;
  mimeType: string;
  size: number;                // байты; лимиты — приложение В ТЗ
  data: Blob;
  createdAt: string;
}

/** ФТ-19. История запросов к ИИ — заодно датасет для будущей собственной модели. */
export interface AiHistoryEntry {
  id?: number;
  kind: 'command' | 'decompose';            // ФТ-16 или ФТ-17
  requestText: string;
  context?: unknown;                         // что ещё отправили модели (без содержимого файлов)
  proposal: unknown;                         // ответ ИИ после проверки формата (ФТ-18)
  finalResult?: unknown;                     // что пользователь в итоге подтвердил
  outcome: 'pending' | 'accepted' | 'edited' | 'rejected' | 'error';
  model: string;                             // какая модель отвечала (API сейчас, своя позже)
  latencyMs?: number;
  createdAt: string;
}

// ─────────────────────────────── База данных ────────────────────────────────────

export class PlannerDB extends Dexie {
  profile!: Table<Profile, 'me'>;
  categories!: Table<Category, number>;
  goals!: Table<Goal, number>;
  tasks!: Table<Task, number>;
  events!: Table<CalendarEvent, number>;
  lessons!: Table<Lesson, number>;
  assignments!: Table<Assignment, string>;
  sessions!: Table<WorkSession, number>;
  files!: Table<StoredFile, number>;
  aiHistory!: Table<AiHistoryEntry, number>;

  constructor() {
    super('adaptive-ai-planner');
    // Первый ключ — первичный (++ = автоинкремент, & = уникальный), остальные — индексы.
    // Индексируются только поля, по которым ищем или сортируем; остальные поля хранятся без объявления.
    // При изменении схемы добавляйте this.version(2).stores({...}).upgrade(...) — старые версии не трогать.
    this.version(1).stores({
      profile:     'id',
      categories:  '++id, &name',
      goals:       '++id, status, categoryId, deadline',
      tasks:       '++id, status, priority, goalId, categoryId, deadline, [goalId+order]',
      events:      '++id, kind, start, end, taskId',
      lessons:     '++id, start, source',
      assignments: 'externalId, deadline, subject',
      sessions:    '++id, taskId, startedAt',
      files:       '++id, [ownerType+ownerId]',
      aiHistory:   '++id, createdAt, kind, outcome',
    });
  }
}

export const db = new PlannerDB();

// ───────────────────────────────── Утилиты ──────────────────────────────────────

export const nowIso = () => new Date().toISOString();

/** Ошибка проверки данных с текстом для пользователя (НД-04). */
export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}

function checkInterval(start: string, end: string) {
  if (!(Date.parse(end) > Date.parse(start))) {
    throw new ValidationError('Время окончания должно быть позже времени начала.');
  }
}

function checkEstimate(minutes?: number) {
  if (minutes !== undefined && !(Number.isInteger(minutes) && minutes > 0)) {
    throw new ValidationError('Оценка длительности должна быть положительным целым числом минут.');
  }
}

function checkRequired(value: string | undefined, field: string) {
  if (!value || !value.trim()) throw new ValidationError(`Поле «${field}» обязательно.`);
}

/** Переводит ошибки IndexedDB в понятные сообщения (НД-02, ФТ-07). */
export function describeDbError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (e instanceof ValidationError) return e.message;
  if (name === 'QuotaExceededError') return 'В браузере закончилось место. Удалите ненужные файлы или сохраните резервную копию.';
  if (name === 'ConstraintError') return 'Запись с таким названием уже существует.';
  return 'Не удалось сохранить данные. Попробуйте ещё раз.';
}

// ─────────────────────── Запуск и защита от удаления данных ─────────────────────

/**
 * Вызывать один раз при старте приложения.
 * Просит браузер не удалять хранилище при нехватке места (важно для Safari и мобильных браузеров).
 */
export async function initStorage(): Promise<{ persisted: boolean; usage?: number; quota?: number }> {
  await db.open();
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const persisted = (await storage?.persisted?.()) || (await storage?.persist?.()) || false;
  const est = await storage?.estimate?.();
  return { persisted, usage: est?.usage, quota: est?.quota };
}

// ───────────────────────────────── Задачи ───────────────────────────────────────

export async function createTask(
  data: Omit<Task, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'completedAt' | 'source'> &
        Partial<Pick<Task, 'source'>>,
): Promise<number> {
  checkRequired(data.title, 'Название');
  checkEstimate(data.estimateMinutes);
  const ts = nowIso();
  return db.tasks.add({ source: 'manual', ...data, status: 'BACKLOG', createdAt: ts, updatedAt: ts });
}

/** ФТ-04: смена статуса с учётом даты завершения. */
export async function setTaskStatus(taskId: number, status: TaskStatus): Promise<void> {
  await db.tasks.where(':id').equals(taskId).modify((t) => {
    if (status === 'DONE' && t.status !== 'DONE') t.completedAt = nowIso();
    if (status !== 'DONE') delete t.completedAt;
    t.status = status;
    t.updatedAt = nowIso();
  });
}

/** ФТ-04: просроченность вычисляется, а не хранится. */
export function isOverdue(t: Task, now = Date.now()): boolean {
  return !!t.deadline && Date.parse(t.deadline) < now && t.status !== 'DONE' && t.status !== 'CANCELLED';
}

/** ФТ-03 + НД-03: задача удаляется вместе с интервалами, сессиями и файлами — одной транзакцией. */
export async function deleteTask(taskId: number): Promise<void> {
  await db.transaction('rw', [db.tasks, db.events, db.sessions, db.files], async () => {
    await db.events.where('taskId').equals(taskId).delete();
    await db.sessions.where('taskId').equals(taskId).delete();
    await db.files.where('[ownerType+ownerId]').equals(['task', taskId]).delete();
    await db.tasks.delete(taskId);
  });
}

// ────────────────────────────────── Цели ────────────────────────────────────────

/** ФТ-05 + НД-03: задачи цели остаются самостоятельными, файлы цели удаляются. */
export async function deleteGoal(goalId: number): Promise<void> {
  await db.transaction('rw', [db.goals, db.tasks, db.files], async () => {
    await db.tasks.where('goalId').equals(goalId).modify((t) => {
      delete t.goalId;
      delete t.order;
      t.updatedAt = nowIso();
    });
    await db.files.where('[ownerType+ownerId]').equals(['goal', goalId]).delete();
    await db.goals.delete(goalId);
  });
}

/** ФТ-06: прогресс = выполненные / все неотменённые задачи цели. */
export async function goalProgress(goalId: number): Promise<{ done: number; total: number; percent: number }> {
  const tasks = await db.tasks.where('goalId').equals(goalId).toArray();
  const active = tasks.filter((t) => t.status !== 'CANCELLED');
  const done = active.filter((t) => t.status === 'DONE').length;
  return { done, total: active.length, percent: active.length ? Math.round((done / active.length) * 100) : 0 };
}

/**
 * ФТ-17 + ФТ-18: создать задачи из подтверждённого предложения ИИ одной транзакцией
 * и отметить итог в истории (ФТ-19).
 */
export async function applyDecomposition(
  goalId: number,
  tasks: Array<Pick<Task, 'title' | 'description' | 'priority' | 'estimateMinutes'>>,
  historyId?: number,
  edited = false,
): Promise<number[]> {
  tasks.forEach((t) => { checkRequired(t.title, 'Название'); checkEstimate(t.estimateMinutes); });
  return db.transaction('rw', [db.goals, db.tasks, db.aiHistory], async () => {
    if (!(await db.goals.get(goalId))) throw new ValidationError('Цель не найдена.');
    const ts = nowIso();
    const ids = (await db.tasks.bulkAdd(
      tasks.map((t, i) => ({
        ...t, goalId, order: i + 1, status: 'BACKLOG' as const, source: 'ai' as const, createdAt: ts, updatedAt: ts,
      })),
      { allKeys: true },
    )) as number[];
    if (historyId !== undefined) {
      await db.aiHistory.update(historyId, { outcome: edited ? 'edited' : 'accepted', finalResult: tasks });
    }
    return ids;
  });
}

// ──────────────────────────────── Категории ─────────────────────────────────────

/** ФТ-07: после удаления категории цели и задачи остаются без категории. */
export async function deleteCategory(categoryId: number): Promise<void> {
  await db.transaction('rw', [db.categories, db.goals, db.tasks], async () => {
    await db.goals.where('categoryId').equals(categoryId).modify((g) => { delete g.categoryId; });
    await db.tasks.where('categoryId').equals(categoryId).modify((t) => { delete t.categoryId; });
    await db.categories.delete(categoryId);
  });
}

// ──────────────────────────────── Календарь ─────────────────────────────────────

export async function addEvent(e: Omit<CalendarEvent, 'id'>): Promise<number> {
  checkRequired(e.title, 'Название');
  checkInterval(e.start, e.end);
  if (e.kind === 'task_slot' && (e.taskId === undefined || !(await db.tasks.get(e.taskId)))) {
    throw new ValidationError('Интервал должен быть связан с существующей задачей.');
  }
  return db.events.add(e);
}

/** События, занятия и интервалы, пересекающие отрезок [from, to) — для экранов «день» и «неделя». */
export async function calendarRange(from: string, to: string) {
  const [events, lessons] = await Promise.all([
    db.events.where('start').below(to).filter((e) => e.end > from).toArray(),
    db.lessons.where('start').below(to).filter((l) => l.end > from).toArray(),
  ]);
  return { events, lessons };
}

/** ФТ-10: пересечения по времени (нестрогие границы: встреча «10:00–11:00» и «11:00–12:00» не конфликтуют). */
export function findOverlaps<T extends { start: string; end: string }>(items: T[]): Array<[T, T]> {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const result: Array<[T, T]> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      result.push([sorted[i], sorted[j]]);
    }
  }
  return result;
}

/** ФТ-11: новое расписание полностью заменяет старое из того же источника. */
export async function replaceLessons(source: Lesson['source'], lessons: Omit<Lesson, 'id' | 'source'>[]) {
  lessons.forEach((l) => checkInterval(l.start, l.end));
  await db.transaction('rw', db.lessons, async () => {
    await db.lessons.where('source').equals(source).delete();
    await db.lessons.bulkAdd(lessons.map((l) => ({ ...l, source })));
  });
}

/** ФТ-12: задания из ОРИОКС обновляются по их внешнему id. */
export async function upsertAssignments(items: Omit<Assignment, 'fetchedAt'>[]) {
  const ts = nowIso();
  await db.assignments.bulkPut(items.map((a) => ({ ...a, fetchedAt: ts })));
}

// ───────────────────────────── Рабочие сессии ───────────────────────────────────

export async function startSession(taskId: number): Promise<number> {
  return db.transaction('rw', [db.sessions, db.tasks], async () => {
    if (!(await db.tasks.get(taskId))) throw new ValidationError('Задача не найдена.');
    const active = await db.sessions.where('taskId').equals(taskId).filter((s) => !s.endedAt).count();
    if (active) throw new ValidationError('По этой задаче уже идёт рабочая сессия.');
    return db.sessions.add({ taskId, startedAt: nowIso() });
  });
}

export async function stopSession(sessionId: number, note?: string): Promise<void> {
  await db.sessions.where(':id').equals(sessionId).modify((s) => {
    s.endedAt = nowIso();
    if (note) s.note = note;
  });
}

/** Активная сессия для главной страницы (ФТ-09). Таблица небольшая, полный проход допустим. */
export const getActiveSession = () => db.sessions.filter((s) => !s.endedAt).first();

/** ФТ-14: фактическое время по завершённым сессиям, в минутах. */
export async function actualMinutes(taskId: number): Promise<number> {
  const sessions = await db.sessions.where('taskId').equals(taskId).toArray();
  const ms = sessions
    .filter((s) => s.endedAt)
    .reduce((sum, s) => sum + (Date.parse(s.endedAt!) - Date.parse(s.startedAt)), 0);
  return Math.round(ms / 60000);
}

// ───────────────────────────────── Файлы ────────────────────────────────────────

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // уточнить по приложению В

export async function attachFile(ownerType: StoredFile['ownerType'], ownerId: number, file: File): Promise<number> {
  if (file.size > MAX_FILE_BYTES) throw new ValidationError('Файл слишком большой.');
  const owner = ownerType === 'task' ? await db.tasks.get(ownerId) : await db.goals.get(ownerId);
  if (!owner) throw new ValidationError('Объект для прикрепления не найден.');
  return db.files.add({
    ownerType, ownerId, name: file.name, mimeType: file.type || 'application/octet-stream',
    size: file.size, data: file, createdAt: nowIso(),
  });
}

/** ФТ-15: файлы задачи и её цели в карточке задачи — без копирования. */
export async function filesForTaskCard(taskId: number): Promise<StoredFile[]> {
  const task = await db.tasks.get(taskId);
  const own = await db.files.where('[ownerType+ownerId]').equals(['task', taskId]).toArray();
  const goal = task?.goalId !== undefined
    ? await db.files.where('[ownerType+ownerId]').equals(['goal', task.goalId]).toArray()
    : [];
  return [...own, ...goal];
}

// ──────────────────────────── История ИИ (ФТ-19) ────────────────────────────────

/** Возвращает id записи или undefined, если пользователь отключил историю. */
export async function logAiRequest(e: Omit<AiHistoryEntry, 'id' | 'createdAt' | 'outcome'>): Promise<number | undefined> {
  const profile = await db.profile.get('me');
  if (profile && !profile.aiHistoryEnabled) return undefined;
  return db.aiHistory.add({ ...e, outcome: 'pending', createdAt: nowIso() });
}

/** Выгрузка истории в отдельный JSON-файл, чтобы пользователь мог передать её разработчикам. */
export async function exportAiHistory(): Promise<Blob> {
  const rows = await db.aiHistory.orderBy('createdAt').toArray();
  return new Blob([JSON.stringify({ format: 'aap-ai-history', version: 1, rows }, null, 2)], { type: 'application/json' });
}

// ──────────────────────── Резервная копия (ФТ-02, НД-04) ────────────────────────

/** Все данные, включая файлы (Blob кодируются в base64). */
export async function exportBackup(): Promise<Blob> {
  return exportDB(db, { prettyJson: false });
}

/**
 * Восстановление из файла. Сначала проверяет, что это наша резервная копия;
 * перед импортом делает снимок текущих данных и при ошибке возвращает их обратно,
 * поэтому повреждённый файл не затирает данные пользователя.
 */
export async function restoreBackup(file: Blob): Promise<void> {
  let meta;
  try {
    meta = await peakImportFile(file);
  } catch {
    throw new ValidationError('Файл не является резервной копией Adaptive AI Planner.');
  }
  if (meta.formatName !== 'dexie' || meta.data.databaseName !== db.name) {
    throw new ValidationError('Файл не является резервной копией Adaptive AI Planner.');
  }
  if (meta.data.databaseVersion > db.verno) {
    throw new ValidationError('Резервная копия создана более новой версией приложения.');
  }
  const snapshot = await exportDB(db, { prettyJson: false });
  try {
    await importInto(db, file, { clearTablesBeforeImport: true, acceptVersionDiff: true });
  } catch (e) {
    await importInto(db, snapshot, { clearTablesBeforeImport: true });
    throw new ValidationError('Не удалось восстановить данные: файл повреждён. Текущие данные не изменены.');
  }
}

/** ФТ-02: удалить все данные пользователя из браузера (после подтверждения в интерфейсе). */
export async function deleteAllData(): Promise<void> {
  await db.delete();
  await db.open(); // пересоздаёт пустую базу с актуальной схемой
}
