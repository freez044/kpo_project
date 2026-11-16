import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, LogIn, Sprout } from 'lucide-react';
import './auth.css';
import PasswordRecovery from './PasswordRecovery';

export type User = { id: string; email: string; firstName: string; lastName: string; studyGroup: string | null; timezone: string };
type Session = { accessToken: string; expiresIn: number; user: User };
type AuthContextValue = { user: User; logout: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);
let accessToken: string | null = null;
let refreshing: Promise<Session> | null = null;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, body?: unknown, token?: string | null, method?: string, timeoutMs = 15000): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/v1' + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      credentials: 'same-origin',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiError(0, 'Не удалось связаться с сервером. Проверьте подключение и повторите попытку.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error?.message || 'Сервер временно недоступен. Попробуйте ещё раз.');
  }
  return response.status === 204 ? undefined as T : response.json();
}

export function authRequest<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, body);
}

function refresh(): Promise<Session> {
  // One rotation at a time, including StrictMode double mounting.
  if (!refreshing) {
    const rotate = () => request<Session>('/auth/refresh', {});
    const operation = navigator.locks ? navigator.locks.request('planner-refresh', rotate) : rotate();
    refreshing = operation.then(async result => { const session = await result; accessToken = session.accessToken; return session; }).finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiRequest<T>(path: string, method = 'GET', body?: unknown, timeoutMs = 15000): Promise<T> {
  const originalUser = accessToken;
  try { return await request<T>(path, body, accessToken, method, timeoutMs); }
  catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    await refresh();
    // A different browser tab may have switched the shared cookie to another account.
    const subject = (token: string | null) => token ? JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub : null;
    if (subject(originalUser) !== subject(accessToken)) {
      window.dispatchEvent(new Event('planner-account-change'));
      throw new ApiError(401, 'Аккаунт изменился в другой вкладке. Откройте своё пространство заново.');
    }
    return request<T>(path, body, accessToken, method, timeoutMs);
  }
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider is required');
  return context;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    refresh().then(session => { if (active) setUser(session.user); }).catch(err => {
      if (active && (!(err instanceof ApiError) || err.status !== 401)) setError(err.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const checkSession = () => {
      apiGet<User>('/me').then(current => {
        if (active && current.id !== user.id) setUser(current);
      }).catch(err => {
        if (active && err instanceof ApiError && err.status === 401) {
          accessToken = null;
          setUser(null);
        }
      });
    };
    const timer = window.setInterval(checkSession, 60000);
    window.addEventListener('focus', checkSession);
    window.addEventListener('planner-account-change', checkSession);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', checkSession); window.removeEventListener('planner-account-change', checkSession); };
  }, [user]);

  async function logout() {
    // Do not show a successful logout while the server has not revoked the cookie.
    if (refreshing) await refreshing.catch(() => undefined);
    await request('/auth/logout', {});
    accessToken = null;
    setUser(null);
  }
  function signedIn(session: Session) { accessToken = session.accessToken; setUser(session.user); }
  if (loading) return <div className="auth-loading"><Sprout size={34}/><p>Открываем ваше пространство…</p></div>;
  if (error) return <div className="auth-loading"><Sprout size={34}/><h2>Сервер пока недоступен</h2><p role="alert">{error}</p><button className="primary" onClick={() => { setError(''); setLoading(true); setAttempt(a => a + 1); }}>Повторить попытку</button></div>;
  if (!user) return <AuthPage onSuccess={signedIn}/>;
  return <AuthContext.Provider value={{ user, logout }}><div key={user.id}>{children}</div></AuthContext.Provider>;
}

function AuthPage({ onSuccess }: { onSuccess: (session: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [group, setGroup] = useState('');
  const [recovering, setRecovering] = useState(false);
  function changeMode() { setMode(m => m === 'login' ? 'register' : 'login'); setError(''); setPassword(''); setConfirm(''); setShowPassword(false); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirm) { setError('Пароли не совпадают. Проверьте повтор пароля.'); return; }
    setPending(true);
    try {
      const body = { email: email.trim(), password, ...(mode === 'register' ? { firstName: firstName.trim(), lastName: lastName.trim(), studyGroup: group.trim() || null, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow' } : {}) };
      onSuccess(await request<Session>('/auth/' + mode, body));
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось войти. Попробуйте ещё раз.'); }
    finally { setPending(false); }
  }
  return <div className="auth-page">
    <aside className="auth-story"><a href="#" className="brand"><span className="brand-icon"><Sprout size={25}/></span><span>adaptive<span className="brand-sub">AI PLANNER</span></span></a><div className="auth-story-body"><span className="eyebrow">МЕСТО ДЛЯ ВАШИХ ПЛАНОВ</span><h1>Большие цели.<br/>Понятные шаги.</h1><p>Учёба, личные задачи и время для себя.<br/>Соберите свой день в одном пространстве.</p><div className="auth-illustration" aria-hidden="true"><span className="illustration-line"/><span className="illustration-leaf one"/><span className="illustration-leaf two"/><span className="illustration-leaf three"/><span className="illustration-circle"/></div></div><small>Больше ясности. Меньше суеты.</small></aside>
    <main className="auth-main"><section className="auth-form-panel"><span className="auth-badge"><Sprout size={16}/> ВАШЕ ЛИЧНОЕ ПРОСТРАНСТВО</span><h1>{recovering ? 'Восстановить пароль' : mode === 'login' ? 'С возвращением' : 'Начнём с знакомства'}</h1><p>{recovering ? 'Вернём доступ к вашим планам через email.' : mode === 'login' ? 'Войдите, чтобы продолжить свой день.' : 'Создайте аккаунт и освободите место для главного.'}</p>
      {recovering ? <PasswordRecovery initialEmail={email} onBack={value => { setEmail(value); setPassword(''); setConfirm(''); setError(''); setMode('login'); setRecovering(false); }}/> : <>
      <form onSubmit={submit}>
        <fieldset disabled={pending}>
          {mode === 'register' && <div className="auth-name-row"><label>Имя<input name="firstName" autoComplete="given-name" required maxLength={100} value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="Иван"/></label><label>Фамилия<input name="lastName" autoComplete="family-name" required maxLength={100} value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Иванов"/></label></div>}
          <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></label>
          <label>Пароль<span className="password-field"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === 'login' ? 'Введите пароль' : 'Не менее 8 символов'}/><button type="button" aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={showPassword} onClick={() => setShowPassword(s => !s)}>{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></span></label>
          {mode === 'register' && <><label>Повторите пароль<input name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Ещё раз, чтобы не ошибиться"/></label><label>Учебная группа <span className="optional">необязательно</span><input name="studyGroup" maxLength={50} value={group} onChange={e => setGroup(e.target.value)} placeholder="Например, ПИН-31"/></label></>}
          {mode === 'login' && <button type="button" className="forgot-password" onClick={() => { setPassword(''); setConfirm(''); setError(''); setRecovering(true); }}>Забыли пароль?</button>}
          {error && <div className="auth-error" role="alert">{error}</div>}
          <button className="primary auth-submit" type="submit">{pending ? 'Подождите…' : mode === 'login' ? 'Войти в аккаунт' : 'Создать аккаунт'}{!pending && (mode === 'login' ? <LogIn size={17}/> : <ArrowRight size={17}/>)}</button>
        </fieldset>
      </form>
      <p className="auth-switch">{mode === 'login' ? 'Ещё нет аккаунта?' : 'Уже есть аккаунт?'} <button disabled={pending} onClick={changeMode}>{mode === 'login' ? 'Зарегистрироваться' : 'Войти'}</button></p>
      </>}
      <div className="auth-local-note">Локальная версия · аккаунты хранятся на этом компьютере</div>
    </section></main>
  </div>;
}
