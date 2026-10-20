/**
 * Adaptive AI Planner — локальное хранилище данных пользователя (IndexedDB через Dexie 4).
 *
 * Модель данных: database/data_model.md (основа — диаграмма классов CL-01).
 * Имена типов и полей совпадают с классами диаграммы. Номера ФТ — по ТЗ v11.
 *
 * Установка:  npm i dexie dexie-export-import
 * React:      npm i dexie-react-hooks   (хук useLiveQuery для автообновления экранов)
 *
 * Соглашения:
 *  - все даты и время хранятся строками ISO 8601 в UTC ("2026-10-19T18:00:00.000Z"),
 *    поэтому они правильно сортируются в индексах; в интерфейсе показываются в часовом поясе профиля;
 *  - статусы, приоритеты и другие перечисления хранятся кодами (таблица 1 ТЗ и data_model.md);
 *  - длительность хранится в минутах (целое положительное число);
 *  - необязательные поля отсутствуют в записи (а не равны null), чтобы не попадать в индексы.
 */
import Dexie, { type Table } from 'dexie';
import { exportDB, importInto, peakImportFile } from 'dexie-export-import';

// ──────────────────────────────── Перечисления ──────────────────────────────────

export type TaskStatus = 'BACKLOG' | 'PLANNED' | 'IN_PROGRESS' | 'IN_HOLD' | 'DONE' | 'CANCELLED';
export type GoalStatus = 'ACTIVE' | 'IN_HOLD' | 'COMPLETED' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TaskSource = 'MANUAL' | 'AI';
export type LessonSource = 'ORIOKS' | 'FILE';
export type ProposalKind = 'COMMAND' | 'DECOMPOSE';
export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'EDITED' | 'REJECTED';

// ───────────────────────────────── Сущности ─────────────────────────────────────

/** ФТ-01. Профиль пользователя: единственная запись с id = 'me'. */
export interface UserProfile {
  id: 'me';
  firstName: string;
  lastName: string;
  studyGroup: string;          // учебная группа для расписания ОРИОКС
  timezone: string;            // IANA, например 'Europe/Moscow'
  aiHistoryEnabled: boolean;   // ФТ-40: пользователь может отключить историю запросов к ИИ
  createdAt: string;
  updatedAt: string;
}

/** ФТ-14. Категория. Название уникально. */
export interface Category {
  id?: number;
  name: string;
  color?: string;              // '#RRGGBB'
}

/** ФТ-10. Цель. */
export interface Goal {
  id?: number;
  title: string;
  description: string;
  status: GoalStatus;
  deadline?: string;
  categoryId?: number;
  durationMinutes?: number;    // необязательна, хранится отдельно от длительностей задач (ФТ-10)
  createdAt: string;
  updatedAt: string;
}

/** ФТ-06, ФТ-07. Задача. */
export interface Task {
  id?: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  deadline?: string;
  goalId?: number;
  categoryId?: number;
  durationMinutes?: number;
  order?: number;              // порядок внутри цели (из декомпозиции ИИ, ФТ-37)
  source: TaskSource;          // создана вручную или по подтверждённому предложению ИИ
  completedAt?: string;        // ставится при переходе в DONE, удаляется при выходе из DONE (ФТ-30)
  createdAt: string;
  updatedAt: string;
}

/** Общие поля элементов календаря (абстрактный класс CalendarItem). */
export interface CalendarItem {
  id?: number;
  title: string;
  startAt: string;
  endAt: string;               // всегда позже startAt (НД-04)
}

/** ФТ-22. Личное событие пользователя. */
export interface CalendarEvent extends CalendarItem {
  description?: string;
}

/** ФТ-22. Интервал выполнения задачи в календаре. */
export interface ScheduleItem extends CalendarItem {
  taskId: number;
}

/** ФТ-23, ФТ-24. Учебное занятие из ОРИОКС или файла расписания. Только для просмотра. */
export interface AcademicLesson extends CalendarItem {
  discipline: string;
  lessonType?: string;         // лекция, семинар, лабораторная
  room?: string;
  teacher?: string;
  source: LessonSource;
}

/** ФТ-26. Учебное задание / контрольное мероприятие из ОРИОКС. Ключ — id из ОРИОКС. */
export interface AcademicAssignment {
  externalId: string;
  discipline: string;
  title: string;
  deadline?: string;
  isDone?: boolean;            // если ОРИОКС отдаёт признак выполнения
  fetchedAt: string;
}

/** ФТ-32. Файл, прикреплённый ровно к одному объекту: задаче (taskId) или цели (goalId). */
export interface FileAttachment {
  id?: number;
  taskId?: number;
  goalId?: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;           // лимиты — приложение В ТЗ
  data: Blob;
  createdAt: string;
}

/** ФТ-35–ФТ-40. Предложение ИИ и запись истории запросов (заодно датасет для будущей собственной модели). */
export interface AIProposal {
  id?: number;
  kind: ProposalKind;          // COMMAND — ФТ-36, DECOMPOSE — ФТ-37
  requestText: string;
  context?: unknown;           // что ещё отправили модели (без содержимого файлов)
  responseData: unknown;       // ответ ИИ после проверки формата (ФТ-38)
  finalData?: unknown;         // что пользователь в итоге подтвердил
  status: ProposalStatus;
  model: string;               // какая модель отвечала (внешний API сейчас, своя позже)
  latencyMs?: number;
  createdAt: string;
}

// ─────────────────────────────── База данных ────────────────────────────────────

export class PlannerDB extends Dexie {
  profile!: Table<UserProfile, 'me'>;
  categories!: Table<Category, number>;
  goals!: Table<Goal, number>;
  tasks!: Table<Task, number>;
  calendarEvents!: Table<CalendarEvent, number>;
  scheduleItems!: Table<ScheduleItem, number>;
  academicLessons!: Table<AcademicLesson, number>;
  academicAssignments!: Table<AcademicAssignment, string>;
  fileAttachments!: Table<FileAttachment, number>;
  aiProposals!: Table<AIProposal, number>;

  constructor() {
    super('adaptive-ai-planner');
    // Первый ключ — первичный (++ = автоинкремент, & = уникальный), остальные — индексы.
    // Индексируются только поля, по которым ищем или сортируем; остальные поля хранятся без объявления.
    // При изменении схемы добавляйте this.version(2).stores({...}).upgrade(...) — старые версии не трогать.
    this.version(1).stores({
      profile:             'id',
      categories:          '++id, &name',
      goals:               '++id, status, categoryId, deadline',
      tasks:               '++id, status, priority, goalId, categoryId, deadline, [goalId+order]',
      calendarEvents:      '++id, startAt, endAt',
      scheduleItems:       '++id, taskId, startAt, endAt',
      academicLessons:     '++id, startAt, source',
      academicAssignments: 'externalId, deadline, discipline',
      fileAttachments:     '++id, taskId, goalId',
      aiProposals:         '++id, createdAt, kind, status',
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

function checkInterval(startAt: string, endAt: string) {
  if (!(Date.parse(endAt) > Date.parse(startAt))) {
    throw new ValidationError('Время окончания должно быть позже времени начала.');
  }
}

function checkDuration(minutes?: number) {
  if (minutes !== undefined && !(Number.isInteger(minutes) && minutes > 0)) {
    throw new ValidationError('Длительность должна быть положительным целым числом минут.');
  }
}

function checkRequired(value: string | undefined, field: string) {
  if (!value || !value.trim()) throw new ValidationError(`Поле «${field}» обязательно.`);
}

/** Переводит ошибки IndexedDB в понятные сообщения (НД-02, ФТ-14). */
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

// ───────────────────────────────── Профиль ──────────────────────────────────────

/** ФТ-01: создать или изменить профиль. */
export async function saveProfile(
  data: Pick<UserProfile, 'firstName' | 'lastName' | 'studyGroup' | 'timezone'> &
        Partial<Pick<UserProfile, 'aiHistoryEnabled'>>,
): Promise<void> {
  checkRequired(data.firstName, 'Имя');
  checkRequired(data.lastName, 'Фамилия');
  checkRequired(data.studyGroup, 'Учебная группа');
  checkRequired(data.timezone, 'Часовой пояс');
  const ts = nowIso();
  const old = await db.profile.get('me');
  await db.profile.put({
    aiHistoryEnabled: old?.aiHistoryEnabled ?? true,
    ...data,
    id: 'me',
    createdAt: old?.createdAt ?? ts,
    updatedAt: ts,
  });
}

// ───────────────────────────────── Задачи ───────────────────────────────────────

export async function createTask(
  data: Omit<Task, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'completedAt' | 'source'> &
        Partial<Pick<Task, 'source'>>,
): Promise<number> {
  checkRequired(data.title, 'Название');
  checkDuration(data.durationMinutes);
  const ts = nowIso();
  return db.tasks.add({ source: 'MANUAL', ...data, status: 'BACKLOG', createdAt: ts, updatedAt: ts });
}

/** ФТ-30: смена статуса с учётом даты завершения (Task.changeStatus). */
export async function setTaskStatus(taskId: number, status: TaskStatus): Promise<void> {
  await db.tasks.where(':id').equals(taskId).modify((t) => {
    if (status === 'DONE' && t.status !== 'DONE') t.completedAt = nowIso();
    if (status !== 'DONE') delete t.completedAt;
    t.status = status;
    t.updatedAt = nowIso();
  });
}

/** ФТ-31: просроченность вычисляется, а не хранится (Task.isOverdue). */
export function isOverdue(t: Task, now = Date.now()): boolean {
  return !!t.deadline && Date.parse(t.deadline) < now && t.status !== 'DONE' && t.status !== 'CANCELLED';
}

/** ФТ-09: что будет удалено вместе с задачей — для окна подтверждения. */
export async function taskDeletionPreview(taskId: number) {
  const [scheduleItems, files] = await Promise.all([
    db.scheduleItems.where('taskId').equals(taskId).count(),
    db.fileAttachments.where('taskId').equals(taskId).count(),
  ]);
  return { scheduleItems, files };
}

/** ФТ-09 + НД-03: задача удаляется вместе с интервалами и файлами — одной транзакцией. */
export async function deleteTask(taskId: number): Promise<void> {
  await db.transaction('rw', [db.tasks, db.scheduleItems, db.fileAttachments], async () => {
    await db.scheduleItems.where('taskId').equals(taskId).delete();
    await db.fileAttachments.where('taskId').equals(taskId).delete();
    await db.tasks.delete(taskId);
  });
}

// ────────────────────────────────── Цели ────────────────────────────────────────

/** ФТ-13: что изменится при удалении цели — для окна подтверждения. */
export async function goalDeletionPreview(goalId: number) {
  const [tasks, files] = await Promise.all([
    db.tasks.where('goalId').equals(goalId).count(),
    db.fileAttachments.where('goalId').equals(goalId).count(),
  ]);
  return { tasks, files };
}

/** ФТ-13 + НД-03: задачи цели остаются самостоятельными, файлы цели удаляются. */
export async function deleteGoal(goalId: number): Promise<void> {
  await db.transaction('rw', [db.goals, db.tasks, db.fileAttachments], async () => {
    await db.tasks.where('goalId').equals(goalId).modify((t) => {
      delete t.goalId;
      delete t.order;
      t.updatedAt = nowIso();
    });
    await db.fileAttachments.where('goalId').equals(goalId).delete();
    await db.goals.delete(goalId);
  });
}

/** ФТ-12: прогресс = выполненные / все неотменённые задачи цели (Goal.calculateProgress). */
export async function goalProgress(goalId: number): Promise<{ done: number; total: number; percent: number }> {
  const tasks = await db.tasks.where('goalId').equals(goalId).toArray();
  const active = tasks.filter((t) => t.status !== 'CANCELLED');
  const done = active.filter((t) => t.status === 'DONE').length;
  return { done, total: active.length, percent: active.length ? Math.round((done / active.length) * 100) : 0 };
}

/**
 * ФТ-37 + ФТ-39: создать задачи из подтверждённого предложения ИИ одной транзакцией
 * и отметить итог в истории (ФТ-40).
 */
export async function applyDecomposition(
  goalId: number,
  tasks: Array<Pick<Task, 'title' | 'description' | 'priority' | 'durationMinutes'>>,
  proposalId?: number,
  edited = false,
): Promise<number[]> {
  tasks.forEach((t) => { checkRequired(t.title, 'Название'); checkDuration(t.durationMinutes); });
  return db.transaction('rw', [db.goals, db.tasks, db.aiProposals], async () => {
    if (!(await db.goals.get(goalId))) throw new ValidationError('Цель не найдена.');
    const ts = nowIso();
    const ids = (await db.tasks.bulkAdd(
      tasks.map((t, i) => ({
        ...t, goalId, order: i + 1, status: 'BACKLOG' as const, source: 'AI' as const, createdAt: ts, updatedAt: ts,
      })),
      { allKeys: true },
    )) as number[];
    if (proposalId !== undefined) {
      await db.aiProposals.update(proposalId, { status: edited ? 'EDITED' : 'ACCEPTED', finalData: tasks });
    }
    return ids;
  });
}

// ──────────────────────────────── Категории ─────────────────────────────────────

/** ФТ-16: после удаления категории цели и задачи остаются без категории. */
export async function deleteCategory(categoryId: number): Promise<void> {
  await db.transaction('rw', [db.categories, db.goals, db.tasks], async () => {
    await db.goals.where('categoryId').equals(categoryId).modify((g) => { delete g.categoryId; });
    await db.tasks.where('categoryId').equals(categoryId).modify((t) => { delete t.categoryId; });
    await db.categories.delete(categoryId);
  });
}

// ──────────────────────────────── Календарь ─────────────────────────────────────

/** ФТ-22: личное событие. */
export async function addCalendarEvent(e: Omit<CalendarEvent, 'id'>): Promise<number> {
  checkRequired(e.title, 'Название');
  checkInterval(e.startAt, e.endAt);
  return db.calendarEvents.add(e);
}

/** ФТ-22: интервал выполнения задачи. */
export async function addScheduleItem(s: Omit<ScheduleItem, 'id'>): Promise<number> {
  checkRequired(s.title, 'Название');
  checkInterval(s.startAt, s.endAt);
  return db.transaction('rw', [db.tasks, db.scheduleItems], async () => {
    if (!(await db.tasks.get(s.taskId))) {
      throw new ValidationError('Интервал должен быть связан с существующей задачей.');
    }
    return db.scheduleItems.add(s);
  });
}

/** ФТ-22: перенос события или интервала. */
export async function moveCalendarItem(
  table: 'calendarEvents' | 'scheduleItems', id: number, startAt: string, endAt: string,
): Promise<void> {
  checkInterval(startAt, endAt);
  const updated = await db[table].update(id, { startAt, endAt });
  if (!updated) throw new ValidationError('Запись календаря не найдена.');
}

/** ФТ-21: события, интервалы и занятия, пересекающие отрезок [from, to) — для режимов «день» и «неделя». */
export async function calendarRange(from: string, to: string) {
  const overlaps = <T extends CalendarItem>(t: Table<T, number>) =>
    t.where('startAt').below(to).filter((x) => x.endAt > from).toArray();
  const [events, scheduleItems, lessons] = await Promise.all([
    overlaps(db.calendarEvents), overlaps(db.scheduleItems), overlaps(db.academicLessons),
  ]);
  return { events, scheduleItems, lessons };
}

/** ФТ-25: пересечения по времени (нестрогие границы: «10:00–11:00» и «11:00–12:00» не конфликтуют). */
export function findOverlaps<T extends { startAt: string; endAt: string }>(items: T[]): Array<[T, T]> {
  const sorted = [...items].sort((a, b) => a.startAt.localeCompare(b.startAt));
  const result: Array<[T, T]> = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].startAt < sorted[i].endAt; j++) {
      result.push([sorted[i], sorted[j]]);
    }
  }
  return result;
}

/** ФТ-23, ФТ-24: новое расписание полностью заменяет старое из того же источника. */
export async function replaceLessons(source: LessonSource, lessons: Omit<AcademicLesson, 'id' | 'source'>[]) {
  lessons.forEach((l) => checkInterval(l.startAt, l.endAt));
  await db.transaction('rw', db.academicLessons, async () => {
    await db.academicLessons.where('source').equals(source).delete();
    await db.academicLessons.bulkAdd(lessons.map((l) => ({ ...l, source })));
  });
}

/** ФТ-26: задания из ОРИОКС обновляются по их внешнему id. */
export async function upsertAssignments(items: Omit<AcademicAssignment, 'fetchedAt'>[]) {
  const ts = nowIso();
  await db.academicAssignments.bulkPut(items.map((a) => ({ ...a, fetchedAt: ts })));
}

// ───────────────────────────────── Файлы ────────────────────────────────────────

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // уточнить по приложению В

/** ФТ-32, ФТ-34: прикрепить файл ровно к одному объекту — задаче или цели. */
export async function attachFile(owner: { taskId: number } | { goalId: number }, file: File): Promise<number> {
  if (file.size > MAX_FILE_BYTES) throw new ValidationError('Файл слишком большой.');
  return db.transaction('rw', [db.tasks, db.goals, db.fileAttachments], async () => {
    const exists = 'taskId' in owner ? await db.tasks.get(owner.taskId) : await db.goals.get(owner.goalId);
    if (!exists) throw new ValidationError('Объект для прикрепления не найден.');
    return db.fileAttachments.add({
      ...owner, originalName: file.name, mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size, data: file, createdAt: nowIso(),
    });
  });
}

/** ФТ-33: файлы задачи и её цели в карточке задачи — без копирования. */
export async function filesForTaskCard(taskId: number): Promise<FileAttachment[]> {
  const task = await db.tasks.get(taskId);
  const own = await db.fileAttachments.where('taskId').equals(taskId).toArray();
  const goal = task?.goalId !== undefined
    ? await db.fileAttachments.where('goalId').equals(task.goalId).toArray()
    : [];
  return [...own, ...goal];
}

// ───────────────────────── Предложения и история ИИ (ФТ-40) ─────────────────────

/** Сохраняет проверенное предложение. Возвращает id или undefined, если пользователь отключил историю. */
export async function saveProposal(
  p: Omit<AIProposal, 'id' | 'createdAt' | 'status' | 'finalData'>,
): Promise<number | undefined> {
  const profile = await db.profile.get('me');
  if (profile && !profile.aiHistoryEnabled) return undefined;
  return db.aiProposals.add({ ...p, status: 'PENDING', createdAt: nowIso() });
}

/** ФТ-39: пользователь подтвердил предложение (как есть или с правками) — AIProposal.confirm. */
export async function confirmProposal(id: number, finalData: unknown, edited: boolean): Promise<void> {
  await db.aiProposals.update(id, { status: edited ? 'EDITED' : 'ACCEPTED', finalData });
}

/** ФТ-39: пользователь отклонил предложение — AIProposal.reject. */
export async function rejectProposal(id: number): Promise<void> {
  await db.aiProposals.update(id, { status: 'REJECTED' });
}

/** Выгрузка истории в отдельный JSON-файл, чтобы пользователь мог передать её разработчикам. */
export async function exportAiHistory(): Promise<Blob> {
  const rows = await db.aiProposals.orderBy('createdAt').toArray();
  return new Blob([JSON.stringify({ format: 'aap-ai-history', version: 1, rows }, null, 2)], { type: 'application/json' });
}

// ──────────────────────── Резервная копия (ФТ-03–ФТ-05, НД-04) ──────────────────

/** ФТ-03: все данные, включая файлы (Blob кодируются в base64). */
export async function exportBackup(): Promise<Blob> {
  return exportDB(db, { prettyJson: false });
}

type BackupJson = {
  formatName: string;
  data: {
    databaseName: string;
    databaseVersion: number;
    tables: Array<{ name: string; rowCount: number }>;
    data: Array<{ tableName: string; rows: unknown[] }>;
  };
};

/**
 * ФТ-04: восстановление из файла. До изменения данных файл проверяется целиком:
 * формат, имя базы, версия схемы и число строк в каждой таблице. Обрезанный файл
 * (например, недокачанный) иначе импортировался бы частично и стёр бы данные.
 * Перед импортом делается снимок текущих данных; при ошибке он возвращается обратно.
 */
export async function restoreBackup(file: Blob): Promise<void> {
  const notOurs = () => new ValidationError('Файл не является резервной копией Adaptive AI Planner.');
  const corrupted = () => new ValidationError('Не удалось восстановить данные: файл повреждён. Текущие данные не изменены.');
  // 1. Заголовок: наша ли это копия (читается начало файла).
  let head;
  try {
    head = await peakImportFile(file);
  } catch {
    throw notOurs();
  }
  if (head?.formatName !== 'dexie' || head.data?.databaseName !== db.name) throw notOurs();
  if (head.data.databaseVersion > db.verno) {
    throw new ValidationError('Резервная копия создана более новой версией приложения.');
  }
  // 2. Файл целиком: читается до конца и содержит все заявленные строки.
  let parsed: BackupJson;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw corrupted();
  }
  const meta = parsed?.data;
  const complete = Array.isArray(meta?.tables) && Array.isArray(meta?.data) && meta.tables.every((t) =>
    (meta.data.find((d) => d.tableName === t.name)?.rows.length ?? 0) === t.rowCount);
  if (!complete) throw corrupted();
  const snapshot = await exportDB(db, { prettyJson: false });
  try {
    await importInto(db, file, { clearTablesBeforeImport: true, acceptVersionDiff: true });
  } catch {
    await importInto(db, snapshot, { clearTablesBeforeImport: true });
    throw corrupted();
  }
}

/** ФТ-05: удалить все данные пользователя из браузера (после подтверждения в интерфейсе). */
export async function deleteAllData(): Promise<void> {
  await db.delete();
  await db.open(); // пересоздаёт пустую базу с актуальной схемой
}
