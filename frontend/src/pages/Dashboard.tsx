import type { ReactNode } from 'react';
import { isFinished, type Dashboard as Summary, type Task } from '../tasks';
import { formatDate, plannedTasksByDate, shiftDate } from './taskDates';

export default function Dashboard({ tasks, summary, row, onCreate }: {
  tasks: Task[]; summary: Summary; row: (task: Task) => ReactNode; onCreate: (date?: string) => void;
}) {
  const { date, today, overdue, upcoming } = summary;
  const byDate = plannedTasksByDate(tasks);
  const tomorrow = shiftDate(date, 1);
  const blocks = [
    { title: 'Сегодня', tasks: today, createDate: date },
    { title: 'Завтра', tasks: byDate.get(tomorrow) ?? [], createDate: tomorrow },
    { title: 'Просрочено', tasks: overdue },
    { title: 'Ближайшие дедлайны', tasks: upcoming.filter(task => task.plannedDate !== date && task.plannedDate !== tomorrow) },
  ];
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = shiftDate(date, index);
    return { day, count: (byDate.get(day) ?? []).filter(task => !isFinished(task)).length };
  });
  const maximum = Math.max(1, ...week.map(day => day.count));
  const monthStart = date.slice(0, 8) + '01';
  const firstDay = new Date(monthStart + 'T00:00:00Z');
  const offset = (firstDay.getUTCDay() + 6) % 7;
  const nextMonth = new Date(firstDay);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1, 0);
  const month = Array.from({ length: nextMonth.getUTCDate() }, (_, index) => shiftDate(monthStart, index));

  return (
    <div className="team-dashboard">
      <div className="tasks-column">
        {blocks.map(block => (
          <section className="card" key={block.title}>
            <div className="card-header"><h3>{block.title}</h3>
              {block.createDate && <button className="btn btn-small" onClick={() => onCreate(block.createDate)}>+ Новая задача</button>}
            </div>
            {block.tasks.length ? block.tasks.map(row) : <p className="empty">Задач нет.</p>}
          </section>
        ))}
      </div>
      <div className="side-column">
        <section className="card">
          <div className="card-header"><h3>Открытые задачи на ближайшие 7 дней</h3></div>
          <div className="load-chart">
            {week.map(({ day, count }) => (
              <div className="load-bar-wrap" key={day}>
                <span>{count}</span><div className="load-bar" style={{ height: `${count / maximum * 75}%` }} />
                <span>{formatDate(day, { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card">
          <div className="card-header"><h3>{formatDate(date, { month: 'long', year: 'numeric' })}</h3></div>
          <div className="mini-calendar">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => <div className="weekday" key={day}>{day}</div>)}
            {month.map((day, index) => {
              const count = (byDate.get(day) ?? []).filter(task => !isFinished(task)).length;
              const load = ['none', 'low', 'mid', 'high'][Math.min(3, count)];
              return <div key={day} className={`day-dot load-${load}`} title={`${day}: открытых задач — ${count}`}
                style={index === 0 ? { gridColumnStart: offset + 1 } : undefined}>{index + 1}</div>;
            })}
          </div>
          <div className="legend">Открытые задачи по дате в плане</div>
        </section>
      </div>
    </div>
  );
}
