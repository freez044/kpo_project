import type { User } from '../auth';
import type { Task } from '../tasks';

export function Profile({ user, onOrioks, onLogout, signingOut }: {
  user: User; onOrioks: () => void; onLogout: () => void; signingOut: boolean;
}) {
  return (
    <div className="two-col">
      <section className="card">
        <h3>Личные данные</h3>
        <dl><dt>Имя</dt><dd>{user.firstName} {user.lastName}</dd>
          <dt>Email</dt><dd>{user.email}</dd><dt>Группа</dt><dd>{user.studyGroup || 'Не указана'}</dd>
          <dt>Часовой пояс</dt><dd>{user.timezone}</dd></dl>
        <button className="btn" disabled={signingOut} onClick={onLogout}>{signingOut ? 'Выходим…' : 'Выйти из аккаунта'}</button>
      </section>
      <section className="card"><h3>Подключения</h3><button className="btn btn-primary" onClick={onOrioks}>Управление ОРИОКС</button></section>
    </div>
  );
}

export function Analytics({ tasks }: { tasks: Task[] }) {
  const completed = tasks.filter(task => task.status === 'DONE');
  const withDeadline = completed.filter(task => task.deadline && task.completedAt);
  const onTime = withDeadline.filter(task => Date.parse(task.completedAt!) <= Date.parse(task.deadline!));
  const stats = [
    { value: tasks.length, label: 'Всего задач' },
    { value: completed.length, label: 'Выполнено' },
    { value: tasks.filter(task => task.isOverdue).length, label: 'Просрочено' },
    { value: withDeadline.length ? `${Math.round(100 * onTime.length / withDeadline.length)}%` : '—', label: 'Выполнено в срок среди задач с дедлайном' },
  ];
  return (
    <div className="stat-grid">
      {stats.map(stat => <div className="stat-card" key={stat.label}>
        <div className="stat-value">{stat.value}</div><div className="stat-label">{stat.label}</div>
      </div>)}
    </div>
  );
}
