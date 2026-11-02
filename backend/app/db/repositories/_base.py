from collections.abc import Mapping
from typing import Any

from sqlalchemy import Select, ScalarResult
from sqlalchemy.orm import Session


class Repository:
    """Общая часть репозиториев: сеанс задаёт вызывающий, фиксирует транзакцию тоже он."""

    def __init__(self, session: Session):
        self._session = session

    def _read(self, stmt: Select) -> ScalarResult:
        # Строки всегда берутся из базы: триггеры и каскады (SET NULL, CASCADE) меняют
        # записи в обход сеанса, и объект из identity map мог устареть.
        return self._session.scalars(stmt.execution_options(populate_existing=True))


def checked_fields(data: Mapping[str, Any], allowed: frozenset[str]) -> dict[str, Any]:
    """Копия data; лишние ключи (например, id или user_id) — ошибка программиста, а не пользователя."""
    unknown = set(data) - allowed
    if unknown:
        raise ValueError(f'Недопустимые поля: {", ".join(sorted(unknown))}')
    return dict(data)
