import type { FormEvent } from 'react';
import './Feedback.css';

export default function Feedback() {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // здесь позже будет отправка обращения на сервер
  };

  return (
    <div>
      <h1>Помощь</h1>
      <p className="feedback-lead">Опишите проблему — разработчики ответят и помогут её решить.</p>

      <form className="card feedback-form" onSubmit={handleSubmit}>
        <div className="field">
          <label>Тема обращения</label>
          <input type="text" placeholder="Например: не подгружаются задачи из ОРИОКС" />
        </div>
        <div className="field">
          <label>Описание проблемы</label>
          <textarea rows={6} placeholder="Опишите, что произошло"></textarea>
        </div>
        <button type="submit" className="btn btn-primary">Отправить</button>
      </form>
    </div>
  );
}
