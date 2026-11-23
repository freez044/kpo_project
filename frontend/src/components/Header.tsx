export default function Header({ section, onNavigate }: { section: string; onNavigate: (section: string) => void }) {
  return (
    <header className="team-topbar">
      <div className="topbar-title">{section}</div>
      <div className="topbar-actions">
        {['Помощь', 'Профиль'].map(label => (
          <button key={label} className={section === label ? 'icon-btn active' : 'icon-btn'}
            aria-current={section === label ? 'page' : undefined} onClick={() => onNavigate(label)}>{label}</button>
        ))}
      </div>
    </header>
  );
}
