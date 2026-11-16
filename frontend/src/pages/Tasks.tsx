import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { Task } from '../types/task';
import './Tasks.css';
type Props = { title: string; dateLabel: string; category: string; categories: string[]; statusFilter: string; visible: Task[]; isEmpty: boolean; row: (task: Task) => ReactNode; onCreate: () => void; onCategoryChange: (value: string) => void; onStatusChange: (value: string) => void };
export default function Tasks({ title, dateLabel, category, categories, statusFilter, visible, isEmpty, row, onCreate, onCategoryChange, onStatusChange }: Props) {
  return <section className="panel task-panel"><div className="section-title"><h2>{title}</h2><span className="date-label">{dateLabel}</span></div>
        <div className="task-filters"><label className="filter-label">Категория<select aria-label="Фильтр по категории" value={category} onChange={e => onCategoryChange(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label><label className="filter-label">Статус<select aria-label="Фильтр по статусу" value={statusFilter} onChange={e => onStatusChange(e.target.value)}>{['Все статусы', 'Открытые', 'Выполненные'].map(s => <option key={s}>{s}</option>)}</select></label></div>
        <div className="task-list">{visible.length ? visible.map(row) : <div className="empty">{isEmpty ? 'Здесь пока нет задач. Добавьте первую.' : 'Задач с такими условиями нет.'}</div>}</div><button className="add-task" onClick={() => onCreate()}><Plus size={16}/> Добавить задачу</button>
      </section>;
}
