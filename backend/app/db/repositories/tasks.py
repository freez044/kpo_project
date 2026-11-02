from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, delete, func, insert, select, update

from app.db.errors import NotFoundError, guarded_write
from app.db.models import Task
from app.db.repositories._base import Repository, checked_fields
from app.enums.priority import TaskPriority
from app.enums.statuses import TaskStatus

# Поля, которые сервис может передать при создании и изменении задачи.
# completed_at ставит триггер (ФТ-30), created_at и updated_at — база.
_UPDATABLE = frozenset({
    'title', 'description', 'status', 'priority', 'deadline',
    'goal_id', 'category_id', 'duration_minutes', 'sort_order',
})
_CREATABLE = _UPDATABLE | {'source'}


@dataclass(frozen=True, slots=True)
class TaskFilters:
    """Фильтры списка задач (ФТ-17, ФТ-18); None — фильтр не задан."""

    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    goal_id: UUID | None = None
    category_id: UUID | None = None
    overdue: bool | None = None


@dataclass(frozen=True, slots=True)
class TaskDeletionPreview:
    """Что удалится вместе с задачей (ФТ-09)."""

    schedule_items: int
    files: int


def is_overdue_expr():
    """Просрочка по правилу ФТ-31 — функция базы planner.task_is_overdue."""
    return func.planner.task_is_overdue(Task.deadline, Task.status, type_=Boolean)


class TaskRepository(Repository):
    """Задачи пользователя. Все методы видят только записи user_id."""

    def list(self, user_id: UUID, filters: TaskFilters | None = None) -> Sequence[Task]:
        stmt = select(Task).where(Task.user_id == user_id)
        if filters is not None:
            if filters.status is not None:
                stmt = stmt.where(Task.status == filters.status)
            if filters.priority is not None:
                stmt = stmt.where(Task.priority == filters.priority)
            if filters.goal_id is not None:
                stmt = stmt.where(Task.goal_id == filters.goal_id)
            if filters.category_id is not None:
                stmt = stmt.where(Task.category_id == filters.category_id)
            if filters.overdue is not None:
                stmt = stmt.where(is_overdue_expr() if filters.overdue else ~is_overdue_expr())
        # Задачи цели — в порядке декомпозиции, остальные — по времени создания.
        stmt = stmt.order_by(Task.sort_order.asc().nulls_last(), Task.created_at, Task.id)
        return self._read(stmt).all()

    def get(self, user_id: UUID, task_id: UUID) -> Task:
        task = self._read(
            select(Task).where(Task.user_id == user_id, Task.id == task_id)
        ).one_or_none()
        if task is None:
            raise NotFoundError('Задача не найдена')
        return task

    def create(self, user_id: UUID, data: Mapping[str, Any]) -> Task:
        values = checked_fields(data, _CREATABLE)
        with guarded_write(self._session):
            return self._session.scalars(
                insert(Task).values(user_id=user_id, **values).returning(Task)
            ).one()

    def update(self, user_id: UUID, task_id: UUID, data: Mapping[str, Any]) -> Task:
        """Изменить переданные поля; None очищает необязательное поле (PATCH)."""
        values = checked_fields(data, _UPDATABLE)
        if not values:
            return self.get(user_id, task_id)
        with guarded_write(self._session):
            task = self._session.scalars(
                update(Task)
                .where(Task.user_id == user_id, Task.id == task_id)
                .values(**values)
                .returning(Task)
                .execution_options(populate_existing=True)   # completed_at и updated_at — от триггеров
            ).one_or_none()
        if task is None:
            raise NotFoundError('Задача не найдена')
        return task

    def change_status(self, user_id: UUID, task_id: UUID, status: TaskStatus) -> Task:
        return self.update(user_id, task_id, {'status': status})

    def delete(self, user_id: UUID, task_id: UUID) -> None:
        """Удалить задачу; интервалы и файлы удаляются каскадом (ФТ-09)."""
        with guarded_write(self._session):
            deleted = self._session.scalars(
                delete(Task).where(Task.user_id == user_id, Task.id == task_id).returning(Task.id)
            ).one_or_none()
        if deleted is None:
            raise NotFoundError('Задача не найдена')

    def deletion_preview(self, user_id: UUID, task_id: UUID) -> TaskDeletionPreview:
        self.get(user_id, task_id)
        preview = func.planner.task_deletion_preview(user_id, task_id).table_valued(
            'schedule_items', 'files'
        )
        row = self._session.execute(select(preview.c.schedule_items, preview.c.files)).one()
        return TaskDeletionPreview(schedule_items=row.schedule_items, files=row.files)
