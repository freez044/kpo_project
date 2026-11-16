type Props = { section: string; loggingOut: boolean; onLogout: () => void };
export default function Header({ section, loggingOut, onLogout }: Props) {
  return <header className="topbar"><span>Моё пространство <span className="slash">/</span><strong>{section}</strong></span><button className="logout-button" disabled={loggingOut} onClick={onLogout}>{loggingOut ? 'Выходим…' : 'Выйти'}</button></header>;
}
