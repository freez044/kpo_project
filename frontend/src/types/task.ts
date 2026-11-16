export const statuses = { BACKLOG: 'Без плана', PLANNED: 'Запланирована', IN_PROGRESS: 'В работе', IN_HOLD: 'На паузе', DONE: 'Выполнена', CANCELLED: 'Отменена' };
export const priorities = { LOW: 'Низкий', MEDIUM: 'Средний', HIGH: 'Высокий', URGENT: 'Срочный' };
export type Task = { id: string; title: string; description: string; deadline: string | null; plannedDate: string | null; category: string | null; priority: keyof typeof priorities; status: keyof typeof statuses; completedAt: string | null; isOverdue: boolean; createdAt: string; updatedAt: string; source?: string; orioks?: { discipline: string; week: number; plannedDueAt: string | null; noPenaltyUntil: string | null; deadlineSource: string; stage: string } | null };
export type Dashboard = { date: string; today: Task[]; overdue: Task[]; upcoming: Task[]; completedCount: number };
export type TaskInput = Pick<Task, 'title' | 'description' | 'deadline' | 'plannedDate' | 'category' | 'priority' | 'status'>;
