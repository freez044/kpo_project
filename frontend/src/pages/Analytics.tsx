import './Analytics.css';

const stats = [
  { value: '87%', label: 'задач выполнено в срок' },
  { value: '14', label: 'задач за неделю' },
  { value: '3', label: 'просроченных задачи' },
  { value: '6ч 20м', label: 'среднее время на учёбу в день' },
];

export default function Analytics() {
  return (
    <div>
      <h1>Аналитика</h1>

      <div className="stat-grid">
        {stats.map((s) => (
          <div className="stat-card" key={s.label}>
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="two-col">
        <section className="card">
          <div className="card-header"><h3>Выполнение задач по неделям</h3></div>
          <div className="placeholder-block">здесь будет линейный/столбчатый график динамики</div>
        </section>

        <section className="card">
          <div className="card-header"><h3>Распределение по предметам</h3></div>
          <div className="placeholder-block">здесь будет круговая диаграмма по предметам</div>
        </section>
      </div>
    </div>
  );
}
