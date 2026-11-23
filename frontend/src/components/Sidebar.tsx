const sections = ['Главная', 'Задачи', 'Календарь', 'Канбан', 'ОРИОКС', 'Цели', 'AI-помощник', 'Аналитика'];

export default function Sidebar({ section, onNavigate }: { section: string; onNavigate: (section: string) => void }) {
  return (
    <aside className="team-sidebar">
      <div className="sidebar-logo">Adaptive AI Planner</div>
      <nav className="sidebar-nav" aria-label="Основная навигация">
        {sections.map(label => (
          <button key={label} className={section === label ? 'nav-link active' : 'nav-link'}
            aria-current={section === label ? 'page' : undefined} onClick={() => onNavigate(label)}>{label}</button>
        ))}
      </nav>
    </aside>
  );
}
