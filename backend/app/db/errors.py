"""Ошибки слоя данных и перевод ошибок PostgreSQL в них.

Соответствие SQLSTATE и кодов API — в database/postgresql/README.md («Ошибки для серверной части»).
Сервисы ловят эти исключения, а обработчики API превращают их в ответ {"error": {...}}.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session


class RepositoryError(Exception):
    """Базовая ошибка слоя данных."""

    def __init__(self, message: str, *, constraint: str | None = None, column: str | None = None):
        super().__init__(message)
        self.constraint = constraint   # имя ограничения базы, например tasks_title_not_blank
        self.column = column


class NotFoundError(RepositoryError):
    """Записи нет или она принадлежит другому пользователю → 404 NOT_FOUND."""


class ConflictError(RepositoryError):
    """Нарушена уникальность или объект уже в другом состоянии → 409 CONFLICT / EMAIL_TAKEN."""


class DataValidationError(RepositoryError):
    """Данные отклонены ограничением базы → 422 VALIDATION_ERROR."""


_BY_SQLSTATE: dict[str, type[RepositoryError]] = {
    '23514': DataValidationError,   # check_violation
    '23502': DataValidationError,   # not_null_violation
    '22P02': DataValidationError,   # invalid_text_representation
    '22001': DataValidationError,   # string_data_right_truncation
    '22003': DataValidationError,   # numeric_value_out_of_range
    '23505': ConflictError,         # unique_violation
    '23503': NotFoundError,         # foreign_key_violation: ссылка на чужую или несуществующую запись
    'AP001': NotFoundError,
    'AP002': ConflictError,
    'AP003': DataValidationError,
}


def translate(exc: DBAPIError) -> RepositoryError | None:
    """Ошибка слоя данных для ошибки драйвера или None, если код не наш."""
    orig = exc.orig
    error_cls = _BY_SQLSTATE.get(getattr(orig, 'sqlstate', None) or '')
    if error_cls is None:
        return None
    diag = getattr(orig, 'diag', None)
    return error_cls(
        getattr(diag, 'message_primary', None) or str(orig),
        constraint=getattr(diag, 'constraint_name', None),
        column=getattr(diag, 'column_name', None),
    )


@contextmanager
def guarded_write(session: Session) -> Iterator[None]:
    """Выполнить запись в точке сохранения и перевести ошибки базы.

    После ошибки откатывается только точка сохранения: транзакция запроса остаётся
    рабочей, и сервис может продолжить или откатить её сам.
    """
    try:
        with session.begin_nested():
            yield
    except DBAPIError as exc:
        error = translate(exc)
        if error is None:
            raise
        raise error from exc
