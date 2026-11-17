import { useState } from 'react';
import Modal from '../components/Modal';
import './Dashboard.css';

type Priority = 'high' | 'mid' | 'low';
type Load = 'none' | 'low' | 'mid' | 'high';

const blocks: { title: string; tasks: { title: string; time: string; priority: Priority }[] }[] = [
  {
    title: 'Сегодня',
    tasks: [
      { title: 'Сдать лабораторную работу №4', time: 'до 18:00', priority: 'high' },
      { title: 'Подготовиться к семинару по матанализу', time: 'до 20:00', priority: 'mid' },
    ],
  },
  {
    title: 'Завтра',
    tasks: [
      { title: 'Контрольная работа по физике', time: '10:30', priority: 'mid' },
      { title: 'Отправить отчёт руководителю практики', time: 'до 17:00', priority: 'low' },
    ],
  },
  {
    title: 'Важное на будущее',
    tasks: [
      { title: 'Экзамен по программированию', time: '15 октября', priority: 'high' },
      { title: 'Сдача курсовой работы', time: '28 октября', priority: 'high' },
    ],
  },
];

const weekLoad = [
  { day: 'Пн', value: 30 },
  { day: 'Вт', value: 55 },
  { day: 'Ср', value: 80 },
  { day: 'Чт', value: 40 },
  { day: 'Пт', value: 95 },
  { day: 'Сб', value: 15 },
  { day: 'Вс', value: 5 },
];

const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const monthDays: { day: number; load: Load }[] = [
  { day: 1, load: 'none' }, { day: 2, load: 'low' }, { day: 3, load: 'mid' }, { day: 4, load: 'high' },
  { day: 5, load: 'low' }, { day: 6, load: 'none' }, { day: 7, load: 'none' },
  { day: 8, load: 'mid' }, { day: 9, load: 'high' }, { day: 10, load: 'high' }, { day: 11, load: 'mid' },
  { day: 12, load: 'low' }, { day: 13, load: 'none' }, { day: 14, load: 'none' },
];

export default function Dashboard() {
  // название блока, для которого открыто окно «Новая задача» (null — окно закрыто)
  const [modalBlock, setModalBlock] = useState<string | null>(null);

  return (
    <div className="dashboard-grid">
      {/* левая колонка: три блока задач */}
      <div className="tasks-column">
        {blocks.map((block) => (
          <section className="card" key={block.title}>
            <div className="card-header">
              <h3>{block.title}</h3>
              <button className="btn btn-small" onClick={() => setModalBlock(block.title)}>
                + Новая задача
              </button>
            </div>
            <ul className="task-list">
              {block.tasks.map((t) => (
                <li className="task-item" key={t.title}>
                  <span className={`priority-dot priority-${t.priority}`}></span>
                  <span className="task-title">{t.title}</span>
                  <span className="task-time">{t.time}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* правая колонка: график + мини-календарь */}
      <div className="side-column">
        <section className="card">
          <div className="card-header">
            <h3>Загруженность на неделю</h3>
          </div>
          <div className="load-chart">
            {weekLoad.map((d) => (
              <div className="load-bar-wrap" key={d.day}>
                <div className="load-bar" style={{ height: `${d.value}%` }}></div>
                <span>{d.day}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Календарь загруженности</h3>
          </div>
          <div className="mini-calendar">
            {weekdays.map((w) => (
              <div className="weekday" key={w}>{w}</div>
            ))}
            {monthDays.map((d) => (
              <div className={`day-dot load-${d.load}`} key={d.day}>{d.day}</div>
            ))}
          </div>
          <div className="legend">
            <span><i style={{ background: 'var(--border)' }}></i>нет задач</span>
            <span><i style={{ background: '#9fd6b6' }}></i>низкая</span>
            <span><i style={{ background: 'var(--warning)' }}></i>средняя</span>
            <span><i style={{ background: 'var(--danger)' }}></i>высокая</span>
          </div>
        </section>
      </div>

      <Modal
        open={modalBlock !== null}
        title={`Новая задача — ${modalBlock ?? ''}`}
        onClose={() => setModalBlock(null)}
      >
        <div className="field">
          <label>Название</label>
          <input type="text" placeholder="Что нужно сделать" />
        </div>
        <div className="field">
          <label>Важность</label>
          <select defaultValue="mid">
            <option value="high">Высокая</option>
            <option value="mid">Средняя</option>
            <option value="low">Низкая</option>
          </select>
        </div>
        <button className="btn btn-primary btn-block" onClick={() => setModalBlock(null)}>
          Добавить
        </button>
      </Modal>
    </div>
  );
}
