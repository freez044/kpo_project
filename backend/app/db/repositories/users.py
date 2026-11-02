from collections.abc import Mapping
from typing import Any
from uuid import UUID

from sqlalchemy import delete, insert, select, update

from app.db.errors import NotFoundError, guarded_write
from app.db.models import User
from app.db.repositories._base import Repository, checked_fields

_PROFILE = frozenset({
    'first_name', 'last_name', 'study_group', 'timezone', 'ai_history_enabled', 'password_hash',
})
_CREATABLE = _PROFILE | {'email'}


class UserRepository(Repository):
    """Учётные записи. Пароль приходит уже хешем argon2id; хеширует AccountService."""

    def create(self, data: Mapping[str, Any]) -> User:
        """Регистрация (ФТ-01); занятый email — ConflictError с constraint users_email_key."""
        values = checked_fields(data, _CREATABLE)
        with guarded_write(self._session):
            return self._session.scalars(insert(User).values(**values).returning(User)).one()

    def get(self, user_id: UUID) -> User:
        user = self._read(select(User).where(User.id == user_id)).one_or_none()
        if user is None:
            raise NotFoundError('Пользователь не найден')
        return user

    def find_by_email(self, email: str) -> User | None:
        """Для входа: email сравнивается без учёта регистра (citext)."""
        return self._read(select(User).where(User.email == email)).one_or_none()

    def update(self, user_id: UUID, data: Mapping[str, Any]) -> User:
        values = checked_fields(data, _PROFILE)
        if not values:
            return self.get(user_id)
        with guarded_write(self._session):
            user = self._session.scalars(
                update(User)
                .where(User.id == user_id)
                .values(**values)
                .returning(User)
                .execution_options(populate_existing=True)
            ).one_or_none()
        if user is None:
            raise NotFoundError('Пользователь не найден')
        return user

    def delete(self, user_id: UUID) -> None:
        """Удалить учётную запись со всеми данными (ФТ-05)."""
        with guarded_write(self._session):
            deleted = self._session.scalars(
                delete(User).where(User.id == user_id).returning(User.id)
            ).one_or_none()
        if deleted is None:
            raise NotFoundError('Пользователь не найден')
