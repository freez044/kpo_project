import './Calendar.css';

const days = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const hours = ['9:00', '11:00', '14:00', '16:00'];

type EventKind = 'lesson' | 'task';

// ключ: `${номер строки времени}-${номер дня недели}`
const events: Record<string, { title: string; kind: EventKind }> = {
  '0-0': { title: 'Матанализ, лекция', kind: 'lesson' },
  '0-2': { title: 'Физика, лекция', kind: 'lesson' },
  '0-4': { title: 'Программирование, лаб.', kind: 'lesson' },
  '1-1': { title: 'Английский язык', kind: 'lesson' },
  '1-3': { title: 'Подготовка к семинару', kind: 'task' },
  '2-0': { title: 'Сдать лабораторную №4', kind: 'task' },
  '2-2': { title: 'Семинар по физике', kind: 'lesson' },
  '3-4': { title: 'Отчёт по практике', kind: 'task' },
};

export default function Calendar() {
  return (
    <div>
      <div className="card-header">
        <h1>Неделя: 29 сентября — 5 октября</h1>
        <div className="calendar-actions">
          <button className="btn btn-small">← Прошлая неделя</button>
          <button className="btn btn-small">Следующая неделя →</button>
          <button className="btn btn-primary btn-small">+ Новая задача</button>
        </div>
      </div>

      <div className="legend calendar-legend">
        <span><i style={{ background: 'var(--accent)' }}></i>пары / занятия (из ОРИОКС)</span>
        <span><i style={{ background: '#e8a33d' }}></i>личные задачи</span>
      </div>

      <div className="week-grid">
        <div className="cell head"></div>
        {days.map((d) => (
          <div className="cell head" key={d}>{d}</div>
        ))}

        {hours.map((h, row) => (
          <div className="week-row" key={h}>
            <div className="cell time-col">{h}</div>
            {days.map((d, col) => {
              const ev = events[`${row}-${col}`];
              return (
                <div className="cell" key={d}>
                  {ev && (
                    <div className={ev.kind === 'task' ? 'event-chip task' : 'event-chip'}>{ev.title}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
