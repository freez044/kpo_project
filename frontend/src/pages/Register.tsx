import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { browserTimezone, timezoneOptions } from '../lib/dates';
import './Auth.css';

export default function Register() {
  const { status, register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    studyGroup: '',
    timezone: browserTimezone(),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezones = useMemo(() => timezoneOptions(), []);

  if (status === 'loading') return <div className="center-screen muted">Загрузка…</div>;
  if (status === 'authenticated') return <Navigate to="/" replace />;

  const set = (name: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [name]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ ...form, studyGroup: form.studyGroup.trim() || null });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось зарегистрироваться');
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={submit}>
        <h1>Регистрация</h1>
        <p className="auth-subtitle">Данные хранятся на сервере и доступны с любого устройства</p>
        <div className="field-row">
          <div className="field">
            <label htmlFor="firstName">Имя</label>
            <input id="firstName" required maxLength={100} autoComplete="given-name"
              value={form.firstName} onChange={set('firstName')} />
          </div>
          <div className="field">
            <label htmlFor="lastName">Фамилия</label>
            <input id="lastName" required maxLength={100} autoComplete="family-name"
              value={form.lastName} onChange={set('lastName')} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="username"
            value={form.email} onChange={set('email')} />
        </div>
        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input id="password" type="password" required minLength={8} maxLength={128}
            autoComplete="new-password" value={form.password} onChange={set('password')} />
          <span className="field-hint">Не короче 8 символов</span>
        </div>
        <div className="field">
          <label htmlFor="studyGroup">Учебная группа (необязательно)</label>
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
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Создаём аккаунт…' : 'Зарегистрироваться'}
        </button>
        <p className="auth-switch">
          Уже есть аккаунт? <Link to="/login">Войти</Link>
        </p>
      </form>
    </div>
  );
}
