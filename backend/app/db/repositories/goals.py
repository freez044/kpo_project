from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import delete, func, insert, select, update

from app.db.errors import NotFoundError, guarded_write
from app.db.models import Goal
from app.db.repositories._base import Repository, checked_fields
from app.enums.statuses import GoalStatus

_FIELDS = frozenset({'title', 'description', 'status', 'deadline', 'category_id', 'duration_minutes'})


@dataclass(frozen=True, slots=True)
class GoalProgress:
    """Прогресс цели: выполненные среди неотменённых задач (ФТ-12)."""

    done: int
    total: int
    percent: int


@dataclass(frozen=True, slots=True)
class GoalDeletionPreview:
    """Сколько задач останется без цели и сколько файлов цели удалится (ФТ-13)."""

    tasks: int
    files: int


class GoalRepository(Repository):
    """Цели пользователя. Все методы видят только записи user_id."""

    def list(self, user_id: UUID, status: GoalStatus | None = None) -> Sequence[Goal]:
        stmt = select(Goal).where(Goal.user_id == user_id)
        if status is not None:
            stmt = stmt.where(Goal.status == status)
        return self._read(stmt.order_by(Goal.created_at, Goal.id)).all()

    def get(self, user_id: UUID, goal_id: UUID) -> Goal:
        goal = self._read(
            select(Goal).where(Goal.user_id == user_id, Goal.id == goal_id)
        ).one_or_none()
        if goal is None:
            raise NotFoundError('Цель не найдена')
        return goal

    def create(self, user_id: UUID, data: Mapping[str, Any]) -> Goal:
        values = checked_fields(data, _FIELDS)
        with guarded_write(self._session):
            return self._session.scalars(
                insert(Goal).values(user_id=user_id, **values).returning(Goal)
            ).one()

    def update(self, user_id: UUID, goal_id: UUID, data: Mapping[str, Any]) -> Goal:
        values = checked_fields(data, _FIELDS)
        if not values:
            return self.get(user_id, goal_id)
        with guarded_write(self._session):
            goal = self._session.scalars(
                update(Goal)
                .where(Goal.user_id == user_id, Goal.id == goal_id)
                .values(**values)
                .returning(Goal)
                .execution_options(populate_existing=True)
            ).one_or_none()
        if goal is None:
            raise NotFoundError('Цель не найдена')
        return goal

    def delete(self, user_id: UUID, goal_id: UUID) -> None:
        """Удалить цель; её задачи остаются без цели, файлы цели удаляются (ФТ-13)."""
        with guarded_write(self._session):
            deleted = self._session.scalars(
                delete(Goal).where(Goal.user_id == user_id, Goal.id == goal_id).returning(Goal.id)
            ).one_or_none()
        if deleted is None:
            raise NotFoundError('Цель не найдена')

    def deletion_preview(self, user_id: UUID, goal_id: UUID) -> GoalDeletionPreview:
        self.get(user_id, goal_id)
        preview = func.planner.goal_deletion_preview(user_id, goal_id).table_valued('tasks', 'files')
        row = self._session.execute(select(preview.c.tasks, preview.c.files)).one()
        return GoalDeletionPreview(tasks=row.tasks, files=row.files)

    def progress(self, user_id: UUID, goal_id: UUID) -> GoalProgress:
        self.get(user_id, goal_id)
        progress = func.planner.goal_progress(user_id, goal_id).table_valued('done', 'total', 'percent')
        row = self._session.execute(
            select(progress.c.done, progress.c.total, progress.c.percent)
        ).one()
        return GoalProgress(done=row.done, total=row.total, percent=row.percent)
