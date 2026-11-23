import { useState, type ReactNode } from 'react';
import type { Task } from '../tasks';
import { shiftDate } from './taskDates';

const filters = ['Все', 'Сегодня', 'На неделе', 'Важные', 'Из ОРИОКС', 'Мои', 'Выполненные'] as const;

export default function Tasks({ tasks, date, row, onCreate }: {
  tasks: Task[]; date: string; row: (task: Task) => ReactNode; onCreate: () => void;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]>('Все');
  const end = shiftDate(date, 7);
  const visible = tasks.filter(task => {
    switch (filter) {
      case 'Сегодня': return task.plannedDate === date;
      case 'На неделе': return Boolean(task.plannedDate && task.plannedDate >= date && task.plannedDate < end);
      case 'Важные': return task.priority === 'HIGH' || task.priority === 'URGENT';
      case 'Из ОРИОКС': return task.source === 'ORIOKS';
      case 'Мои': return task.source !== 'ORIOKS';
      case 'Выполненные': return task.status === 'DONE';
      default: return true;
    }
  });

  return (
    <div>
      <div className="card-header"><h1>Все задачи</h1><button className="btn btn-primary" onClick={onCreate}>+ Новая задача</button></div>
      <div className="filters">
        {filters.map(label => <button key={label} aria-pressed={filter === label}
          className={filter === label ? 'btn btn-small btn-primary' : 'btn btn-small'} onClick={() => setFilter(label)}>{label}</button>)}
      </div>
      <section className="card">{visible.length ? visible.map(row) : <p className="empty">Задач по этому фильтру нет.</p>}</section>
    </div>
  );
}
