import { useState } from 'react';
import { formatDeadline, type Task } from '../tasks';
import { formatDate, plannedTasksByDate, shiftDate } from './taskDates';

export default function Calendar({ tasks, date, zone, onEdit, onCreate }: {
  tasks: Task[]; date: string; zone: string; onEdit: (task: Task) => void; onCreate: (date: string) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const monday = shiftDate(date, -((weekday + 6) % 7) + weekOffset * 7);
  const dates = Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
  const byDate = plannedTasksByDate(tasks);

  return (
    <div>
      <div className="card-header">
        <h1>Календарь задач</h1>
        <div className="calendar-actions">
          <button className="btn btn-small" onClick={() => setWeekOffset(offset => offset - 1)}>← Прошлая неделя</button>
          <button className="btn btn-small" onClick={() => setWeekOffset(offset => offset + 1)}>Следующая неделя →</button>
        </div>
      </div>
      <div className="team-calendar">
        {dates.map(day => (
          <section className="card" key={day}>
            <h3>{formatDate(day, { weekday: 'short', day: 'numeric', month: 'short' })}</h3>
            {(byDate.get(day) ?? []).map(task => <button key={task.id} className="event-chip" onClick={() => onEdit(task)}>
              {task.title}{task.deadline && <small>{formatDeadline(task.deadline, zone)}</small>}
            </button>)}
            <button className="btn btn-small" aria-label={`Добавить задачу на ${day}`} onClick={() => onCreate(day)}>+ Задача</button>
          </section>
        ))}
      </div>
    </div>
  );
}
