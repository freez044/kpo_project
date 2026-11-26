import { request } from './client';
import type { Task, TaskCreateInput, TaskPatch } from './types';

export const listTasks = () => request<Task[]>('/tasks');

export const createTask = (input: TaskCreateInput) =>
  request<Task>('/tasks', { method: 'POST', body: input });

export const updateTask = (id: string, patch: TaskPatch) =>
  request<Task>(`/tasks/${id}`, { method: 'PATCH', body: patch });

export const deleteTask = (id: string) => request<void>(`/tasks/${id}`, { method: 'DELETE' });
