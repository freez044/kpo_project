"""Схема PostgreSQL по ТЗ v12 из database/postgresql/install.sql

Revision ID: 0001
Revises:
Create Date: 2026-10-30

Выполняет скрипты 01–06 в порядке, заданном install.sql, внутри транзакции миграции.
Эти скрипты — снимок первой версии схемы: после применения миграции их не меняют,
структура дальше меняется только новыми миграциями.

Откат удаляет схемы planner и analytics со всеми данными. Роли planner_app и
planner_analyst общие для сервера и остаются; расширение citext тоже остаётся.
"""

import re
from collections.abc import Sequence
from pathlib import Path

from alembic import context, op

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA_DIR = Path(__file__).resolve().parents[3] / 'database' / 'postgresql'
_INCLUDE = re.compile(r'^\\ir\s+(\S+)\s*$', re.MULTILINE)


def install_scripts() -> list[Path]:
    """Файлы из строк «\\ir …» в install.sql, по порядку."""
    install = (SCHEMA_DIR / 'install.sql').read_text(encoding='utf-8')
    scripts = [SCHEMA_DIR / name for name in _INCLUDE.findall(install)]
    if not scripts:
        raise RuntimeError(f'В {SCHEMA_DIR / "install.sql"} нет строк \\ir')
    return scripts


def upgrade() -> None:
    for script in install_scripts():
        sql = script.read_text(encoding='utf-8')
        if context.is_offline_mode():
            op.execute(sql)
        else:
            # Скрипт целиком, без параметров: psycopg не разбирает «%» и выполняет
            # несколько команд за раз. Соединение то же, транзакция — миграции.
            op.get_bind().connection.driver_connection.execute(sql)


def downgrade() -> None:
    op.execute('DROP SCHEMA planner, analytics CASCADE')
