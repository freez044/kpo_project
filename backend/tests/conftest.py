"""Общие фикстуры: PostgreSQL в Docker, миграции, сеанс с откатом после каждого теста.

По умолчанию база поднимается в контейнере (testcontainers, нужен запущенный Docker).
Если задан TEST_DATABASE_URL, тесты используют эту базу: она должна быть пустой,
тесты применяют к ней миграции и откатывают их (DROP SCHEMA planner, analytics).
"""

import os
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from app.db.repositories import CategoryRepository, GoalRepository, TaskRepository, UserRepository

ALEMBIC_INI = Path(__file__).resolve().parents[1] / 'alembic.ini'
POSTGRES_IMAGE = 'postgres:16-alpine'
# Строка в формате argon2id: ограничение users_password_is_argon2 проверяет только префикс.
PASSWORD_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29sdHNvbHQ$aGFzaGhhc2hoYXNoaGFzaA'


@pytest.fixture(scope='session')
def database_url() -> Iterator[str]:
    url = os.environ.get('TEST_DATABASE_URL')
    if url:
        yield url
        return
    from testcontainers.postgres import PostgresContainer

    with PostgresContainer(POSTGRES_IMAGE, driver='psycopg') as postgres:
        yield postgres.get_connection_url()


def run_alembic(engine: Engine, action: str, revision: str) -> None:
    config = Config(str(ALEMBIC_INI))
    with engine.begin() as connection:
        config.attributes['connection'] = connection
        getattr(command, action)(config, revision)


@pytest.fixture(scope='session')
def engine(database_url: str) -> Iterator[Engine]:
    engine = create_engine(database_url)
    run_alembic(engine, 'upgrade', 'head')
    yield engine
    run_alembic(engine, 'downgrade', 'base')
    engine.dispose()


@pytest.fixture
def session(engine: Engine) -> Iterator[Session]:
    """Сеанс внутри внешней транзакции: всё, что сделал тест, откатывается."""
    with engine.connect() as connection:
        transaction = connection.begin()
        session = Session(bind=connection, join_transaction_mode='create_savepoint')
        try:
            yield session
        finally:
            session.close()
            transaction.rollback()


@pytest.fixture
def users(session: Session) -> UserRepository:
    return UserRepository(session)


@pytest.fixture
def categories(session: Session) -> CategoryRepository:
    return CategoryRepository(session)


@pytest.fixture
def goals(session: Session) -> GoalRepository:
    return GoalRepository(session)


@pytest.fixture
def tasks(session: Session) -> TaskRepository:
    return TaskRepository(session)


def make_user(users: UserRepository, **overrides) -> uuid.UUID:
    data = {
        'email': f'student-{uuid.uuid4().hex[:8]}@example.com',
        'password_hash': PASSWORD_HASH,
        'first_name': 'Иван',
        'last_name': 'Иванов',
    } | overrides
    return users.create(data).id


@pytest.fixture
def user_id(users: UserRepository) -> uuid.UUID:
    return make_user(users)


@pytest.fixture
def other_user_id(users: UserRepository) -> uuid.UUID:
    return make_user(users)
