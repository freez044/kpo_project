"""Окружение Alembic.

Адрес базы — DATABASE_URL (переменная окружения или .env). Тесты передают готовое
соединение через config.attributes['connection'].

autogenerate сравнивает только таблицы из моделей (app/db/autogenerate.py).
"""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection, create_engine, pool

from app.db.autogenerate import include_name
from app.db.models import Base

config = context.config
if config.config_file_name is not None and config.attributes.get('connection') is None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _configure(**kwargs) -> None:
    context.configure(
        target_metadata=target_metadata,
        include_schemas=True,
        include_name=include_name,
        compare_type=True,
        **kwargs,
    )


def _database_url() -> str:
    from app.config import get_settings

    return get_settings().database_url


def run_migrations_offline() -> None:
    _configure(url=_database_url(), literal_binds=True, dialect_opts={'paramstyle': 'named'})
    with context.begin_transaction():
        context.run_migrations()


def _run_with(connection: Connection) -> None:
    _configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get('connection')
    if connection is not None:
        _run_with(connection)
        return
    engine = create_engine(_database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        _run_with(connection)


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
