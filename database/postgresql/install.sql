-- Установка схемы Adaptive AI Planner в пустую базу.
-- Запуск: psql -d planner -f database/postgresql/install.sql
-- Все скрипты выполняются одной транзакцией: при ошибке база остаётся пустой.

\set ON_ERROR_STOP on

BEGIN;
\ir 01_schema_types.sql
\ir 02_tables.sql
\ir 03_indexes.sql
\ir 04_functions_triggers.sql
\ir 05_procedures.sql
\ir 06_roles_analytics.sql
COMMIT;
