import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Target, X } from 'lucide-react';
import { apiGet, apiRequest } from './services/api';
import { useAuth } from './services/auth';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Modal from './components/Modal';
import DashboardPage from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Calendar from './pages/Calendar';
import Assistant from './pages/Assistant';

import { DeleteTaskDialog, TaskEditor, TaskRow, type Dashboard, type Task } from './tasks';
import './task-styles.css';
import Kanban from './Kanban';
import Orioks from './Orioks';

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
  function navigate(next: string) { setSection(next); setCategory('Все задачи'); setStatusFilter('Все статусы'); }
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
  return <div className="app"><Sidebar user={user} section={section} onNavigate={navigate} onNotice={setNotice}/><div className="main-wrap"><Header section={section} loggingOut={loggingOut} onLogout={() => void signOut()}/><main>
    <div className="page-heading"><div><div className="eyebrow">ВАШ ДЕНЬ, ВАШ РИТМ</div><h1>{section === 'Главная' ? 'Всё начинается с плана' : section}</h1><p>Учёба, личные дела и немного времени для себя.</p></div><button className="primary" onClick={() => setEditor({ task: null })}><Plus size={18}/> Новая задача</button></div>
    <div className="prototype-note">{user.email} · Задачи сохраняются в аккаунте</div>
    {notice && <div className="notice" role="status">{notice}<button aria-label="Закрыть уведомление" onClick={() => setNotice('')}><X size={17}/></button></div>}
    {loadError && <div className="auth-error load-error" role="alert"><span>{loadError} {dashboard ? 'Показаны последние загруженные данные.' : ''}</span><button className="text-button" onClick={() => void load()}><RefreshCw size={15}/> Повторить</button></div>}
    {section === 'Канбан' && (loading ? <section className="panel empty" role="status">Загружаем доску…</section> : !dashboard ? <section className="panel empty">Не удалось загрузить задачи. Повторите попытку выше.</section> : <Kanban tasks={tasks} zone={user.timezone} busyId={busyId} onMove={changeStatus} onEdit={task => setEditor({ task })} onDelete={setDeleting} onCreate={status => setEditor({ task: null, status })}/>)}
    {(section === 'Главная' || section === 'Задачи') && (loading ? <section className="panel empty" role="status">Загружаем ваши задачи…</section> : !dashboard ? <section className="panel empty">Задачи пока не загружены. Повторите попытку выше.</section> : <>
      <DashboardPage today={today} overdue={overdue} upcoming={upcoming} completedCount={dashboard.completedCount} user={user} goals={goals} row={row} onCreate={() => setEditor({ task: null })} onEdit={task => setEditor({ task })} onCreateGoal={() => { setGoalTitle(''); setGoalOpen(true); }} onCalendar={() => navigate('Календарь')}>
        <Tasks title={section === 'Задачи' ? 'Все задачи' : 'План на сегодня'} dateLabel={dateLabel} category={category} categories={categories} statusFilter={statusFilter} visible={visible} isEmpty={tasks.length === 0} row={row} onCreate={() => setEditor({ task: null })} onCategoryChange={setCategory} onStatusChange={setStatusFilter}/>
      </DashboardPage>
    </>)}
    {section === 'ОРИОКС' && <Orioks/>}
    {section === 'Календарь' && <Calendar onHome={() => navigate('Главная')}/>}
    {section === 'Цели' && <section className="panel"><div className="section-title"><h2>То, к чему вы идёте</h2><button className="text-button" onClick={() => { setGoalTitle(''); setGoalOpen(true); }}><Plus size={16}/> Создать цель</button></div><p className="muted">Цели пока временные: сбрасываются после обновления и выхода.</p>{goals.map((g, i) => <div className="goal" key={i}><Target size={20}/><strong>{g}</strong></div>)}</section>}
    {section === 'ИИ-ассистент' && <Assistant/>}
    <footer><span>Adaptive AI Planner</span><span>Больше ясности. Меньше суеты.</span></footer>
  </main></div>
  {editor && <TaskEditor task={editor.task} initialStatus={editor.status} today={dashboard?.date || new Intl.DateTimeFormat('sv-SE', { timeZone: user.timezone }).format(new Date())} zone={user.timezone} onClose={() => setEditor(null)} onSaved={saved}/>}
  {deleting && <DeleteTaskDialog task={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setTasks(all => all.filter(t => t.id !== deleting.id)); setDeleting(null); setNotice('Задача удалена.'); void load(); }}/>}
  {goalOpen && <Modal onClose={() => setGoalOpen(false)} labelledBy="goal-title"><div className="section-title"><h2 id="goal-title">Новая цель</h2><button aria-label="Закрыть" onClick={() => setGoalOpen(false)}><X size={20}/></button></div><form onSubmit={e => { e.preventDefault(); if (goalTitle.trim()) { setGoals(all => [...all, goalTitle.trim()]); setGoalOpen(false); } }}><label>Название<input autoFocus required maxLength={200} value={goalTitle} onChange={e => setGoalTitle(e.target.value)}/></label><p className="muted">Пока сохраняется только до обновления страницы.</p><button className="primary" type="submit" disabled={!goalTitle.trim()}>Добавить цель</button></form></Modal>}
  </div>;
}
