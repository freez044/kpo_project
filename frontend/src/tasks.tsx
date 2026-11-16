import { useId, useState, type FormEvent } from 'react';
import { Check, Flag, Pencil, Trash2, X } from 'lucide-react';
import { apiRequest } from './services/api';
import Modal from './components/Modal';

import { statuses, priorities, type Task, type TaskInput } from './types/task';
export { statuses, priorities } from './types/task';
export type { Task, Dashboard, TaskInput } from './types/task';
export const isFinished = (task: Task) => task.status === 'DONE' || task.status === 'CANCELLED';
export function formatDeadline(value: string | null, zone: string) {
  return value ? new Date(value).toLocaleString('ru-RU', { timeZone: zone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Без срока';
}

function dateTimeInput(iso: string, zone: string) {
  const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
function deadlineISO(input: string, zone: string) {
  // Interpret wall-clock input in the user's timezone, not the device timezone.
  const target = Date.parse(input + ':00Z');
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const rendered = Date.parse(dateTimeInput(new Date(guess).toISOString(), zone) + ':00Z');
    guess += target - rendered;
  }
  if (dateTimeInput(new Date(guess).toISOString(), zone) !== input) throw new Error('Такого времени нет в вашем часовом поясе. Выберите другое время.');
  return new Date(guess).toISOString();
}

export function TaskRow({ task, zone, busy, onToggle, onEdit, onDelete }: { task: Task; zone: string; busy: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  return <div className={'task task-record ' + (isFinished(task) ? 'finished' : '')}>
    <button disabled={busy} className={'checkbox ' + (task.status === 'DONE' ? 'checked' : '')} aria-label={`${task.status === 'DONE' ? 'Вернуть в план' : 'Завершить'}: ${task.title}`} aria-pressed={task.status === 'DONE'} onClick={onToggle}>{task.status === 'DONE' && <Check size={14}/>}</button>
    <div className="task-body">{task.source === 'ORIOKS' && <span className="task-origin">ОРИОКС · неделя {task.orioks?.week}</span>}<button className="task-title" onClick={onEdit}>{task.title}</button>{task.description && <p className="task-description">{task.description}</p>}<>{task.orioks && <div className="orioks-task-dates"><span>Плановая сдача: {formatDeadline(task.orioks.plannedDueAt, zone)}</span><span>Без снижения до: {formatDeadline(task.deadline, zone)}</span>{task.orioks.stage === 'GRACE' && <strong>Можно сдать на следующем занятии без снижения</strong>}{task.orioks.stage === 'PENALTY' && <strong className="overdue-label">Расчётный срок без снижения прошёл</strong>}<small>{task.orioks.deadlineSource === 'MANUAL' ? 'Срок уточнён вручную' : task.orioks.deadlineSource === 'UNKNOWN' ? 'Срок требует уточнения' : 'Срок рассчитан по правилу предмета'}</small></div>}</><div className="task-meta">{task.category && <span className={'tag ' + (task.category === 'Учёба' ? 'study' : 'personal')}>{task.category}</span>}<span className={task.isOverdue ? 'overdue-label' : ''}>{task.isOverdue ? 'Просрочено · ' : ''}{formatDeadline(task.deadline, zone)}</span><span>{statuses[task.status]}</span></div></div>
    <span className={'priority ' + (task.priority === 'HIGH' || task.priority === 'URGENT' ? 'high' : '')}><Flag size={13}/><span>{priorities[task.priority]}</span></span>
    <div className="task-actions"><button className="icon-button" disabled={busy} onClick={onEdit} aria-label={`Редактировать: ${task.title}`} title="Редактировать"><Pencil size={15}/></button><button className="icon-button" disabled={busy} onClick={onDelete} aria-label={`Удалить: ${task.title}`} title="Удалить"><Trash2 size={15}/></button></div>
  </div>;
}

export function TaskEditor({ task, initialStatus, today, zone, onClose, onSaved }: { task: Task | null; initialStatus?: Task['status']; today: string; zone: string; onClose: () => void; onSaved: (task: Task) => void }) {
  const titleId = useId();
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [category, setCategory] = useState(task?.category || '');
  const [deadline, setDeadline] = useState(task?.deadline ? dateTimeInput(task.deadline, zone) : '');
  const [plannedDate, setPlannedDate] = useState(task ? task.plannedDate || '' : today);
  const [priority, setPriority] = useState<Task['priority']>(task?.priority || 'MEDIUM');
  const [status, setStatus] = useState<Task['status']>(task?.status || initialStatus || 'PLANNED');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setPending(true);
    try {
      const body: TaskInput = { title: title.trim(), description, category: category.trim() || null, deadline: deadline ? deadlineISO(deadline, zone) : null, plannedDate: plannedDate || null, priority, status };
      const saved = await apiRequest<Task>(task ? '/tasks/' + task.id : '/tasks', task ? 'PATCH' : 'POST', body);
      onSaved(saved);
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить задачу.'); }
    finally { setPending(false); }
  }
  return <Modal onClose={onClose} busy={pending} labelledBy={titleId}><div className="section-title"><h2 id={titleId}>{task ? 'Редактировать задачу' : 'Новая задача'}</h2><button disabled={pending} className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={20}/></button></div><form onSubmit={submit}><fieldset disabled={pending}>
    {task?.orioks && <div className="orioks-task-dates"><span>ОРИОКС · неделя {task.orioks.week}</span><span>Плановая сдача: {formatDeadline(task.orioks.plannedDueAt, zone)}</span><span>Поле «Дедлайн» ниже — последний срок без снижения баллов. Его изменение будет отмечено как ручное.</span></div>}<label>Название<input autoFocus required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} placeholder="Что нужно сделать?"/></label>
    <label>Описание<textarea maxLength={10000} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Детали, ссылки и заметки"/></label>
    <div className="field-row"><label>Дата в плане<input type="date" value={plannedDate} onInput={e => setPlannedDate(e.currentTarget.value)} onChange={e => setPlannedDate(e.target.value)}/></label><label>Дедлайн<input type="datetime-local" value={deadline} onInput={e => setDeadline(e.currentTarget.value)} onChange={e => setDeadline(e.target.value)}/></label></div><p className="muted">Время: {zone}. Дата в плане и дедлайн могут отличаться.</p>
    <div className="field-row"><label>Приоритет<select value={priority} onChange={e => setPriority(e.target.value as Task['priority'])}>{Object.entries(priorities).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>Статус<select value={status} onChange={e => setStatus(e.target.value as Task['status'])}>{Object.entries(statuses).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>
    <label>Категория <span className="muted">необязательно</span><input list="task-categories" maxLength={100} value={category} onChange={e => setCategory(e.target.value)} placeholder="Учёба, Личное или своя категория"/><datalist id="task-categories"><option value="Учёба"/><option value="Личное"/></datalist></label>
    {error && <p className="auth-error" role="alert">{error}</p>}<button className="primary" type="submit" disabled={!title.trim()}>{pending ? 'Сохраняем…' : task ? 'Сохранить изменения' : 'Создать задачу'}</button>
  </fieldset></form></Modal>;
}

export function DeleteTaskDialog({ task, onClose, onDeleted }: { task: Task; onClose: () => void; onDeleted: () => void }) {
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function remove() {
    setPending(true); setError('');
    try { await apiRequest('/tasks/' + task.id, 'DELETE'); onDeleted(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось удалить задачу.'); }
    finally { setPending(false); }
  }
  return <Modal onClose={onClose} busy={pending} labelledBy={titleId}><h2 id={titleId}>Удалить задачу?</h2><p className="delete-description">«{task.title}» будет удалена. Восстановить её не получится.</p>{error && <p role="alert" className="auth-error">{error}</p>}<div className="dialog-actions"><button className="text-button" disabled={pending} onClick={onClose}>Отмена</button><button className="danger-button" disabled={pending} onClick={remove}>{pending ? 'Удаляем…' : 'Удалить задачу'}</button></div></Modal>;
}
