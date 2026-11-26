import { useMemo, useState } from 'react';
import NewTaskModal from '../components/NewTaskModal';
import type { NewTaskDefaults } from '../components/NewTaskModal';
import TaskCard from '../components/TaskCard';
import { ApiError } from '../api/client';
import type { Task } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { addDays, todayKey } from '../lib/dates';
import { matchesFilters, sortForView } from '../tasks/helpers';
import type { SectionFilter, TaskView } from '../tasks/helpers';
import { useTasks } from '../tasks/TasksContext';
import './Tasks.css';

const VIEWS: { key: TaskView; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'На неделе' },
  { key: 'important', label: 'Важные' },
  { key: 'done', label: 'Выполненные' },
];

const SECTIONS: { key: SectionFilter; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'STUDY', label: 'Учебные' },
  { key: 'PERSONAL', label: 'Мои' },
];

const EMPTY_TEXT: Record<TaskView, string> = {
  all: 'Задач пока нет. Добавьте первую кнопкой «+ Новая задача».',
  today: 'На сегодня задач нет.',
  week: 'На ближайшие 7 дней задач нет.',
  important: 'Важных задач нет.',
  done: 'Выполненных задач пока нет.',
};

export default function Tasks() {
  const { user } = useAuth();
  const tz = user?.timezone ?? 'Europe/Moscow';
  const { tasks, loadError, reload, updateTask } = useTasks();

  const [view, setView] = useState<TaskView>('all');
  const [section, setSection] = useState<SectionFilter>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const visible = useMemo(
    () => sortForView((tasks ?? []).filter((t) => matchesFilters(t, view, section, tz)), view),
    [tasks, view, section, tz],
  );

  // Новая задача по умолчанию подходит под выбранные фильтры, чтобы сразу появиться в списке.
  const defaults = useMemo<NewTaskDefaults>(() => {
    const today = todayKey(tz);
    return {
      section: section === 'PERSONAL' ? 'PERSONAL' : 'STUDY',
      priority: view === 'important' ? 'HIGH' : 'MEDIUM',
      deadline:
        view === 'today' ? `${today}T23:59` : view === 'week' ? `${addDays(today, 1)}T23:59` : '',
    };
  }, [view, section, tz]);

  // Если созданная задача не попала под текущие фильтры, показываем все задачи, чтобы её было видно.
  function handleCreated(task: Task) {
    if (!matchesFilters(task, view, section, tz)) {
      setView('all');
      setSection('all');
    }
  }

  async function toggle(task: Task) {
    setBusyId(task.id);
    setActionError(null);
    try {
      await updateTask(task.id, { status: task.status === 'DONE' ? 'BACKLOG' : 'DONE' });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Не удалось изменить задачу');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="card-header">
        <h1>Все задачи</h1>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ Новая задача</button>
      </div>

      <div className="filter-group">
        <span className="filter-label">Срок</span>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={v.key === view ? 'btn btn-small btn-primary' : 'btn btn-small'}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="filter-group">
        <span className="filter-label">Тип</span>
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            className={s.key === section ? 'btn btn-small btn-primary' : 'btn btn-small'}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="task-legend" aria-label="Обозначения цветов">
        <span><i style={{ background: 'var(--section-study)' }}></i>учебная</span>
        <span><i style={{ background: 'var(--section-personal)' }}></i>моя</span>
        <span className="task-legend-sep">важность:</span>
        <span><i style={{ background: 'var(--prio-low)' }}></i>низкая</span>
        <span><i style={{ background: 'var(--prio-medium)' }}></i>средняя</span>
        <span><i style={{ background: 'var(--prio-high)' }}></i>высокая</span>
        <span><i style={{ background: 'var(--prio-urgent)' }}></i>срочная</span>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}

      <section className="card">
        {tasks === null ? (
          loadError ? (
            <>
              <p className="form-error">{loadError}</p>
              <button className="btn" onClick={() => void reload()}>Повторить</button>
            </>
          ) : (
            <p className="empty">Загрузка задач…</p>
          )
        ) : visible.length === 0 ? (
          <p className="empty">
            {tasks.length > 0 && view === 'all' && section === 'all'
              ? EMPTY_TEXT.all
              : section !== 'all' && view === 'all'
                ? 'В этом разделе открытых задач нет.'
                : EMPTY_TEXT[view]}
          </p>
        ) : (
          <ul className="task-list">
            {visible.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                timezone={tz}
                showDate
                busy={busyId === t.id}
                onToggle={() => void toggle(t)}
              />
            ))}
          </ul>
        )}
      </section>

      <NewTaskModal
        open={modalOpen}
        title="Новая задача"
        timezone={tz}
        defaults={defaults}
        onClose={() => setModalOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
