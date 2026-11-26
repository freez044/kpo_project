import type { Task } from '../api/types';
import { formatDayMonth, formatTime } from '../lib/dates';
import { PRIORITY_LABEL, SECTION_LABEL } from '../tasks/helpers';
import './TaskCard.css';

interface Props {
  task: Task;
  timezone: string;
  /** true — «15 октября, 18:00», false — «до 18:00» (для блоков «Сегодня» и «Завтра») */
  showDate: boolean;
  busy?: boolean;
  /** Нажатие на кружок: выполнить задачу или вернуть выполненную в работу. */
  onToggle?: () => void;
}

function deadlineText(task: Task, tz: string, showDate: boolean): string {
  if (!task.deadline) return 'Без срока';
  const time = formatTime(task.deadline, tz);
  return showDate ? `${formatDayMonth(task.deadline, tz)}, ${time}` : `до ${time}`;
}

/**
 * Карточка делится диагональю на две части с плавным переходом:
 * слева цвет раздела (синий — учебная, жёлтый — моя), справа цвет важности.
 * Цвета продублированы подписями, чтобы смысл не зависел только от цвета.
 */
export default function TaskCard({ task, timezone, showDate, busy, onToggle }: Props) {
  const done = task.status === 'DONE';
  const classes = [
    'task-card',
    task.section === 'STUDY' ? 'sec-study' : 'sec-personal',
    `prio-${task.priority.toLowerCase()}`,
    done ? 'is-done' : '',
  ].join(' ');

  return (
    <li className={classes}>
      {onToggle && (
        <button
          className={done ? 'task-check checked' : 'task-check'}
          title={done ? 'Вернуть в работу' : 'Отметить выполненной'}
          aria-label={`${done ? 'Вернуть в работу' : 'Выполнить'}: ${task.title}`}
          disabled={busy}
          onClick={onToggle}
        />
      )}
      <div className="task-card-body">
        <span className="task-card-title">{task.title}</span>
        <span className="task-card-meta">
          <span>{SECTION_LABEL[task.section]}</span>
          <span className={task.isOverdue ? 'overdue' : undefined}>
            {PRIORITY_LABEL[task.priority]} · {task.isOverdue ? 'просрочено, ' : ''}
            {deadlineText(task, timezone, showDate)}
          </span>
        </span>
      </div>
    </li>
  );
}
