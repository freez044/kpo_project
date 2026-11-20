"""Миграции: схема создаётся, откатывается и совпадает с моделями."""

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, inspect, text

from app.db.autogenerate import include_name
from app.db.models import Base
from tests.conftest import run_alembic

ALL_TABLES = {
    'users', 'sessions', 'orioks_connections', 'categories', 'goals', 'tasks',
    'file_attachments', 'file_deletion_queue', 'calendar_events', 'schedule_items',
    'academic_lessons', 'academic_assignments', 'ai_proposals',
}


def test_upgrade_creates_all_tables(engine: Engine):
    assert set(inspect(engine).get_table_names(schema='planner')) == ALL_TABLES


def test_upgrade_records_revision(engine: Engine):
    with engine.connect() as connection:
        assert connection.scalar(text('SELECT version_num FROM alembic_version')) == '0001'


def test_models_match_database(engine: Engine):
    """Модели повторяют 02_tables.sql и 03_indexes.sql: autogenerate не видит расхождений."""
    with engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={'include_schemas': True, 'include_name': include_name, 'compare_type': True},
        )
        assert compare_metadata(context, Base.metadata) == []


def test_downgrade_and_upgrade_again(engine: Engine):
    run_alembic(engine, 'downgrade', 'base')
    try:
        with engine.connect() as connection:
            schemas = connection.scalars(
                text("SELECT nspname FROM pg_namespace WHERE nspname IN ('planner', 'analytics')")
            ).all()
        assert schemas == []
    finally:
        run_alembic(engine, 'upgrade', 'head')   # повторная установка: роли уже есть
    assert set(inspect(engine).get_table_names(schema='planner')) == ALL_TABLES
