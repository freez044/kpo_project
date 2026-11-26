import { useState } from 'react';
import type { FormEvent } from 'react';
import Modal from './Modal';
import { ApiError } from '../api/client';
import type { Task, TaskPriority, TaskSection } from '../api/types';
import { zonedToIso } from '../lib/dates';
import { useTasks } from '../tasks/TasksContext';
import './NewTaskModal.css';

export interface NewTaskDefaults {
  priority: TaskPriority;
  section: TaskSection;
  /** Срок по умолчанию, YYYY-MM-DDTHH:mm в часовом поясе пользователя; пустая строка — без срока. */
  deadline: string;
}

interface Props {
  open: boolean;
  title: string;
  timezone: string;
  defaults: NewTaskDefaults;
  onClose: () => void;
  onCreated?: (task: Task) => void;
}

export default function NewTaskModal({ open, title, timezone, defaults, onClose, onCreated }: Props) {
  // Форма внутри Modal: пока окно закрыто, она не смонтирована, поэтому поля каждый раз начинаются заново.
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <NewTaskForm timezone={timezone} defaults={defaults} onClose={onClose} onCreated={onCreated} />
    </Modal>
  );
}

const SECTION_OPTIONS: { value: TaskSection; label: string }[] = [
  { value: 'STUDY', label: 'Учебная' },
  { value: 'PERSONAL', label: 'Моя' },
];

function NewTaskForm({
  timezone,
  defaults,
  onClose,
  onCreated,
}: Pick<Props, 'timezone' | 'defaults' | 'onClose' | 'onCreated'>) {
  const { createTask } = useTasks();
  const [title, setTitle] = useState('');
  const [section, setSection] = useState<TaskSection>(defaults.section);
  const [priority, setPriority] = useState<TaskPriority>(defaults.priority);
  const [deadline, setDeadline] = useState(defaults.deadline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Укажите название задачи');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const task = await createTask({
        title: title.trim(),
        section,
        priority,
        deadline: deadline ? zonedToIso(deadline, timezone) : null,
      });
      onCreated?.(task);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить задачу');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="task-title">Название</label>
        <input
          id="task-title"
          type="text"
          placeholder="Что нужно сделать"
          maxLength={200}
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="field-label" id="task-section-label">Тип задачи</span>
        <div className="segmented" role="radiogroup" aria-labelledby="task-section-label">
          {SECTION_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={section === o.value}
              className={`segmented-option ${o.value === 'STUDY' ? 'sec-study' : 'sec-personal'}${
                section === o.value ? ' active' : ''
              }`}
              onClick={() => setSection(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="task-priority">Важность</label>
        <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
          <option value="URGENT">Срочная</option>
          <option value="HIGH">Высокая</option>
          <option value="MEDIUM">Средняя</option>
          <option value="LOW">Низкая</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="task-deadline">Срок</label>
        <input
          id="task-deadline"
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
      </div>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy ? 'Сохраняем…' : 'Добавить'}
      </button>
    </form>
  );
}
