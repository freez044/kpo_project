import type { Task, TaskPriority, TaskSection } from '../api/types';
import { addDays, dayKey } from '../lib/dates';

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Низкая',
  MEDIUM: 'Средняя',
  HIGH: 'Высокая',
  URGENT: 'Срочная',
};

export const SECTION_LABEL: Record<TaskSection, string> = {
  STUDY: 'Учебная',
  PERSONAL: 'Моя',
};

export const isOpen = (t: Task) => t.status !== 'DONE' && t.status !== 'CANCELLED';

/** По сроку: ближайшие первыми, задачи без срока в конце. */
export function byDeadline(a: Task, b: Task): number {
  const x = a.deadline ? Date.parse(a.deadline) : Infinity;
  const y = b.deadline ? Date.parse(b.deadline) : Infinity;
  if (x === y) return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return x < y ? -1 : 1;
}

// ── фильтры страницы «Задачи» ───────────────────────────────────────────────

export type TaskView = 'all' | 'today' | 'week' | 'important' | 'done';
export type SectionFilter = 'all' | TaskSection;

export function matchesFilters(task: Task, view: TaskView, section: SectionFilter, tz: string): boolean {
  if (section !== 'all' && task.section !== section) return false;
  if (view === 'done') return task.status === 'DONE';
  if (!isOpen(task)) return false;
  if (view === 'all') return true;
  if (view === 'important') return task.priority === 'HIGH' || task.priority === 'URGENT';

  if (!task.deadline) return false;
  const day = dayKey(task.deadline, tz);
  const today = dayKey(new Date(), tz);
  if (view === 'today') return day === today;
  // «На неделе» — ближайшие 7 дней, считая сегодняшний
  return day >= today && day <= addDays(today, 6);
}

export function sortForView(tasks: Task[], view: TaskView): Task[] {
  const list = [...tasks];
  if (view === 'done') {
    return list.sort((a, b) => Date.parse(b.completedAt ?? b.updatedAt) - Date.parse(a.completedAt ?? a.updatedAt));
  }
  return list.sort(byDeadline);
}
