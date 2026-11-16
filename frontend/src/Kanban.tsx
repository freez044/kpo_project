import { useRef, useState, type PointerEvent } from 'react';
import { CalendarDays, Flag, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { formatDeadline, priorities, statuses, type Task } from './tasks';
import './kanban.css';

const columns: { status: Task['status']; label: string; tone: string }[] = [
  { status: 'BACKLOG', label: 'Без плана', tone: 'backlog' },
  { status: 'PLANNED', label: 'Запланировано', tone: 'planned' },
  { status: 'IN_PROGRESS', label: 'В работе', tone: 'progress' },
  { status: 'IN_HOLD', label: 'На паузе', tone: 'hold' },
  { status: 'DONE', label: 'Выполнено', tone: 'done' },
  { status: 'CANCELLED', label: 'Отменено', tone: 'cancelled' },
];
type Props = { tasks: Task[]; zone: string; busyId: string | null; onMove: (task: Task, status: Task['status']) => Promise<void>; onEdit: (task: Task) => void; onDelete: (task: Task) => void; onCreate: (status: Task['status']) => void };

export default function Kanban({ tasks, zone, busyId, onMove, onEdit, onDelete, onCreate }: Props) {
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [over, setOver] = useState<Task['status'] | null>(null);
  const pointer = useRef<{ id: number; task: Task; x: number; y: number; started: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const categories = [...new Set(tasks.map(t => t.category).filter((c): c is string => Boolean(c)))].sort((a, b) => a.localeCompare(b, 'ru'));
  const filtered = tasks.filter(t => (!category || (category === '__none__' ? !t.category : t.category === category.slice(9))) && (!priority || t.priority === priority));
  const moving = busyId !== null;
  function finishDrag() { pointer.current = null; setDraggedId(null); setOver(null); setGhost(null); }
  function columnAt(x: number, y: number) {
    const column = document.elementFromPoint(x, y)?.closest('[data-kanban-status]');
    return column?.getAttribute('data-kanban-status') as Task['status'] | null;
  }
  function startPointer(event: PointerEvent<HTMLElement>, task: Task) {
    if (moving || event.button !== 0 || event.pointerType === 'touch' || (event.target as Element).closest('button,select,input')) return;
    pointer.current = { id: event.pointerId, task, x: event.clientX, y: event.clientY, started: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function movePointer(event: PointerEvent<HTMLElement>) {
    const current = pointer.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.started && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    current.started = true;
    event.preventDefault();
    setDraggedId(current.task.id);
    setOver(columnAt(event.clientX, event.clientY));
    setGhost({ title: current.task.title, x: event.clientX, y: event.clientY });
    const scroll = event.currentTarget.closest('.board-scroll');
    if (scroll && getComputedStyle(scroll).overflowX === 'auto') {
      const bounds = scroll.getBoundingClientRect();
      if (event.clientX > bounds.right - 40) scroll.scrollLeft += 20;
      if (event.clientX < bounds.left + 40) scroll.scrollLeft -= 20;
    }
  }
  function endPointer(event: PointerEvent<HTMLElement>) {
    const current = pointer.current;
    const target = columnAt(event.clientX, event.clientY);
    finishDrag();
    if (current?.started && target && !moving && current.task.status !== target) void onMove(current.task, target);
  }
  return <section className="kanban" aria-label="Канбан-доска">
    <div className="board-toolbar"><div><h2>От идеи до результата</h2><p>Перетащите карточку в другую колонку или выберите статус внизу карточки.</p></div><span className="board-total" aria-live="polite">Показано {filtered.length} из {tasks.length}</span></div>
    <div className="board-filters"><label>Категория<select aria-label="Категория на канбан-доске" value={category} disabled={moving} onChange={e => setCategory(e.target.value)}><option value="">Все категории</option><option value="__none__">Без категории</option>{categories.map(c => <option key={c} value={'category:' + c}>{c}</option>)}</select></label><label>Приоритет<select aria-label="Приоритет на канбан-доске" value={priority} disabled={moving} onChange={e => setPriority(e.target.value)}><option value="">Все приоритеты</option>{Object.entries(priorities).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{(category || priority) && <button className="text-button" disabled={moving} onClick={() => { setCategory(''); setPriority(''); }}><RotateCcw size={14}/> Сбросить</button>}</div>
    {tasks.length === 0 && <div className="board-welcome"><strong>Доска готова к вашим планам</strong><p>Добавьте первую задачу кнопкой в нужной колонке.</p></div>}
    {tasks.length > 0 && filtered.length === 0 && <p className="empty" role="status">По выбранным фильтрам задач нет. Измените условия или сбросьте фильтры.</p>}
    <div className="board-scroll" tabIndex={0} aria-label="Колонки задач. На компьютере прокручиваются по горизонтали.">
      <div className="board-columns">{columns.map(column => {
        const cards = filtered.filter(t => t.status === column.status);
        return <section key={column.status} data-kanban-status={column.status} className={`board-column tone-${column.tone} ${over === column.status ? 'drop-target' : ''}`} aria-label={`Колонка ${column.label}`}>
          <header className="board-column-header"><span className="column-dot"/><h3>{column.label}</h3><span className="column-count">{cards.length}</span><button className="icon-button" disabled={moving} onClick={() => onCreate(column.status)} aria-label={`Добавить задачу: ${column.label}`}><Plus size={16}/></button></header>
          <div className="board-card-list">{cards.map(task => <article key={task.id} aria-label={`Карточка: ${task.title}`} className={`board-card ${draggedId === task.id ? 'dragging' : ''} ${task.isOverdue ? 'card-overdue' : ''}`} draggable={false} onPointerDown={event => startPointer(event, task)} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}>
            <div className="board-card-top"><span className={'card-priority priority-' + task.priority.toLowerCase()}><Flag size={12}/>{priorities[task.priority]}</span><GripVertical className="drag-grip" size={16} aria-hidden="true"/></div>
            <button className="board-card-title" disabled={moving} onClick={() => onEdit(task)}>{task.title}</button>
            {task.description && <p className="board-description">{task.description}</p>}
            <div className="board-card-meta">{task.source === 'ORIOKS' && <span className="tag study">ОРИОКС</span>}{task.category && <span className="tag study">{task.category}</span>}<span className={task.isOverdue ? 'overdue-label' : ''}><CalendarDays size={12}/>{task.isOverdue ? 'Просрочено · ' : ''}{formatDeadline(task.deadline, zone)}</span></div>
            <div className="board-card-bottom"><label><span className="sr-only">Статус задачи: {task.title}</span><select aria-label={`Статус задачи: ${task.title}`} value={task.status} disabled={moving} onChange={e => void onMove(task, e.target.value as Task['status'])}>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><button className="icon-button" disabled={moving} onClick={() => onDelete(task)} aria-label={`Удалить: ${task.title}`}><Trash2 size={14}/></button></div>
            {busyId === task.id && <span className="card-saving" role="status">Сохраняем статус…</span>}
          </article>)}{cards.length === 0 && <div className="empty-column">{draggedId ? 'Отпустите карточку здесь' : 'Пока нет задач'}</div>}</div>
          <button className="board-add" disabled={moving} onClick={() => onCreate(column.status)}><Plus size={14}/> Добавить задачу</button>
        </section>;
      })}</div>
    </div>
    <p className="board-footnote">Дата в плане и дедлайн при переносе не меняются. Отменённые задачи остаются в отдельной колонке.</p>
    {ghost && <div className="board-drag-ghost" aria-hidden="true" style={{ left: Math.max(8, Math.min(ghost.x + 12, window.innerWidth - 228)), top: Math.max(8, Math.min(ghost.y + 12, window.innerHeight - 90)) }}>{ghost.title}</div>}
  </section>;
}
