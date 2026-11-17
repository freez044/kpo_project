import './Profile.css';

export default function Profile() {
  return (
    <div>
      <h1>Профиль</h1>

      <div className="two-col profile-grid">
        <section className="card">
          <div className="card-header"><h3>Личные данные</h3></div>
          <div className="field">
            <label>Имя</label>
            <input type="text" defaultValue="Иван Иванов" />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="text" defaultValue="ivanov@university.ru" />
          </div>
          <div className="field">
            <label>Группа</label>
            <input type="text" defaultValue="ХХ-000" />
          </div>
          <button className="btn btn-primary">Сохранить изменения</button>
        </section>

        <section className="card">
          <div className="card-header"><h3>Подключения</h3></div>
          <ul className="task-list">
            <li className="task-item">
              <span className="priority-dot priority-low"></span>
              <span className="task-title">ОРИОКС (журнал, расписание)</span>
              <span className="task-time">подключено</span>
            </li>
            <li className="task-item">
              <span className="priority-dot priority-mid"></span>
              <span className="task-title">Уведомления на почту</span>
              <span className="task-time">выключено</span>
            </li>
          </ul>
          <div className="logout-block">
            <button className="btn btn-block">Выйти из аккаунта</button>
          </div>
        </section>
      </div>
    </div>
  );
}
