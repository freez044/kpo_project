# Данные Adaptive AI Planner

| Файл | Что внутри |
|---|---|
| [`data_model.md`](data_model.md) | Модель данных: сущности, поля, связи, правила удаления и проверки, резервная копия |
| `Модель_данных_Adaptive_AI_Planner_v2.docx` | Тот же документ в Word, собран из `data_model.md` |
| `data_model.puml`, `data_model.png` | Диаграмма модели данных; использует общие описания классов из `docs/uml/puml/CL-01_entities.iuml` |
| [`postgresql/`](postgresql/) | Схема PostgreSQL по ТЗ v12: таблицы, ограничения, индексы, функции, процедуры, роли и тесты |
| [`legacy_postgresql/`](legacy_postgresql/) | Архив ранней серверной схемы PostgreSQL, в проекте не используется |

`data_model.md` и диаграмма пока описывают хранилище браузера по ТЗ v11; его реализация — модуль [`docs/storage/db.ts`](../docs/storage/db.ts). Серверная схема по ТЗ v12 — в [`postgresql/`](postgresql/).

Пересобрать после правок:

```sh
java -jar plantuml.jar -tpng database/data_model.puml
cd database && pandoc data_model.md -o Модель_данных_Adaptive_AI_Planner_v2.docx
```
