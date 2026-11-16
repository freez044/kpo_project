import { useEffect, useState } from 'react';
import { CalendarDays, Check, Download, ListChecks, Save } from 'lucide-react';
import { apiGet, apiRequest } from './services/api';
import './orioks-planning.css';

type Subject = { id: number; name: string; events: { type: string }[] };
type Rule = { disciplineId: number; mode: 'schedule' | 'manual'; graceSessions: number; firstLabDate: string | null; intervalWeeks: number; startTime: string | null; endTime: string | null; excludedDates: string[]; scheduleName?: string | null };
type Settings = { semesterStart: string; semesterEnd: string; rules: Rule[] };
type Schedule = { semesterStart: string; semesterEnd: string | null; matchedSubjectIds: number[]; slots: unknown[]; scheduleNames?: string[]; missingTimeCount?: number; unmatchedCount: number; updatedAt: string };
type PlanningState = { settings: Settings | null; schedule: Schedule | null };
type Item = { eventKey: string | null; discipline: string; title: string; type: string; week: number; grade: number | null; plannedDate: string | null; plannedDueAt: string | null; deadline: string | null; deadlineSource: string; reason: string | null; existingTaskId: string | null; selectedByDefault: boolean };
type Preview = { previewId: string; items: Item[]; snapshotAt: string; expiresIn: number };
type Override = { eventKey: string; plannedDate?: string | null; deadlineDate?: string | null };
const ruleFor = (id: number): Rule => ({ disciplineId: id, mode: 'schedule', graceSessions: 1, firstLabDate: null, intervalWeeks: 2, startTime: null, endTime: null, excludedDates: [] });
const format = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Не определено';

export default function OrioksPlanning({ subjects }: { subjects: Subject[] }) {
  const [state, setState] = useState<PlanningState | null>(null);
  const [draft, setDraft] = useState<Settings>({ semesterStart: '', semesterEnd: '', rules: [] });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [onlyLabs, setOnlyLabs] = useState(true);
  const labs = subjects.filter(subject => subject.events.some(event => /лаборатор/i.test(event.type)));
  useEffect(() => {
    let active = true;
    apiGet<PlanningState>('/orioks/planning').then(data => { if (active) { setState(data); setDraft(data.settings || { semesterStart: data.schedule?.semesterStart || '', semesterEnd: data.schedule?.semesterEnd || '', rules: labs.map(s => ruleFor(s.id)) }); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);
  function change(draft: Settings) { setDraft(draft); setPreview(null); setMessage(''); }
  function changeRule(id: number, patch: Partial<Rule>) { change({ ...draft, rules: draft.rules.map(rule => rule.disciplineId === id ? { ...rule, ...patch } : rule) }); }
  async function importSchedule() {
    setPending(true); setError(''); setMessage('');
    try {
      const data = await apiRequest<PlanningState>('/orioks/planning/schedule', 'POST', {}, 60000);
      setState(data); setPreview(null);
      setDraft(previous => ({ ...previous, semesterStart: previous.semesterStart || data.schedule?.semesterStart || '', semesterEnd: previous.semesterEnd || data.schedule?.semesterEnd || '', rules: previous.rules.length ? previous.rules : labs.map(s => ruleFor(s.id)) }));
      setMessage(`Расписание загружено. Сопоставлено предметов: ${data.schedule?.matchedSubjectIds.length || 0}. Проверьте даты семестра и сохраните правила.`);
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось получить расписание. Можно задать занятия вручную.'); }
    finally { setPending(false); }
  }
  async function calculate(event: React.FormEvent) {
    event.preventDefault(); setPending(true); setError(''); setMessage(''); setPreview(null);
    try {
      const settings = { ...draft, rules: draft.rules.map(rule => ({ ...rule, excludedDates: rule.excludedDates.flatMap(value => value.split(/[,;\s]+/)).filter(Boolean) })) };
      const saved = await apiRequest<PlanningState>('/orioks/planning', 'PUT', settings);
      setState(saved);
      const result = await apiRequest<Preview>('/orioks/planning/preview', 'POST', {});
      setPreview(result); setSelected(new Set(result.items.filter(item => item.selectedByDefault && item.eventKey).map(item => item.eventKey!))); setOverrides({});
      setMessage('Сроки рассчитаны. Проверьте результат и выберите задачи для создания.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось рассчитать сроки.'); }
    finally { setPending(false); }
  }
  async function apply() {
    if (!preview || pending) return;
    setPending(true); setError('');
    try {
      const result = await apiRequest<{ createdCount: number; skippedCount: number }>('/orioks/planning/apply', 'POST', { previewId: preview.previewId, eventKeys: [...selected], overrides: Object.values(overrides).filter(override => selected.has(override.eventKey)) });
      setMessage(`Создано задач: ${result.createdCount}. Уже существовали: ${result.skippedCount}. Они доступны в разделе «Задачи» и на канбан-доске.`);
      setPreview(null); setSelected(new Set()); window.dispatchEvent(new Event('planner-tasks-changed'));
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось создать задачи.'); }
    finally { setPending(false); }
  }
  function overrideDate(key: string, field: 'plannedDate' | 'deadlineDate', value: string) { setOverrides(all => ({ ...all, [key]: { ...all[key], eventKey: key, [field]: value || null } })); }
  const items = preview?.items.filter(item => !onlyLabs || /лаборатор/i.test(item.type)) || [];
  return <section className="orioks-planning panel">
    <div className="section-title"><h2><ListChecks size={19}/> Создать учебные задачи</h2><span className="muted">Расчёт по занятиям</span></div>
    <p className="planning-lead">Плановая сдача — конец лабораторного блока. По умолчанию без снижения баллов можно сдать на следующем занятии того же предмета. Подтвердите, что это правило подходит вашему преподавателю.</p>
    {error && <p className="auth-error" role="alert">{error}</p>}{message && <div className="notice" role="status"><Check size={17}/>{message}</div>}
    {!state && !error && <p className="empty" role="status">Загружаем настройки расчёта…</p>}
    <button className="primary" type="button" disabled={pending} onClick={importSchedule}><Download size={16}/>{pending ? 'Подождите…' : 'Загрузить расписание ОРИОКС'}</button>
    {state?.schedule && <p className="planning-note">Расписание получено {new Date(state.schedule.updatedAt).toLocaleString('ru-RU')}. Автоматически сопоставлено предметов: {state.schedule.matchedSubjectIds.length}. Несопоставленных названий: {state.schedule.unmatchedCount}. Пар без времени в источнике: {state.schedule.missingTimeCount || 0}.</p>}
    <form onSubmit={calculate}><fieldset disabled={pending}>
      <div className="planning-dates"><label>Начало первой учебной недели<input type="date" required value={draft.semesterStart} onInput={e => change({ ...draft, semesterStart: e.currentTarget.value })} onChange={e => change({ ...draft, semesterStart: e.target.value })}/></label><label>Последний день занятий семестра<input type="date" required value={draft.semesterEnd} onInput={e => change({ ...draft, semesterEnd: e.currentTarget.value })} onChange={e => change({ ...draft, semesterEnd: e.target.value })}/></label></div>
      {state?.schedule && !state.schedule.semesterEnd && <p className="planning-warning">ОРИОКС пока не сообщил дату конца занятий. Укажите последний учебный день семестра вручную.</p>}<p className="planning-note">Все занятия и ручные даты ниже — по московскому времени. Праздники и отменённые занятия укажите в исключениях.</p>
      <div className="planning-rules">{labs.map(subject => {
        const rule = draft.rules.find(rule => rule.disciplineId === subject.id);
        const matched = Boolean(rule?.scheduleName || state?.schedule?.matchedSubjectIds.includes(subject.id));
        return <details className="planning-rule" key={subject.id}><summary><label onClick={event => event.stopPropagation()}><input type="checkbox" checked={Boolean(rule)} onChange={e => change({ ...draft, rules: e.target.checked ? [...draft.rules, ruleFor(subject.id)] : draft.rules.filter(rule => rule.disciplineId !== subject.id) })}/><span>{subject.name}</span></label><small>{matched ? 'Есть в расписании' : 'Нужно уточнить занятия'} · Настроить ▾</small></summary>{rule && <div className="planning-rule-body"><div className="planning-dates"><label>Источник занятий<select value={rule.mode} onChange={e => changeRule(subject.id, { mode: e.target.value as Rule['mode'] })}><option value="schedule">Расписание ОРИОКС · две пары в блоке</option><option value="manual">Указать занятия вручную</option></select></label><label>Сдача без снижения<select value={rule.graceSessions} onChange={e => changeRule(subject.id, { graceSessions: Number(e.target.value) })}><option value={0}>Только в день лабораторной</option><option value={1}>Ещё одно лабораторное занятие</option><option value={2}>Ещё два лабораторных занятия</option><option value={3}>Ещё три лабораторных занятия</option></select></label></div>
        {rule.mode === 'schedule' && <label>Этот предмет в расписании<select value={rule.scheduleName || ''} onChange={e => changeRule(subject.id, { scheduleName: e.target.value || null })}><option value="">Автоматическое совпадение названий</option>{state?.schedule?.scheduleNames?.map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
        {rule.mode === 'schedule' && !matched && <p className="planning-warning">Лабораторные этого предмета не сопоставлены с расписанием. Выберите название в списке, ручной источник или уточните сроки в предпросмотре.</p>}
        {rule.mode === 'manual' && <><div className="planning-dates"><label>Первое лабораторное занятие<input type="date" required value={rule.firstLabDate || ''} onInput={e => changeRule(subject.id, { firstLabDate: e.currentTarget.value || null })} onChange={e => changeRule(subject.id, { firstLabDate: e.target.value || null })}/></label><label>Повторять каждые<select value={rule.intervalWeeks} onChange={e => changeRule(subject.id, { intervalWeeks: Number(e.target.value) })}>{[1,2,3,4].map(n => <option value={n} key={n}>{n} нед.</option>)}</select></label></div><div className="planning-dates"><label>Начало первой пары<input required type="time" value={rule.startTime?.slice(0,5) || ''} onInput={e => changeRule(subject.id, { startTime: e.currentTarget.value || null })} onChange={e => changeRule(subject.id, { startTime: e.target.value || null })}/></label><label>Конец второй пары<input required type="time" value={rule.endTime?.slice(0,5) || ''} onInput={e => changeRule(subject.id, { endTime: e.currentTarget.value || null })} onChange={e => changeRule(subject.id, { endTime: e.target.value || null })}/></label></div></>}
        <label>Отменённые занятия — даты через запятую<input placeholder="2026-11-04, 2026-12-31" value={rule.excludedDates.join(', ')} onChange={e => changeRule(subject.id, { excludedDates: [e.target.value] })}/></label></div>}</details>;
      })}</div>
      {labs.length === 0 && <p className="planning-note">В текущих мероприятиях нет лабораторных. Другие мероприятия можно выбрать в предпросмотре и указать сроки вручную.</p>}
      <button className="primary" type="submit"><Save size={16}/>{pending ? 'Рассчитываем…' : 'Сохранить правила и рассчитать сроки'}</button>
    </fieldset></form>
    {preview && <div className="planning-preview"><div className="section-title"><h2><CalendarDays size={18}/> Проверка перед созданием</h2><span className="muted">Действует 15 минут</span></div><div className="preview-controls"><label><input type="checkbox" checked={onlyLabs} onChange={e => setOnlyLabs(e.target.checked)}/> Только лабораторные</label><button type="button" className="text-button" onClick={() => setSelected(new Set(items.filter(item => item.eventKey && !item.existingTaskId).map(item => item.eventKey!)))}>Выбрать все показанные</button><button type="button" className="text-button" onClick={() => setSelected(new Set())}>Снять выбор</button></div>
      <p className="planning-note">Расчётные сроки — предложение по правилу предмета, а не официальный дедлайн ОРИОКС. Если даты не определены, можно указать их вручную или создать задачу без срока. Ручной срок означает конец выбранного дня.</p>
      {items.map((item, index) => <article className={'planning-item ' + (item.existingTaskId ? 'already-imported' : '')} key={item.eventKey || index}><label className="planning-item-title"><input type="checkbox" disabled={pending || !item.eventKey || Boolean(item.existingTaskId)} checked={Boolean(item.eventKey && selected.has(item.eventKey))} onChange={e => setSelected(old => { const next = new Set(old); if (e.target.checked) next.add(item.eventKey!); else next.delete(item.eventKey!); return next; })}/><strong>{item.title}</strong></label><p className="planning-note">{item.type} · неделя {item.week} · {item.grade === null ? 'Баллы не выставлены' : item.grade === -1 ? 'Пропуск' : `Баллы: ${item.grade}`}</p>{item.existingTaskId ? <p className="imported-label">Уже создана — повторный импорт её не изменит</p> : <><div className="planning-result"><span>Плановая сдача<strong>{format(item.plannedDueAt)}</strong></span><span>Без снижения до<strong>{format(item.deadline)}</strong></span></div><span className="deadline-origin">{item.deadlineSource === 'SCHEDULE_RULE' ? 'Рассчитано по расписанию ОРИОКС и правилу' : item.deadlineSource === 'MANUAL_RULE' ? 'Рассчитано по ручному расписанию' : 'Требует уточнения'}</span>{item.reason && <p className="planning-warning">{item.reason}</p>}{item.eventKey && <details className="manual-deadlines"><summary>Уточнить даты вручную</summary><div className="planning-dates"><label>Плановая дата<input type="date" value={overrides[item.eventKey]?.plannedDate === undefined ? item.plannedDate || '' : overrides[item.eventKey].plannedDate || ''} onInput={e => overrideDate(item.eventKey!, 'plannedDate', e.currentTarget.value)} onChange={e => overrideDate(item.eventKey!, 'plannedDate', e.target.value)}/></label><label>Последний день без снижения<input type="date" value={overrides[item.eventKey]?.deadlineDate === undefined ? item.deadline?.slice(0,10) || '' : overrides[item.eventKey].deadlineDate || ''} onInput={e => overrideDate(item.eventKey!, 'deadlineDate', e.currentTarget.value)} onChange={e => overrideDate(item.eventKey!, 'deadlineDate', e.target.value)}/></label></div></details>}</>}</article>)}
      {items.length === 0 && <p className="empty">Нет мероприятий по выбранному фильтру.</p>}
      <div className="import-bar"><span>Выбрано: {selected.size}</span><button className="primary" disabled={pending || selected.size === 0} onClick={apply}>{pending ? 'Создаём…' : `Создать задачи (${selected.size})`}</button></div>
    </div>}
  </section>;
}
