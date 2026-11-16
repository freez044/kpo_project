import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Check, Link2, RefreshCw, ShieldCheck, Unplug } from 'lucide-react';
import { apiGet, apiRequest } from './services/api';
import './orioks.css';
import OrioksPlanning from './OrioksPlanning';

type Event = { alias: string | null; name: string | null; type: string; week: number; current_grade: number | null; max_grade: number };
type Discipline = { id: number; name: string; department: string; teachers: string[] | null; control_form: string | null; current_grade: number | null; max_grade: number; events: Event[] };
type Connection = { connected: boolean; needsReconnect: boolean; lastError: string | null; snapshot: { student: { full_name: string; group: string; year: string | null }; disciplines: Discipline[]; syncedAt: string } | null };
const score = (value: number | null) => value === null ? 'Не выставлено' : value === -1 ? 'Пропуск' : value.toLocaleString('ru-RU');

export default function Orioks() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [labOnly, setLabOnly] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  async function load() {
    try { const data = await apiGet<Connection>('/orioks/connection'); if (mounted.current) { setConnection(data); setError(''); } }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Не удалось загрузить подключение.'); }
    finally { if (mounted.current) setLoading(false); }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (disconnecting) dialog.current?.showModal(); }, [disconnecting]);
  async function run(kind: 'connect' | 'sync' | 'disconnect', event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(''); setNotice('');
    try {
      if (kind === 'disconnect') {
        await apiRequest('/orioks/connection', 'DELETE', undefined, 60000);
        if (mounted.current) { setConnection({ connected: false, needsReconnect: false, lastError: null, snapshot: null }); setDisconnecting(false); setNotice('ОРИОКС отключён, ключ этого приложения отозван. Ваши задачи сохранены.'); }
      } else {
        const body = kind === 'connect' ? { login: login.trim(), password } : {};
        // Clear the password as soon as request data has been assembled.
        setPassword('');
        const data = await apiRequest<Connection>(kind === 'connect' ? '/orioks/connection' : '/orioks/sync', 'POST', body, 60000);
        if (mounted.current) { setConnection(data); setLogin(''); setNotice('Учебные данные обновлены. Для создания задач используйте расчёт и предпросмотр ниже.'); }
      }
    } catch (err) {
      // Connection can have been saved before a later data request failed.
      try { const current = await apiGet<Connection>('/orioks/connection'); if (mounted.current) setConnection(current); } catch { /* retain last confirmed snapshot */ }
      if (mounted.current) setError(err instanceof Error ? err.message : 'Не удалось обратиться к ОРИОКС.');
    } finally { inFlight.current = false; if (mounted.current) setPending(false); }
  }
  if (loading) return <section className="panel empty" role="status">Загружаем подключение ОРИОКС…</section>;
  const snapshot = connection?.snapshot;
  const subjects = snapshot?.disciplines.filter(subject => subject.name.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU')) && (!labOnly || subject.events.some(event => /лаборатор/i.test(event.type)))) || [];
  return <div className="orioks-section">
    <section className="orioks-intro"><span className="orioks-mark"><BookOpen size={25}/></span><div><h2>Учёба из ОРИОКС</h2><p>Предметы, контрольные мероприятия и баллы — в вашем планировщике.</p></div><span className={'orioks-status ' + (connection?.connected ? 'connected' : '')}>{connection?.connected ? 'Подключено' : 'Не подключено'}</span></section>
    {error && !disconnecting && <div className="auth-error" role="alert">{error}</div>}
    {notice && <div className="notice" role="status"><Check size={17}/>{notice}</div>}
    {!connection && <button className="primary" onClick={() => { setLoading(true); void load(); }}>Повторить загрузку</button>}
    {connection && !connection.connected && <section className="panel orioks-connect"><div><h2>Подключите свой аккаунт МИЭТ</h2><p>Введите логин и пароль от ОРИОКС. После подключения появятся ваши предметы и контрольные мероприятия.</p><div className="orioks-security"><ShieldCheck size={21}/><span>Пароль не сохраняется. Полученный ключ доступа хранится на сервере в зашифрованном виде.</span></div><p className="muted">Подключение получает один ключ ОРИОКС. При обычном обновлении новый ключ не создаётся.</p></div><form onSubmit={event => void run('connect', event)}><fieldset disabled={pending}><label>Логин ОРИОКС<input autoComplete="off" name="orioksLogin" required maxLength={200} value={login} onChange={e => setLogin(e.target.value)} placeholder="Ваш логин в МИЭТ"/></label><label>Пароль ОРИОКС<input autoComplete="off" name="orioksPassword" type="password" required maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль от ОРИОКС"/></label><button className="primary" type="submit" disabled={!login.trim() || !password}>{pending ? 'Подключаем…' : 'Подключить ОРИОКС'}<Link2 size={17}/></button></fieldset></form></section>}
    {connection?.connected && <>
      <section className="panel orioks-profile"><div><h2>{snapshot?.student.full_name || 'Подключение сохранено'}</h2><p>{snapshot ? `${snapshot.student.group}${snapshot.student.year ? ' · ' + snapshot.student.year : ''}` : 'Нажмите «Обновить», чтобы получить учебные данные.'}</p><small>{snapshot ? 'Последнее обновление: ' + new Date(snapshot.syncedAt).toLocaleString('ru-RU') : 'Успешной загрузки пока не было'}</small></div><div className="orioks-controls"><button className="primary" disabled={pending || connection.needsReconnect} onClick={() => void run('sync')}><RefreshCw size={16}/>{pending ? 'Обновляем…' : 'Обновить'}</button><button className="text-button" disabled={pending} onClick={() => setDisconnecting(true)}><Unplug size={15}/> Отключить</button></div></section>
      {connection.lastError && !error && <div className="auth-error" role="alert">{connection.lastError} {snapshot ? 'Показаны данные последней успешной загрузки.' : ''}</div>}
      <div className="orioks-explanation"><strong>Создание задач и расчёт сроков</strong><p>Загрузите расписание, проверьте правила предметов и подтвердите выбранные задачи. Баллы ОРИОКС не отмечают задачи выполненными автоматически.</p></div>{snapshot && <OrioksPlanning key={snapshot.syncedAt} subjects={snapshot.disciplines}/>}
      {snapshot && <><div className="orioks-filters"><label>Найти предмет<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Название дисциплины"/></label><label className="orioks-lab-filter"><input type="checkbox" checked={labOnly} onChange={e => setLabOnly(e.target.checked)}/> Только лабораторные</label></div><p className="muted">Предметов: {subjects.length}. Это данные ОРИОКС, а не созданные задачи.</p>
      <div className="orioks-subjects">{subjects.map(subject => <details className="panel orioks-subject" key={subject.id}><summary><span className="subject-icon"><BookOpen size={18}/></span><span><strong>{subject.name}</strong><small>{subject.control_form || 'Форма контроля не указана'} · Мероприятий: {subject.events.length}</small></span><span className="subject-grade">{score(subject.current_grade)}<small>из {subject.max_grade}</small></span></summary><div className="orioks-subject-body"><p className="muted">{subject.teachers?.join(', ') || 'Преподаватель не указан'}</p>{subject.events.filter(event => !labOnly || /лаборатор/i.test(event.type)).map((event, index) => <article className="orioks-event" key={index}><div><span className="tag study">{event.type}</span><h3>{event.alias ? event.alias + ' · ' : ''}{event.name || 'Без названия'}</h3><p>Учебная неделя {event.week} · точный срок не определён</p></div><div className="event-grade"><strong>{score(event.current_grade)}</strong><small>из {event.max_grade} баллов</small></div></article>)}{subject.events.length === 0 && <p className="empty">Контрольных мероприятий пока нет.</p>}</div></details>)}{subjects.length === 0 && <section className="panel empty">{snapshot.disciplines.length ? 'По выбранным условиям предметов нет.' : 'ОРИОКС вернул пустой список дисциплин.'}</section>}</div></>}
    </>}
    {disconnecting && <dialog ref={dialog} className="modal task-dialog" onCancel={event => { event.preventDefault(); if (!pending) setDisconnecting(false); }}><h2>Отключить ОРИОКС?</h2><p className="delete-description">Ключ этого приложения будет отозван в ОРИОКС, а загруженные учебные данные удалены из планировщика. Ваши задачи останутся.</p>{error && <p className="auth-error" role="alert">{error}</p>}<div className="dialog-actions"><button disabled={pending} className="text-button" onClick={() => setDisconnecting(false)}>Отмена</button><button disabled={pending} className="danger-button" onClick={() => void run('disconnect')}>{pending ? 'Отключаем…' : 'Отключить'}</button></div></dialog>}
  </div>;
}
