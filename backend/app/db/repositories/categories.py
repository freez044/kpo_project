from collections.abc import Mapping, Sequence
from typing import Any
from uuid import UUID

from sqlalchemy import delete, insert, select, update

from app.db.errors import NotFoundError, guarded_write
from app.db.models import Category
from app.db.repositories._base import Repository, checked_fields

_FIELDS = frozenset({'name', 'color'})


class CategoryRepository(Repository):
    """Категории пользователя. Повтор названия без учёта регистра — ConflictError (ФТ-14)."""

    def list(self, user_id: UUID) -> Sequence[Category]:
        return self._read(
            select(Category).where(Category.user_id == user_id).order_by(Category.name)
        ).all()

    def get(self, user_id: UUID, category_id: UUID) -> Category:
        category = self._read(
            select(Category).where(Category.user_id == user_id, Category.id == category_id)
        ).one_or_none()
        if category is None:
            raise NotFoundError('Категория не найдена')
        return category

    def create(self, user_id: UUID, data: Mapping[str, Any]) -> Category:
        values = checked_fields(data, _FIELDS)
        with guarded_write(self._session):
            return self._session.scalars(
                insert(Category).values(user_id=user_id, **values).returning(Category)
            ).one()

    def update(self, user_id: UUID, category_id: UUID, data: Mapping[str, Any]) -> Category:
        values = checked_fields(data, _FIELDS)
        if not values:
            return self.get(user_id, category_id)
        with guarded_write(self._session):
            category = self._session.scalars(
                update(Category)
                .where(Category.user_id == user_id, Category.id == category_id)
                .values(**values)
                .returning(Category)
                .execution_options(populate_existing=True)
            ).one_or_none()
        if category is None:
            raise NotFoundError('Категория не найдена')
        return category

    def delete(self, user_id: UUID, category_id: UUID) -> None:
        """Удалить категорию; у целей и задач она очищается (ФТ-16)."""
        with guarded_write(self._session):
            deleted = self._session.scalars(
                delete(Category)
                .where(Category.user_id == user_id, Category.id == category_id)
                .returning(Category.id)
            ).one_or_none()
        if deleted is None:
            raise NotFoundError('Категория не найдена')
