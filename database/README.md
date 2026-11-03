# Данные Adaptive AI Planner (ТЗ v12)

Актуальная серверная модель данных по ТЗ v12 хранится в PostgreSQL. Документы по прежней браузерной модели v11 убраны как устаревшие.

| Путь | Что внутри |
|---|---|
| [`data_model.puml`](data_model.puml), [`data_model.png`](data_model.png) | Актуальная UML-диаграмма сущностей по ТЗ v12 |
| [`postgresql/`](postgresql/) | Основная схема PostgreSQL: SQL-скрипты, ограничения, индексы, функции, процедуры и проверки |
| [`../backend/app/db/`](../backend/app/db/) | ORM-модели SQLAlchemy и репозитории |
| [`../backend/migrations/`](../backend/migrations/) | Миграции Alembic |
| [`legacy_postgresql/`](legacy_postgresql/) | Исторические SQL-скрипты ранней реализации: оставлены для сравнения во время ревизии БД, не используются для актуальной установки |

Диаграмма `data_model.puml` подключает общий набор сущностей из `docs/uml/puml/CL-01_entities.iuml`. Правила API и форматы данных описаны в [контрактах](../docs/contracts.md).

Пересобрать диаграмму (из корня репозитория):

```sh
java -jar plantuml.jar -tpng database/data_model.puml
```
