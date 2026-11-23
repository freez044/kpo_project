import type { Task } from '../tasks';

export function shiftDate(date: string, days: number) {
  const value = new Date(date + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function formatDate(date: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(new Date(date + 'T00:00:00Z'));
}

export function plannedTasksByDate(tasks: Task[]) {
  const byDate = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.plannedDate || task.status === 'CANCELLED') continue;
    const day = byDate.get(task.plannedDate) ?? [];
    day.push(task);
    byDate.set(task.plannedDate, day);
  }
  return byDate;
}
