import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Mail } from 'lucide-react';
import { authRequest } from './auth';

export default function PasswordRecovery({ initialEmail, onBack }: { initialEmail: string; onBack: (email: string) => void }) {
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    const interval = window.setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(interval);
  }, []);
  async function sendCode(event?: FormEvent) {
    event?.preventDefault(); setError(''); setPending(true);
    try {
      const result = await authRequest<{ message: string; retryAfter: number }>('/auth/password/request', { email: email.trim() });
      setEmail(email.trim()); setCode(''); setMessage(result.message); setCooldown(result.retryAfter); setStep('code');
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось запросить код.'); }
    finally { setPending(false); }
  }
  async function reset(event: FormEvent) {
    event.preventDefault(); setError('');
    if (password !== confirm) { setError('Пароли не совпадают. Проверьте повтор пароля.'); return; }
    setPending(true);
    try {
      await authRequest('/auth/password/reset', { email, code, newPassword: password });
      setCode(''); setPassword(''); setConfirm(''); setStep('done');
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось изменить пароль.'); }
    finally { setPending(false); }
  }
  if (step === 'done') return <div className="recovery-success" role="status"><span><Check size={24}/></span><h2>Пароль изменён</h2><p>Все прежние сеансы завершены. Теперь войдите с новым паролем.</p><button className="primary auth-submit" onClick={() => onBack(email)}>Вернуться ко входу</button></div>;
  return <div className="password-recovery">
    {step === 'email' ? <form onSubmit={sendCode}><fieldset disabled={pending}><label>Email аккаунта<input name="recoveryEmail" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com"/></label><p className="recovery-help">Пришлём одноразовый код на почту, указанную при регистрации.</p>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary auth-submit" type="submit">{pending ? 'Подождите…' : 'Получить код'}<Mail size={17}/></button></fieldset></form> : <>
      <div className="recovery-message" role="status"><p>{message}</p><strong>{email}</strong><small>Проверьте также папку «Спам».</small></div>
      <form onSubmit={reset}><fieldset disabled={pending}><label>Код из письма<input className="recovery-code" name="recoveryCode" type="text" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/[^0-9]/g, ''))} placeholder="000000"/></label><label>Новый пароль<input name="newPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="Не менее 8 символов"/></label><label>Повторите новый пароль<input name="confirmNewPassword" type="password" autoComplete="new-password" required minLength={8} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="Введите новый пароль ещё раз"/></label>{error && <p className="auth-error" role="alert">{error}</p>}<button className="primary auth-submit" type="submit">{pending ? 'Сохраняем…' : 'Сохранить новый пароль'}</button></fieldset></form>
      <div className="recovery-actions"><button disabled={pending || cooldown > 0} onClick={() => void sendCode()}>{cooldown ? `Отправить снова через ${cooldown} с` : 'Отправить код ещё раз'}</button><button disabled={pending} onClick={() => { setStep('email'); setError(''); setCode(''); }}>Другой email</button></div>
    </>}
    <button className="recovery-back" disabled={pending} onClick={() => onBack(email)}><ArrowLeft size={14}/> Вернуться ко входу</button>
  </div>;
}
