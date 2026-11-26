import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { updateProfile } from '../api/auth';
import { useAuth } from '../auth/AuthContext';
import { timezoneOptions } from '../lib/dates';
import './Profile.css';

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    studyGroup: user?.studyGroup ?? '',
    timezone: user?.timezone ?? 'Europe/Moscow',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timezones = useMemo(() => timezoneOptions(user?.timezone ?? ''), [user?.timezone]);

  if (!user) return null;

  const set = (name: keyof typeof form) => (e: { target: { value: string } }) => {
    setSaved(false);
    setForm((f) => ({ ...f, [name]: e.target.value }));
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateProfile({
        firstName: form.firstName,
        lastName: form.lastName,
        studyGroup: form.studyGroup.trim() || null,
        timezone: form.timezone,
      });
      setUser(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить изменения');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div>
      <h1>Профиль</h1>

      <div className="two-col profile-grid">
        <form className="card" onSubmit={save}>
          <div className="card-header"><h3>Личные данные</h3></div>
          <div className="field">
            <label htmlFor="firstName">Имя</label>
            <input id="firstName" required maxLength={100} value={form.firstName} onChange={set('firstName')} />
          </div>
          <div className="field">
            <label htmlFor="lastName">Фамилия</label>
            <input id="lastName" required maxLength={100} value={form.lastName} onChange={set('lastName')} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" value={user.email} disabled />
          </div>
          <div className="field">
            <label htmlFor="studyGroup">Группа</label>
            <input id="studyGroup" maxLength={50} value={form.studyGroup} onChange={set('studyGroup')} />
          </div>
          <div className="field">
            <label htmlFor="timezone">Часовой пояс</label>
            <select id="timezone" value={form.timezone} onChange={set('timezone')}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
          {error && <p className="form-error">{error}</p>}
          {saved && <p className="form-success">Изменения сохранены</p>}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить изменения'}
          </button>
        </form>

        <section className="card">
          <div className="card-header"><h3>Подключения</h3></div>
          <ul className="task-list">
            <li className="task-item">
              <span className="priority-dot" style={{ background: 'var(--border)' }}></span>
              <span className="task-title">ОРИОКС (журнал, расписание)</span>
              <span className="task-time">в разработке</span>
            </li>
            <li className="task-item">
              <span className="priority-dot" style={{ background: 'var(--border)' }}></span>
              <span className="task-title">Уведомления на почту</span>
              <span className="task-time">в разработке</span>
            </li>
          </ul>
          <div className="logout-block">
            <button className="btn btn-block" onClick={signOut}>Выйти из аккаунта</button>
          </div>
        </section>
      </div>
    </div>
  );
}
