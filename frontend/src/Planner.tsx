import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ArrowUpRight, CalendarDays, Check, CircleHelp, Clock3, Columns3, LayoutDashboard, ListTodo, Plus, RefreshCw, Sparkles, Sprout, Target, X } from 'lucide-react';
import { apiGet, apiRequest, useAuth } from './auth';
import { DeleteTaskDialog, TaskEditor, TaskRow, formatDeadline, type Dashboard, type Task } from './tasks';
import './task-styles.css';
import Kanban from './Kanban';
import Orioks from './Orioks';

const sections = [{ label: 'Главная', icon: LayoutDashboard }, { label: 'Задачи', icon: ListTodo }, { label: 'Канбан', icon: Columns3 }, { label: 'ОРИОКС', icon: BookOpen }, { label: 'Календарь', icon: CalendarDays }, { label: 'Цели', icon: Target }, { label: 'ИИ-ассистент', icon: Sparkles }];
export default function Planner() {
  const { user, logout } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState('Главная');
  const [category, setCategory] = useState('Все задачи');
  const [statusFilter, setStatusFilter] = useState('Все статусы');
  const [editor, setEditor] = useState<{task: Task | null; status?: Task['status']} | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [goals, setGoals] = useState<string[]>([]);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const loadVersion = useRef(0);
  const mutationInProgress = useRef(false);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    try {
      const [list, summary] = await Promise.all([apiGet<Task[]>('/tasks'), apiGet<Dashboard>('/dashboard')]);
      if (version !== loadVersion.current) return;
      setTasks(list); setDashboard(summary); setLoadError('');
    } catch (err) { if (version === loadVersion.current) setLoadError(err instanceof Error ? err.message : 'Не удалось загрузить задачи.'); }
    finally { if (version === loadVersion.current) setLoading(false); }
  }, []);
  useEffect(() => {
    let active = true;
    const update = () => { if (active) void load(); };
    update(); const timer = window.setInterval(update, 60000);
    window.addEventListener('focus', update);
    window.addEventListener('planner-tasks-changed', update);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('planner-tasks-changed', update); };
  }, [load]);
  async function signOut() {
    setLoggingOut(true);
    try { await logout(); } catch (err) { setNotice(err instanceof Error ? err.message : 'Не удалось выйти.'); }
    finally { setLoggingOut(false); }
  }
  async function toggle(task: Task) {
    return changeStatus(task, task.status === 'DONE' ? 'PLANNED' : 'DONE');
  }
  async function changeStatus(task: Task, status: Task['status']) {
    if (mutationInProgress.current || task.status === status) return;
    mutationInProgress.current = true;
    ++loadVersion.current;
    setBusyId(task.id); setNotice('');
    try {
      const updated = await apiRequest<Task>('/tasks/' + task.id, 'PATCH', { status });
      setTasks(all => all.map(t => t.id === updated.id ? updated : t));
      setNotice('Статус задачи сохранён.');
      await load();
    } catch (err) { setNotice(err instanceof Error ? err.message : 'Не удалось изменить статус.'); }
    finally { mutationInProgress.current = false; setBusyId(null); }
  }
  function saved(task: Task) {
    setTasks(all => [...all.filter(t => t.id !== task.id), task]);
    setEditor(null); setNotice('Задача сохранена.'); void load();
  }
  const today = dashboard?.today || [];
  const overdue = dashboard?.overdue || [];
  const upcoming = dashboard?.upcoming || [];
  const categories = ['Все задачи', ...new Set(['Учёба', 'Личное', ...tasks.map(t => t.category).filter((c): c is string => Boolean(c))])];
  const visible = (section === 'Задачи' ? tasks : today).filter(t => (category === 'Все задачи' || t.category === category) && (statusFilter === 'Все статусы' || (statusFilter === 'Открытые' ? t.status !== 'DONE' && t.status !== 'CANCELLED' : t.status === 'DONE')));
  const dateLabel = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long', timeZone: user.timezone });
  const row = (task: Task) => <TaskRow key={task.id} task={task} zone={user.timezone} busy={busyId !== null} onToggle={() => void toggle(task)} onEdit={() => setEditor({ task })} onDelete={() => setDeleting(task)}/>;
  return <div className="app"><aside className="sidebar">
    <a className="brand" href="#" onClick={() => setSection('Главная')}><span className="brand-icon"><Sprout size={25}/></span><span>adaptive<span className="brand-sub">AI PLANNER</span></span></a>
    <div className="workspace-label">ЛИЧНОЕ ПРОСТРАНСТВО</div><nav aria-label="Основная навигация">{sections.map(s => <button key={s.label} aria-label={s.label} title={s.label} className={'nav-item ' + (section === s.label ? 'active' : '')} onClick={() => { setSection(s.label); setCategory('Все задачи'); setStatusFilter('Все статусы'); }}><s.icon size={19}/><span>{s.label}</span>{s.label === 'ИИ-ассистент' && <span className="soon">СКОРО</span>}</button>)}</nav>
    <div className="sidebar-note"><span className="tiny-icon"><Sprout size={20}/></span><strong>Маленькие шаги.<br/>Большие результаты.</strong><p>Освободите мысли —<br/>соберите всё в одном месте.</p></div>
    <button className="help" onClick={() => setNotice('Задачи сохраняются в вашем аккаунте. Дата в плане определяет день на главной; дедлайн — крайний срок. Цели пока временные.')}><CircleHelp size={18}/> Как это работает</button>
    <div className="profile"><span className="avatar">{user.firstName[0]}</span><div><strong>{user.firstName} {user.lastName}</strong><small title={user.email}>{user.email}</small></div><span className="online"/></div>
  </aside><div className="main-wrap"><header className="topbar"><span>Моё пространство <span className="slash">/</span><strong>{section}</strong></span><button className="logout-button" disabled={loggingOut} onClick={signOut}>{loggingOut ? 'Выходим…' : 'Выйти'}</button></header><main>
    <div className="page-heading"><div><div className="eyebrow">ВАШ ДЕНЬ, ВАШ РИТМ</div><h1>{section === 'Главная' ? 'Всё начинается с плана' : section}</h1><p>Учёба, личные дела и немного времени для себя.</p></div><button className="primary" onClick={() => setEditor({ task: null })}><Plus size={18}/> Новая задача</button></div>
    <div className="prototype-note">{user.email} · Задачи сохраняются в аккаунте</div>
    {notice && <div className="notice" role="status">{notice}<button aria-label="Закрыть уведомление" onClick={() => setNotice('')}><X size={17}/></button></div>}
    {loadError && <div className="auth-error load-error" role="alert"><span>{loadError} {dashboard ? 'Показаны последние загруженные данные.' : ''}</span><button className="text-button" onClick={() => void load()}><RefreshCw size={15}/> Повторить</button></div>}
    {section === 'Канбан' && (loading ? <section className="panel empty" role="status">Загружаем доску…</section> : !dashboard ? <section className="panel empty">Не удалось загрузить задачи. Повторите попытку выше.</section> : <Kanban tasks={tasks} zone={user.timezone} busyId={busyId} onMove={changeStatus} onEdit={task => setEditor({ task })} onDelete={setDeleting} onCreate={status => setEditor({ task: null, status })}/>)}
    {(section === 'Главная' || section === 'Задачи') && (loading ? <section className="panel empty" role="status">Загружаем ваши задачи…</section> : !dashboard ? <section className="panel empty">Задачи пока не загружены. Повторите попытку выше.</section> : <>
      <div className="stats"><div className="stat"><span>На сегодня <CalendarDays size={18}/></span><strong>{today.length}<small>в плане на день</small></strong></div><div className="stat"><span>Выполнено <Check size={18}/></span><strong>{dashboard.completedCount}<small>из {today.length} на сегодня</small></strong><div className="progress"><i style={{ width: `${today.length ? dashboard.completedCount / today.length * 100 : 0}%` }}/></div></div><div className="stat"><span>Просрочено <Clock3 size={18}/></span><strong className="terracotta">{overdue.length}<small>{overdue.length ? 'нуждается во внимании' : 'всё под контролем'}</small></strong></div></div>
      <div className="dashboard-grid"><div className="left-column"><section className="panel task-panel"><div className="section-title"><h2>{section === 'Задачи' ? 'Все задачи' : 'План на сегодня'}</h2><span className="date-label">{dateLabel}</span></div>
        <div className="task-filters"><label className="filter-label">Категория<select aria-label="Фильтр по категории" value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label><label className="filter-label">Статус<select aria-label="Фильтр по статусу" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>{['Все статусы', 'Открытые', 'Выполненные'].map(s => <option key={s}>{s}</option>)}</select></label></div>
        <div className="task-list">{visible.length ? visible.map(row) : <div className="empty">{tasks.length === 0 ? 'Здесь пока нет задач. Добавьте первую.' : 'Задач с такими условиями нет.'}</div>}</div><button className="add-task" onClick={() => setEditor({ task: null })}><Plus size={16}/> Добавить задачу</button>
      </section><section className="panel deadlines"><div className="section-title"><h2>Просроченные задачи</h2><span className="muted">Нуждаются во внимании</span></div>{overdue.length ? overdue.map(row) : <p className="empty">Просроченных задач нет. Отличный темп!</p>}</section>
      <section className="panel deadlines"><div className="section-title"><h2>Ближайшие дедлайны</h2><span className="muted">Следующие 7 дней</span></div>{upcoming.length ? upcoming.map(t => <button key={t.id} className="deadline-row deadline-button" onClick={() => setEditor({ task: t })}><span className="deadline-date neutral"><CalendarDays size={20}/></span><span><strong>{t.title}</strong><span className="deadline-caption">{formatDeadline(t.deadline, user.timezone)} · {t.category || 'Без категории'}</span></span><ArrowUpRight size={16}/></button>) : <p className="empty">На ближайшую неделю дедлайнов нет.</p>}</section>
      </div><div className="right-column"><section className="focus-card"><span className="focus-label"><Sprout size={17}/> МЕСТО ДЛЯ ГЛАВНОГО</span><h2>Не всё сразу.<br/>Одно дело за раз.</h2><p>Выберите небольшую задачу,<br/>с которой начнётся ваш день.</p><button onClick={() => setEditor({ task: null })}>Запланировать шаг <ArrowUpRight size={17}/></button><div className="plant-art" aria-hidden="true"><span/><span/><span/><span/><i/></div></section>
      <section className="panel goals"><div className="section-title"><h2>Мои цели</h2><Target size={18}/></div><p className="muted">Цели пока сохраняются только до обновления страницы.</p>{goals.length ? goals.slice(0, 2).map((g, i) => <div className="goal" key={i}><span className="goal-dot"/><div><strong>{g}</strong></div></div>) : <p className="empty">Большие планы начинаются с первой цели.</p>}<button className="text-button" onClick={() => { setGoalTitle(''); setGoalOpen(true); }}><Plus size={15}/> Создать цель</button></section>
      <button className="calendar-link" onClick={() => setSection('Календарь')}><CalendarDays size={20}/><span><strong>Взглянуть на неделю</strong><small>Перейти в календарь</small></span><ArrowUpRight size={18}/></button></div></div>
    </>)}
    {section === 'ОРИОКС' && <Orioks/>}
    {section === 'Календарь' && <section className="panel placeholder"><CalendarDays size={38}/><h2>Здесь будет ваше расписание</h2><p>Календарь появится на следующем этапе.<br/>Сейчас дату в плане можно выбрать в карточке задачи.</p><button className="text-button" onClick={() => setSection('Главная')}>Вернуться к плану на день</button></section>}
    {section === 'Цели' && <section className="panel"><div className="section-title"><h2>То, к чему вы идёте</h2><button className="text-button" onClick={() => { setGoalTitle(''); setGoalOpen(true); }}><Plus size={16}/> Создать цель</button></div><p className="muted">Цели пока временные: сбрасываются после обновления и выхода.</p>{goals.map((g, i) => <div className="goal" key={i}><Target size={20}/><strong>{g}</strong></div>)}</section>}
    {section === 'ИИ-ассистент' && <section className="panel placeholder"><Sparkles size={38}/><h2>Помощник для больших планов</h2><p>ИИ пока не подключён. Внешние запросы не отправляются.</p></section>}
    <footer><span>Adaptive AI Planner</span><span>Больше ясности. Меньше суеты.</span></footer>
  </main></div>
  {editor && <TaskEditor task={editor.task} initialStatus={editor.status} today={dashboard?.date || new Intl.DateTimeFormat('sv-SE', { timeZone: user.timezone }).format(new Date())} zone={user.timezone} onClose={() => setEditor(null)} onSaved={saved}/>}
  {deleting && <DeleteTaskDialog task={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setTasks(all => all.filter(t => t.id !== deleting.id)); setDeleting(null); setNotice('Задача удалена.'); void load(); }}/>}
  {goalOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="goal-title"><div className="section-title"><h2 id="goal-title">Новая цель</h2><button aria-label="Закрыть" onClick={() => setGoalOpen(false)}><X size={20}/></button></div><form onSubmit={e => { e.preventDefault(); if (goalTitle.trim()) { setGoals(all => [...all, goalTitle.trim()]); setGoalOpen(false); } }}><label>Название<input autoFocus required maxLength={200} value={goalTitle} onChange={e => setGoalTitle(e.target.value)}/></label><p className="muted">Пока сохраняется только до обновления страницы.</p><button className="primary" type="submit" disabled={!goalTitle.trim()}>Добавить цель</button></form></section></div>}
  </div>;
}


