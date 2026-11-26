// Типы ответов API (docs/contracts.md): поля в camelCase, как приходят с сервера.

export type TaskStatus = 'BACKLOG' | 'PLANNED' | 'IN_PROGRESS' | 'IN_HOLD' | 'DONE' | 'CANCELLED';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
/**
 * Раздел задачи: учебная или «моя» (не связана с учёбой).
 * Этого поля пока нет в docs/contracts.md — его нужно согласовать с бэкендом (см. src/api/README.md).
 */
export type TaskSection = 'STUDY' | 'PERSONAL';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  studyGroup: string | null;
  timezone: string;
  aiHistoryEnabled: boolean;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  studyGroup?: string | null;
  timezone: string;
}

export interface ProfilePatch {
  firstName?: string;
  lastName?: string;
  studyGroup?: string | null;
  timezone?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  section: TaskSection;
  deadline: string | null;
  goalId: string | null;
  categoryId: string | null;
  durationMinutes: number | null;
  sortOrder: number | null;
  source: 'MANUAL' | 'AI';
  completedAt: string | null;
  isOverdue: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskCreateInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  section?: TaskSection;
  deadline?: string | null;
  durationMinutes?: number | null;
}

export type TaskPatch = Partial<Omit<TaskCreateInput, 'title'>> & { title?: string };
