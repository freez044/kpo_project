import './Assistant.css';

const hints = ['Распредели мой день', 'Что горит на этой неделе?', 'Помоги подготовиться к экзамену'];

const messages: { from: 'bot' | 'user'; text: string }[] = [
  { from: 'bot', text: 'Привет! Я помогу спланировать твоё время. Спроси что-нибудь про задачи, дедлайны или расписание.' },
  { from: 'user', text: 'Что у меня горит на сегодня?' },
  { from: 'bot', text: 'Сегодня 2 задачи: лабораторная по физике (до 18:00) и подготовка к семинару (до 20:00). Хочешь, расставлю их по времени?' },
];

export default function Assistant() {
  return (
    <div>
      <h1>AI-помощник</h1>

      <div className="hints">
        {hints.map((h) => (
          <button className="btn btn-small" key={h}>{h}</button>
        ))}
      </div>

      <div className="chat-wrap">
        <div className="chat-messages">
          {messages.map((m, i) => (
            <div className={`msg ${m.from}`} key={i}>{m.text}</div>
          ))}
        </div>
        <div className="chat-input">
          <input type="text" placeholder="Напишите сообщение..." />
          <button className="btn btn-primary">Отправить</button>
        </div>
      </div>
    </div>
  );
}
