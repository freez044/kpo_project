/**
 * Тесты хранилища (vitest + fake-indexeddb). Запуск после создания каркаса фронтенда:
 *   npm i -D vitest fake-indexeddb
 *   npx vitest run src/db
 * В окружении vitest нужен jsdom или happy-dom (FileReader для dexie-export-import).
 */
import 'fake-indexeddb/auto';
import { beforeEach, it } from 'vitest';
import * as s from './db';
const { db } = s;

beforeEach(async () => { await s.deleteAllData(); });

function eq(a: unknown, b: unknown, m = '') { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
async function throws(fn: () => Promise<unknown>, re: RegExp) {
  try { await fn(); } catch (e) { if (re.test(String((e as Error).message))) return; throw e; }
  throw new Error('ожидалась ошибка ' + re);
}
const iso = (h: number) => new Date(Date.UTC(2026, 10, 2, h)).toISOString();
const file = (name: string, size = 10) => new File([new Uint8Array(size)], name, { type: 'text/plain' });

it('профиль: сохранение и обязательные поля', async () => {
  await s.saveProfile({ firstName: 'Иван', lastName: 'Иванов', studyGroup: 'ПИН-31', timezone: 'Europe/Moscow' });
  const p = await db.profile.get('me'); eq(p?.aiHistoryEnabled, true);
  await throws(() => s.saveProfile({ firstName: ' ', lastName: 'И', studyGroup: 'Г', timezone: 'UTC' }), /Имя/);
});
it('задача: создание, статус BACKLOG, проверка длительности', async () => {
  const id = await s.createTask({ title: 'Лаба', description: '', priority: 'HIGH', durationMinutes: 90 });
  const task = await db.tasks.get(id); eq([task?.status, task?.source], ['BACKLOG', 'MANUAL']);
  await throws(() => s.createTask({ title: 'x', description: '', priority: 'LOW', durationMinutes: 0 }), /Длительность/);
  await throws(() => s.createTask({ title: '', description: '', priority: 'LOW' }), /Название/);
});
it('статус: completedAt ставится и снимается', async () => {
  const id = await s.createTask({ title: 'a', description: '', priority: 'LOW' });
  await s.setTaskStatus(id, 'DONE'); eq(!!(await db.tasks.get(id))?.completedAt, true);
  await s.setTaskStatus(id, 'IN_PROGRESS'); eq((await db.tasks.get(id))?.completedAt, undefined);
});
it('просрочка вычисляется', async () => {
  const base = { id: 1, title: 'a', description: '', priority: 'LOW' as const, source: 'MANUAL' as const, createdAt: '', updatedAt: '', deadline: '2020-01-01T00:00:00Z' };
  eq([s.isOverdue({ ...base, status: 'BACKLOG' }), s.isOverdue({ ...base, status: 'DONE' })], [true, false]);
});
it('удаление задачи уносит интервалы и файлы, другие данные не трогает', async () => {
  const a = await s.createTask({ title: 'a', description: '', priority: 'LOW' });
  const b = await s.createTask({ title: 'b', description: '', priority: 'LOW' });
  await s.addScheduleItem({ taskId: a, title: 'a', startAt: iso(9), endAt: iso(10) });
  await s.addScheduleItem({ taskId: b, title: 'b', startAt: iso(9), endAt: iso(10) });
  await s.attachFile({ taskId: a }, file('a.txt'));
  eq(await s.taskDeletionPreview(a), { scheduleItems: 1, files: 1 });
  await s.deleteTask(a);
  eq([await db.tasks.count(), await db.scheduleItems.count(), await db.fileAttachments.count()], [1, 1, 0]);
});
it('удаление цели: задачи остаются без цели, файлы цели удаляются', async () => {
  const g = await db.goals.add({ title: 'Сессия', description: '', status: 'ACTIVE', createdAt: '', updatedAt: '' });
  const ids = await s.applyDecomposition(g, [
    { title: 'Т1', description: '', priority: 'MEDIUM', durationMinutes: 60 },
    { title: 'Т2', description: '', priority: 'LOW' },
  ]);
  await s.attachFile({ goalId: g }, file('g.pdf'));
  eq(await s.goalDeletionPreview(g), { tasks: 2, files: 1 });
  await s.setTaskStatus(ids[0], 'DONE');
  eq(await s.goalProgress(g), { done: 1, total: 2, percent: 50 });
  await s.deleteGoal(g);
  const rest = await db.tasks.toArray();
  eq(rest.map((x) => [x.goalId, x.order, x.source]), [[undefined, undefined, 'AI'], [undefined, undefined, 'AI']].map(r => r.map(v => v)));
  eq(await db.fileAttachments.count(), 0);
});
it('декомпозиция атомарна: ошибка не оставляет частичного плана', async () => {
  await throws(() => s.applyDecomposition(999, [{ title: 'x', description: '', priority: 'LOW' }]), /Цель не найдена/);
  eq(await db.tasks.count(), 0);
});
it('категория: уникальность и удаление без потери задач', async () => {
  const c = await db.categories.add({ name: 'Учёба' });
  await throws(() => db.categories.add({ name: 'Учёба' }), /.*/);
  const id = await s.createTask({ title: 'a', description: '', priority: 'LOW', categoryId: c });
  await s.deleteCategory(c);
  eq((await db.tasks.get(id))?.categoryId, undefined);
});
it('календарь: проверки, диапазон и пересечения', async () => {
  await throws(() => s.addCalendarEvent({ title: 'x', startAt: iso(10), endAt: iso(9) }), /позже/);
  await throws(() => s.addScheduleItem({ taskId: 42, title: 'x', startAt: iso(9), endAt: iso(10) }), /существующей задачей/);
  const t1 = await s.createTask({ title: 'a', description: '', priority: 'LOW' });
  await s.addCalendarEvent({ title: 'Встреча', startAt: iso(9), endAt: iso(10) });
  const si = await s.addScheduleItem({ taskId: t1, title: 'a', startAt: iso(9), endAt: iso(11) });
  await s.replaceLessons('ORIOKS', [{ title: 'Матан', discipline: 'Матан', startAt: iso(11), endAt: iso(12) }]);
  const r = await s.calendarRange(iso(0), iso(23));
  eq([r.events.length, r.scheduleItems.length, r.lessons.length], [1, 1, 1]);
  eq(s.findOverlaps([...r.events, ...r.scheduleItems, ...r.lessons]).length, 1, 'соседние интервалы не конфликтуют');
  await s.moveCalendarItem('scheduleItems', si, iso(13), iso(14));
  eq((await db.scheduleItems.get(si))?.startAt, iso(13));
  await s.replaceLessons('ORIOKS', []); eq(await db.academicLessons.count(), 0);
});
it('задания ОРИОКС обновляются по externalId', async () => {
  await s.upsertAssignments([{ externalId: 'a1', discipline: 'ООП', title: 'ЛР1' }]);
  await s.upsertAssignments([{ externalId: 'a1', discipline: 'ООП', title: 'ЛР1', isDone: true }]);
  eq([await db.academicAssignments.count(), (await db.academicAssignments.get('a1'))?.isDone], [1, true]);
});
it('файлы: карточка задачи показывает файлы задачи и цели', async () => {
  const g = await db.goals.add({ title: 'g', description: '', status: 'ACTIVE', createdAt: '', updatedAt: '' });
  const tk = await s.createTask({ title: 'a', description: '', priority: 'LOW', goalId: g });
  await s.attachFile({ taskId: tk }, file('t.txt')); await s.attachFile({ goalId: g }, file('g.txt'));
  eq((await s.filesForTaskCard(tk)).map((f) => f.originalName).sort(), ['g.txt', 't.txt']);
  await throws(() => s.attachFile({ taskId: tk }, file('big', s.MAX_FILE_BYTES + 1)), /слишком большой/);
});
it('история ИИ: статусы и отключение', async () => {
  const id = await s.saveProposal({ kind: 'COMMAND', requestText: 'перенеси встречу', responseData: {}, model: 'test' });
  await s.confirmProposal(id!, { a: 1 }, true); eq((await db.aiProposals.get(id!))?.status, 'EDITED');
  const id2 = await s.saveProposal({ kind: 'DECOMPOSE', requestText: 'цель', responseData: {}, model: 'test' });
  await s.rejectProposal(id2!); eq((await db.aiProposals.get(id2!))?.status, 'REJECTED');
  const h = JSON.parse(await (await s.exportAiHistory()).text()); eq(h.rows.length, 2);
  await s.saveProfile({ firstName: 'И', lastName: 'И', studyGroup: 'Г', timezone: 'UTC', aiHistoryEnabled: false });
  eq(await s.saveProposal({ kind: 'COMMAND', requestText: 'x', responseData: {}, model: 'test' }), undefined);
});
it('резервная копия: выгрузка и восстановление вместе с файлами', async () => {
  const tk = await s.createTask({ title: 'Сохранить меня', description: '', priority: 'LOW' });
  await s.attachFile({ taskId: tk }, file('keep.txt', 5));
  const backup = await s.exportBackup();
  await s.deleteAllData(); eq(await db.tasks.count(), 0);
  await s.restoreBackup(backup);
  eq((await db.tasks.toArray()).map((x) => x.title), ['Сохранить меня']);
  const f = await db.fileAttachments.toArray(); eq([f.length, f[0].originalName], [1, 'keep.txt']);
});
it('резервная копия: чужой и повреждённый файл не меняют данные', async () => {
  await s.createTask({ title: 'Текущая', description: '', priority: 'LOW' });
  await throws(() => s.restoreBackup(new Blob(['не json'])), /не является резервной копией/);
  const good = await (await s.exportBackup()).text();
  const at = good.indexOf('"tableName":"tasks"');
  if (at < 0) throw new Error('в копии не найдена таблица tasks');
  const broken = good.slice(0, at + 40); // файл обрывается посреди данных
  await throws(() => s.restoreBackup(new Blob([broken])), /повреждён/);
  const j = JSON.parse(good); j.data.data.find((d: any) => d.tableName === 'tasks').rows = [];
  await throws(() => s.restoreBackup(new Blob([JSON.stringify(j)])), /повреждён/); // корректный JSON, но строк меньше заявленного
  const newer = JSON.parse(good); newer.data.databaseVersion = 99;
  await throws(() => s.restoreBackup(new Blob([JSON.stringify(newer)])), /более новой версией/);
  eq((await db.tasks.toArray()).map((x) => x.title), ['Текущая']);
});
