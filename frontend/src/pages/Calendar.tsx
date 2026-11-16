import { CalendarDays } from 'lucide-react';
import './Calendar.css';
export default function Calendar({ onHome }: { onHome: () => void }) {
  return <section className="panel placeholder"><CalendarDays size={38}/><h2>Здесь будет ваше расписание</h2><p>Календарь появится на следующем этапе.<br/>Сейчас дату в плане можно выбрать в карточке задачи.</p><button className="text-button" onClick={() => onHome()}>Вернуться к плану на день</button></section>;
}
