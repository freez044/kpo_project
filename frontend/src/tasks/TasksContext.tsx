// Общий список задач для всех страниц: Главная и «Задачи» читают одно и то же состояние,
// поэтому задача, созданная на одной странице, сразу видна на другой, без повторной загрузки.
// Провайдер стоит внутри закрытой части сайта и пересоздаётся при выходе из аккаунта.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '../api/client';
import * as api from '../api/tasks';
import type { Task, TaskCreateInput, TaskPatch } from '../api/types';

interface TasksValue {
  /** null — ещё загружаются */
  tasks: Task[] | null;
  loadError: string | null;
  reload: () => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<Task>;
  updateTask: (id: string, patch: TaskPatch) => Promise<Task>;
  removeTask: (id: string) => Promise<void>;
}

const TasksContext = createContext<TasksValue | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoadError(null);
    try {
      setTasks(await api.listTasks());
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Не удалось загрузить задачи');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<TasksValue>(
    () => ({
      tasks,
      loadError,
      reload,
      async createTask(input) {
        const task = await api.createTask(input);
        setTasks((prev) => [...(prev ?? []), task]);
        return task;
      },
      async updateTask(id, patch) {
        const task = await api.updateTask(id, patch);
        setTasks((prev) => (prev ?? []).map((t) => (t.id === task.id ? task : t)));
        return task;
      },
      async removeTask(id) {
        await api.deleteTask(id);
        setTasks((prev) => (prev ?? []).filter((t) => t.id !== id));
      },
    }),
    [tasks, loadError, reload],
  );

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>;
}

export function useTasks(): TasksValue {
  const value = useContext(TasksContext);
  if (!value) throw new Error('useTasks нужно вызывать внутри <TasksProvider>');
  return value;
}
