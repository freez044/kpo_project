import { useMemo, useState } from 'react';
import NewTaskModal from '../components/NewTaskModal';
import type { NewTaskDefaults } from '../components/NewTaskModal';
import TaskCard from '../components/TaskCard';
import { ApiError } from '../api/client';
import type { Task } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import {
  addDays,
  dayKey,
  daysInMonth,
  monthTitle,
  todayKey,
  weekdayIndex,
} from '../lib/dates';
import { byDeadline, isOpen } from '../tasks/helpers';
import { useTasks } from '../tasks/TasksContext';
import './Dashboard.css';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

type BlockKey = 'overdue' | 'today' | 'tomorrow' | 'future';

interface Block {
  key: BlockKey;
  title: string;
  tasks: Task[];
  /** Показывать дату срока (а не только время). */
  showDate: boolean;
  /** Параметры окна «Новая задача»; null — в этом блоке задачи не добавляют. */
  defaults: NewTaskDefaults | null;
}

// Нагрузка дня по числу невыполненных задач со сроком в этот день.
function loadLevel(count: number): 'none' | 'low' | 'mid' | 'high' {
  if (count === 0) return 'none';
  if (count === 1) return 'low';
  if (count <= 3) return 'mid';
  return 'high';
}

function pluralTasks(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} задача`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} задачи`;
  return `${n} задач`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const tz = user?.timezone ?? 'Europe/Moscow';

  const { tasks, loadError, reload, updateTask } = useTasks();
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // блок, для которого открыто окно «Новая задача» (null — окно закрыто)
  const [modalBlock, setModalBlock] = useState<Block | null>(null);

  const today = todayKey(tz);
  const tomorrow = addDays(today, 1);

  const open = useMemo(() => (tasks ?? []).filter(isOpen), [tasks]);

  const blocks = useMemo<Block[]>(() => {
    const withDeadline = open.filter((t) => t.deadline !== null).sort(byDeadline);
    const day = (t: Task) => dayKey(t.deadline as string, tz);
    return [
      {
        key: 'overdue',
        title: 'Просрочено',
        tasks: withDeadline.filter((t) => t.isOverdue),
        showDate: true,
        defaults: null,
      },
      {
        key: 'today',
        title: 'Сегодня',
        tasks: withDeadline.filter((t) => !t.isOverdue && day(t) === today),
        showDate: false,
        defaults: { priority: 'MEDIUM', section: 'STUDY', deadline: `${today}T23:59` },
      },
      {
        key: 'tomorrow',
        title: 'Завтра',
        tasks: withDeadline.filter((t) => !t.isOverdue && day(t) === tomorrow),
        showDate: false,
        defaults: { priority: 'MEDIUM', section: 'STUDY', deadline: `${tomorrow}T23:59` },
      },
      {
        key: 'future',
        title: 'Важное на будущее',
        tasks: withDeadline.filter(
          (t) => !t.isOverdue && day(t) > tomorrow && (t.priority === 'HIGH' || t.priority === 'URGENT'),
        ),
        showDate: true,
        defaults: { priority: 'HIGH', section: 'STUDY', deadline: `${addDays(today, 7)}T12:00` },
      },
    ];
  }, [open, tz, today, tomorrow]);

  // Просроченные показываем, только когда они есть; остальные блоки — всегда.
  const visibleBlocks = blocks.filter((b) => b.key !== 'overdue' || b.tasks.length > 0);

  // Нагрузка по дням текущей недели (Пн–Вс) и текущего месяца.
  const countsByDay = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of open) {
      if (t.deadline) counts[dayKey(t.deadline, tz)] = (counts[dayKey(t.deadline, tz)] ?? 0) + 1;
    }
    return counts;
  }, [open, tz]);

  const weekStart = addDays(today, -weekdayIndex(today));
  const week = WEEKDAYS.map((label, i) => {
    const key = addDays(weekStart, i);
    return { label, key, count: countsByDay[key] ?? 0 };
  });
  const weekMax = Math.max(1, ...week.map((d) => d.count));

  const [year, month] = today.split('-').map(Number);
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const leadingBlanks = weekdayIndex(`${monthPrefix}-01`);
  const monthDays = Array.from({ length: daysInMonth(year, month) }, (_, i) => {
    const d = i + 1;
    const key = `${monthPrefix}-${String(d).padStart(2, '0')}`;
    return { d, key, count: countsByDay[key] ?? 0 };
  });

  async function complete(task: Task) {
    setBusyId(task.id);
    setActionError(null);
    try {
      await updateTask(task.id, { status: 'DONE' });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Не удалось отметить задачу выполненной');
    } finally {
      setBusyId(null);
    }
  }

  if (tasks === null) {
    return loadError ? (
      <div className="card">
        <p className="form-error">{loadError}</p>
        <button className="btn" onClick={() => void reload()}>Повторить</button>
      </div>
    ) : (
      <div className="muted">Загрузка задач…</div>
    );
  }

  return (
    <div className="dashboard-grid">
      {/* левая колонка: блоки задач */}
      <div className="tasks-column">
        {actionError && <p className="form-error">{actionError}</p>}
        {visibleBlocks.map((block) => (
          <section className="card" key={block.key}>
            <div className="card-header">
              <h3>{block.title}</h3>
              {block.defaults && (
                <button className="btn btn-small" onClick={() => setModalBlock(block)}>
                  + Новая задача
                </button>
              )}
            </div>
            {block.tasks.length === 0 ? (
              <p className="empty">Нет задач</p>
            ) : (
              <ul className="task-list">
                {block.tasks.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    timezone={tz}
                    showDate={block.showDate}
                    busy={busyId === t.id}
                    onToggle={() => void complete(t)}
                  />
                ))}
              </ul>
            )}
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
            {week.map((d) => (
              <div className="load-bar-wrap" key={d.key} title={`${d.label}: ${pluralTasks(d.count)}`}>
                <span className="load-count">{d.count > 0 ? d.count : ''}</span>
                <div className="load-bar" style={{ height: `${(d.count / weekMax) * 100}%` }}></div>
                <span>{d.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <h3>Календарь загруженности</h3>
            <span className="muted calendar-month">{monthTitle(year, month)}</span>
          </div>
          <div className="mini-calendar">
            {WEEKDAYS.map((w) => (
              <div className="weekday" key={w}>{w}</div>
            ))}
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <div className="day-dot blank" key={`blank-${i}`}></div>
            ))}
            {monthDays.map((d) => (
              <div
                className={`day-dot load-${loadLevel(d.count)}${d.key === today ? ' today' : ''}`}
                key={d.key}
                title={d.count > 0 ? pluralTasks(d.count) : 'Нет задач'}
              >
                {d.d}
              </div>
            ))}
          </div>
          <div className="legend">
            <span><i style={{ background: 'var(--border)' }}></i>нет задач</span>
            <span><i style={{ background: '#9fd6b6' }}></i>1 задача</span>
            <span><i style={{ background: 'var(--warning)' }}></i>2–3</span>
            <span><i style={{ background: 'var(--danger)' }}></i>4 и больше</span>
          </div>
        </section>
      </div>

      <NewTaskModal
        open={modalBlock !== null}
        title={`Новая задача — ${modalBlock?.title ?? ''}`}
        timezone={tz}
        defaults={modalBlock?.defaults ?? { priority: 'MEDIUM', section: 'STUDY', deadline: '' }}
        onClose={() => setModalBlock(null)}
      />
    </div>
  );
}
