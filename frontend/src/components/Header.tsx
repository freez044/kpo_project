import { NavLink, useLocation } from 'react-router-dom';
import './Header.css';

const titles: Record<string, string> = {
  '/': 'Главная',
  '/tasks': 'Задачи',
  '/calendar': 'Календарь',
  '/assistant': 'AI-помощник',
  '/analytics': 'Аналитика',
  '/profile': 'Профиль',
  '/feedback': 'Помощь',
};

export default function Header() {
  const { pathname } = useLocation();

  return (
    <header className="topbar">
      <div className="topbar-title">{titles[pathname] ?? ''}</div>
      <div className="topbar-actions">
        <NavLink to="/feedback" className={({ isActive }) => (isActive ? 'icon-btn active' : 'icon-btn')}>
          Помощь
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => (isActive ? 'icon-btn active' : 'icon-btn')}>
          Профиль
        </NavLink>
      </div>
    </header>
  );
}
