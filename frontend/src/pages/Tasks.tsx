import { useState } from 'react';
import Modal from '../components/Modal';
import './Tasks.css';

type Priority = 'high' | 'mid' | 'low';

const filters = ['Все', 'Сегодня', 'На неделе', 'Важные', 'Из ОРИОКС', 'Мои', 'Выполненные'];

const tasks: { title: string; time: string; priority: Priority }[] = [
  { title: 'Сдать лабораторную работу №4 (Физика)', time: 'сегодня, до 18:00', priority: 'high' },
  { title: 'Подготовиться к семинару по матанализу', time: 'сегодня, до 20:00', priority: 'mid' },
  { title: 'Контрольная работа по физике', time: 'завтра, 10:30', priority: 'mid' },
  { title: 'Купить материалы для проекта', time: 'на этой неделе', priority: 'low' },
  { title: 'Экзамен по программированию', time: '15 октября', priority: 'high' },
  { title: 'Сдача курсовой работы', time: '28 октября', priority: 'high' },
];

export default function Tasks() {
  const [activeFilter, setActiveFilter] = useState('Все');
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div>
      <div className="card-header">
        <h1>Все задачи</h1>
        <button className="btn btn-primary" onClick={() => setModalOpen(true)}>+ Новая задача</button>
      </div>

      <div className="filters">
        {filters.map((f) => (
          <button
            key={f}
            className={f === activeFilter ? 'btn btn-small btn-primary' : 'btn btn-small'}
            onClick={() => setActiveFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      <section className="card">
        <ul className="task-list">
          {tasks.map((t) => (
            <li className="task-item" key={t.title}>
              <span className={`priority-dot priority-${t.priority}`}></span>
              <span className="task-title">{t.title}</span>
              <span className="task-time">{t.time}</span>
            </li>
          ))}
        </ul>
      </section>

      <Modal open={modalOpen} title="Новая задача" onClose={() => setModalOpen(false)}>
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
        <button className="btn btn-primary btn-block" onClick={() => setModalOpen(false)}>
          Добавить
        </button>
      </Modal>
    </div>
  );
}
