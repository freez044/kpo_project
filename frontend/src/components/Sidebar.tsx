import { BookOpen, CalendarDays, CircleHelp, Columns3, LayoutDashboard, ListTodo, Sparkles, Sprout, Target } from 'lucide-react';
import type { User } from '../types/user';

const sections = [{ label: 'Главная', icon: LayoutDashboard }, { label: 'Задачи', icon: ListTodo }, { label: 'Канбан', icon: Columns3 }, { label: 'ОРИОКС', icon: BookOpen }, { label: 'Календарь', icon: CalendarDays }, { label: 'Цели', icon: Target }, { label: 'ИИ-ассистент', icon: Sparkles }];

type Props = { user: User; section: string; onNavigate: (section: string) => void; onNotice: (message: string) => void };
export default function Sidebar({ user, section, onNavigate, onNotice }: Props) {
  return <aside className="sidebar">
    <a className="brand" href="#" onClick={() => onNavigate('Главная')}><span className="brand-icon"><Sprout size={25}/></span><span>adaptive<span className="brand-sub">AI PLANNER</span></span></a>
    <div className="workspace-label">ЛИЧНОЕ ПРОСТРАНСТВО</div><nav aria-label="Основная навигация">{sections.map(s => <button key={s.label} aria-label={s.label} title={s.label} className={'nav-item ' + (section === s.label ? 'active' : '')} onClick={() => { onNavigate(s.label); }}><s.icon size={19}/><span>{s.label}</span>{s.label === 'ИИ-ассистент' && <span className="soon">СКОРО</span>}</button>)}</nav>
    <div className="sidebar-note"><span className="tiny-icon"><Sprout size={20}/></span><strong>Маленькие шаги.<br/>Большие результаты.</strong><p>Освободите мысли —<br/>соберите всё в одном месте.</p></div>
    <button className="help" onClick={() => onNotice('Задачи сохраняются в вашем аккаунте. Дата в плане определяет день на главной; дедлайн — крайний срок. Цели пока временные.')}><CircleHelp size={18}/> Как это работает</button>
    <div className="profile"><span className="avatar">{user.firstName[0]}</span><div><strong>{user.firstName} {user.lastName}</strong><small title={user.email}>{user.email}</small></div><span className="online"/></div>
  </aside>;
}
