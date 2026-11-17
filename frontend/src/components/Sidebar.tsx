import { NavLink } from 'react-router-dom';
import './Sidebar.css';

const links = [
  { to: '/', label: 'Главная', end: true },
  { to: '/tasks', label: 'Задачи', end: false },
  { to: '/calendar', label: 'Календарь', end: false },
  { to: '/assistant', label: 'AI-помощник', end: false },
  { to: '/analytics', label: 'Аналитика', end: false },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">StudyPlan</div>
      <nav className="sidebar-nav">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
