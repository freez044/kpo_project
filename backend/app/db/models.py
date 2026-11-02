"""Модели SQLAlchemy для таблиц planner.users, categories, goals, tasks.

Повторяют database/postgresql/02_tables.sql и 03_indexes.sql: столбцы, ключи,
UNIQUE, индексы и комментарии, чтобы `alembic revision --autogenerate` сравнивал модели с базой
без ложных расхождений. Ограничения CHECK и триггеры живут только в базе
(autogenerate их не сравнивает) — правила ТЗ проверяются в схемах Pydantic.

Схему создают миграции, а не Base.metadata.create_all().
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CHAR,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, ENUM
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.enums.priority import TaskPriority
from app.enums.source import TaskSource
from app.enums.statuses import GoalStatus, TaskStatus

SCHEMA = 'planner'


def _pg_enum(enum_cls: type, name: str) -> ENUM:
    # Перечисления создаёт миграция (01_schema_types.sql), модели их только используют.
    return ENUM(
        enum_cls,
        name=name,
        schema=SCHEMA,
        create_type=False,
        values_callable=lambda members: [m.value for m in members],
    )


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA)
    type_annotation_map = {datetime: DateTime(timezone=True)}


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, server_default=func.gen_random_uuid())


def _owner() -> Mapped[uuid.UUID]:
    return mapped_column(ForeignKey('planner.users.id', ondelete='CASCADE'))


def _created_at() -> Mapped[datetime]:
    return mapped_column(server_default=func.now())


class User(Base):
    """Учётная запись (ФТ-01, ФТ-41)."""

    __tablename__ = 'users'
    __table_args__ = (
        UniqueConstraint('email', name='users_email_key'),
        {'comment': 'Учётные записи (ФТ-01, ФТ-41)'},
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(CITEXT)
    password_hash: Mapped[str] = mapped_column(
        Text,
        comment='Хеш argon2id в стандартной строке $argon2id$v=19$m=…,t=…,p=…$соль$хеш; соль внутри строки',
    )
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    study_group: Mapped[str | None] = mapped_column(
        String(50),
        comment='Учебная группа; при подключении ОРИОКС перезаписывается группой из профиля ОРИОКС',
    )
    timezone: Mapped[str] = mapped_column(String(64), server_default=text("'Europe/Moscow'"))
    ai_history_enabled: Mapped[bool] = mapped_column(server_default=text('true'))   # ФТ-40
    failed_login_count: Mapped[int] = mapped_column(server_default=text('0'))
    locked_until: Mapped[datetime | None]
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _created_at()          # дальше ставит триггер


class Category(Base):
    """Категория целей и задач (ФТ-14–ФТ-16)."""

    __tablename__ = 'categories'
    __table_args__ = (
        UniqueConstraint('id', 'user_id', name='categories_id_user_key'),
        UniqueConstraint('user_id', 'name', name='categories_user_name_key'),   # без учёта регистра
        {'comment': 'Категории целей и задач (ФТ-14–ФТ-16)'},
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _owner()
    name: Mapped[str] = mapped_column(CITEXT)
    color: Mapped[str | None] = mapped_column(CHAR(7))   # #RRGGBB


class Goal(Base):
    """Цель (ФТ-10–ФТ-13)."""

    __tablename__ = 'goals'
    __table_args__ = (
        UniqueConstraint('id', 'user_id', name='goals_id_user_key'),
        # В базе — ON DELETE SET NULL (category_id): user_id не обнуляется (ФТ-16).
        ForeignKeyConstraint(
            ['category_id', 'user_id'],
            ['planner.categories.id', 'planner.categories.user_id'],
            name='goals_category_fk',
            ondelete='SET NULL (category_id)',
        ),
        Index('goals_user_status_idx', 'user_id', 'status'),
        Index('goals_category_idx', 'category_id', postgresql_where=text('category_id IS NOT NULL')),
        {'comment': 'Цели (ФТ-10–ФТ-13)'},
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _owner()
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, server_default=text("''"))
    status: Mapped[GoalStatus] = mapped_column(
        _pg_enum(GoalStatus, 'goal_status'), server_default=text("'ACTIVE'")
    )
    deadline: Mapped[datetime | None]
    category_id: Mapped[uuid.UUID | None]
    duration_minutes: Mapped[int | None]
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _created_at()


class Task(Base):
    """Задача (ФТ-06–ФТ-09, ФТ-30, ФТ-31)."""

    __tablename__ = 'tasks'
    __table_args__ = (
        UniqueConstraint('id', 'user_id', name='tasks_id_user_key'),
        ForeignKeyConstraint(
            ['goal_id', 'user_id'],
            ['planner.goals.id', 'planner.goals.user_id'],
            name='tasks_goal_fk',
            ondelete='SET NULL (goal_id)',                  # ФТ-13
        ),
        ForeignKeyConstraint(
            ['category_id', 'user_id'],
            ['planner.categories.id', 'planner.categories.user_id'],
            name='tasks_category_fk',
            ondelete='SET NULL (category_id)',              # ФТ-16
        ),
        Index('tasks_user_status_idx', 'user_id', 'status'),
        Index('tasks_user_deadline_idx', 'user_id', 'deadline',
              postgresql_where=text('deadline IS NOT NULL')),
        Index('tasks_goal_idx', 'goal_id', 'sort_order', postgresql_where=text('goal_id IS NOT NULL')),
        Index('tasks_category_idx', 'category_id', postgresql_where=text('category_id IS NOT NULL')),
        {'comment': 'Задачи (ФТ-06–ФТ-09, ФТ-30, ФТ-31)'},
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _owner()
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, server_default=text("''"))
    status: Mapped[TaskStatus] = mapped_column(
        _pg_enum(TaskStatus, 'task_status'), server_default=text("'BACKLOG'")
    )
    priority: Mapped[TaskPriority] = mapped_column(
        _pg_enum(TaskPriority, 'task_priority'), server_default=text("'MEDIUM'")
    )
    deadline: Mapped[datetime | None]
    goal_id: Mapped[uuid.UUID | None]
    category_id: Mapped[uuid.UUID | None]
    duration_minutes: Mapped[int | None]
    sort_order: Mapped[int | None]                          # порядок внутри цели
    source: Mapped[TaskSource] = mapped_column(
        _pg_enum(TaskSource, 'task_source'), server_default=text("'MANUAL'")
    )
    completed_at: Mapped[datetime | None]                   # ставит триггер при переходе в DONE
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = _created_at()
