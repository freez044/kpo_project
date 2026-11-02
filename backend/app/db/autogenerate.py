"""Что сравнивает alembic autogenerate: только схема planner и таблицы, описанные моделями.

Остальные таблицы planner пока без моделей; без фильтра autogenerate предложил бы их удалить.
"""

from app.db.models import SCHEMA, Base


def include_name(name, type_, parent_names) -> bool:
    if type_ == 'schema':
        return name == SCHEMA
    if type_ == 'table':
        return name in {table.name for table in Base.metadata.tables.values()}
    return True
