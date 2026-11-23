import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiRequest, useAuth } from './auth';
import { DeleteTaskDialog, TaskEditor, TaskRow, type Dashboard as DashboardData, type Task } from './tasks';
import './task-styles.css';
import Kanban from './Kanban';
import Orioks from './Orioks';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Calendar from './pages/Calendar';
import { Analytics, Profile } from './pages/AccountViews';
import './styles/connected-shell.css';

export default function Planner() {
  const { user, logout } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [section, setSection] = useState('Главная');
  const [editor, setEditor] = useState<{task: Task | null; status?: Task['status']; date?: string} | null>(null);
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
      const [list, summary] = await Promise.all([apiGet<Task[]>('/tasks'), apiGet<DashboardData>('/dashboard')]);
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

  const date = dashboard?.date ?? new Intl.DateTimeFormat('sv-SE', { timeZone: user.timezone }).format(new Date());
  const row = (task: Task) => <TaskRow key={task.id} task={task} zone={user.timezone} busy={busyId !== null}
    onToggle={() => void toggle(task)} onEdit={() => setEditor({ task })} onDelete={() => setDeleting(task)} />;
  const create = (date?: string) => setEditor({ task: null, date });
  const needsTasks = ['Главная', 'Задачи', 'Канбан', 'Календарь', 'Аналитика'].includes(section);
  const showTasks = needsTasks && dashboard;

  return (
    <div className="team-shell">
      <Sidebar section={section} onNavigate={setSection} />
      <div className="team-content">
        <Header section={section} onNavigate={setSection} />
        <main className="team-page">
          {notice && <div className="notice" role="status">{notice}<button aria-label="Закрыть уведомление" onClick={() => setNotice('')}>×</button></div>}
          {needsTasks && loading && <p role="status">Загружаем задачи…</p>}
          {needsTasks && loadError && <div className="auth-error" role="alert">{loadError} <button className="btn" onClick={() => void load()}>Повторить</button></div>}
          {showTasks && section === 'Главная' && <Dashboard tasks={tasks} summary={dashboard} row={row} onCreate={create} />}
          {showTasks && section === 'Задачи' && <Tasks tasks={tasks} date={date} row={row} onCreate={() => create()} />}
          {showTasks && section === 'Календарь' && <Calendar tasks={tasks} date={date} zone={user.timezone} onEdit={task => setEditor({ task })} onCreate={create} />}
          {showTasks && section === 'Аналитика' && <Analytics tasks={tasks} />}
          {showTasks && section === 'Канбан' && <Kanban tasks={tasks} zone={user.timezone} busyId={busyId}
            onMove={changeStatus} onEdit={task => setEditor({ task })} onDelete={setDeleting} onCreate={status => setEditor({ task: null, status })} />}
          {section === 'ОРИОКС' && <Orioks />}
          {section === 'Профиль' && <Profile user={user} onOrioks={() => setSection('ОРИОКС')} signingOut={loggingOut} onLogout={() => void signOut()} />}
          {section === 'AI-помощник' && <section className="card"><h1>AI-помощник</h1><p>Помощник пока недоступен.</p></section>}
          {section === 'Помощь' && <section className="card"><h1>Помощь</h1><p>Подключите ОРИОКС и импортируйте задания, чтобы увидеть их в списке и на доске.</p><button className="btn" onClick={() => setSection('ОРИОКС')}>Открыть ОРИОКС</button></section>}
          {section === 'Цели' && <section className="card"><div className="card-header"><h1>Цели</h1><button className="btn btn-primary" onClick={() => { setGoalTitle(''); setGoalOpen(true); }}>Создать цель</button></div>
            <p>Цели сохраняются до обновления страницы.</p><ul>{goals.map((goal, index) => <li key={index}>{goal}</li>)}</ul></section>}
        </main>
      </div>
      {editor && <TaskEditor task={editor.task} initialStatus={editor.status} today={editor.date ?? date} zone={user.timezone} onClose={() => setEditor(null)} onSaved={saved} />}
      {deleting && <DeleteTaskDialog task={deleting} onClose={() => setDeleting(null)} onDeleted={() => {
        setTasks(all => all.filter(task => task.id !== deleting.id));
        setDeleting(null);
        setNotice('Задача удалена.');
        void load();
      }} />}
      {goalOpen && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="goal-title">
        <div className="section-title"><h2 id="goal-title">Новая цель</h2><button aria-label="Закрыть" onClick={() => setGoalOpen(false)}>×</button></div>
        <form onSubmit={event => {
          event.preventDefault();
          if (!goalTitle.trim()) return;
          setGoals(all => [...all, goalTitle.trim()]);
          setGoalOpen(false);
        }}>
          <label>Название<input autoFocus required maxLength={200} value={goalTitle} onChange={event => setGoalTitle(event.target.value)} /></label>
          <button className="primary" type="submit" disabled={!goalTitle.trim()}>Добавить цель</button>
        </form>
      </section></div>}
    </div>
  );
}
