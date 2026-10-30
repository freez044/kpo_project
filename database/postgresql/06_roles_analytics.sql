-- 06. Роли и обезличенные представления для аналитики.
--
-- Роли без права входа — это наборы прав. Пользователей для входа создают отдельно
-- и включают в нужную роль (см. README.md):
--   planner_app     — серверная часть: чтение и изменение данных, вызов функций;
--   planner_analyst — аналитика: только чтение представлений схемы analytics,
--                     без доступа к таблицам с email, именами и текстами.
-- Таблицы и функции принадлежат роли, которая выполняет миграции.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'planner_app') THEN
        CREATE ROLE planner_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'planner_analyst') THEN
        CREATE ROLE planner_analyst NOLOGIN;
    END IF;
END;
$$;

-- По умолчанию любая роль может вызывать новые функции; закрываем это.
REVOKE ALL ON SCHEMA planner, analytics FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS  IN SCHEMA planner FROM PUBLIC;
REVOKE EXECUTE ON ALL PROCEDURES IN SCHEMA planner FROM PUBLIC;

-- ─── Серверная часть ────────────────────────────────────────────────────────

GRANT USAGE ON SCHEMA planner TO planner_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA planner TO planner_app;
GRANT EXECUTE ON ALL FUNCTIONS  IN SCHEMA planner TO planner_app;
GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA planner TO planner_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA planner TO planner_app;

-- Права на объекты, которые эта же роль создаст в следующих миграциях.
ALTER DEFAULT PRIVILEGES IN SCHEMA planner
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO planner_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA planner
    REVOKE EXECUTE ON ROUTINES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA planner
    GRANT EXECUTE ON ROUTINES TO planner_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA planner
    GRANT USAGE ON SEQUENCES TO planner_app;

-- ─── Аналитика ──────────────────────────────────────────────────────────────
-- Представления выполняются с правами владельца, поэтому аналитик видит только
-- перечисленные столбцы. Здесь нет email, имён, паролей, токенов, названий
-- и описаний задач и целей, текстов запросов к ИИ. user_id остаётся, чтобы
-- считать показатели по пользователям: это псевдонимизация, а не анонимизация,
-- поэтому доступ к analytics тоже выдаётся только команде.

CREATE VIEW analytics.users AS
SELECT u.id,
       u.study_group,
       u.timezone,
       u.ai_history_enabled,
       u.created_at::date AS registered_on,
       (o.user_id IS NOT NULL) AS orioks_connected
  FROM planner.users u
  LEFT JOIN planner.orioks_connections o ON o.user_id = u.id;

CREATE VIEW analytics.goals AS
SELECT id, user_id, category_id, status, deadline, duration_minutes, created_at, updated_at
  FROM planner.goals;

CREATE VIEW analytics.tasks AS
SELECT id, user_id, goal_id, category_id, status, priority, source,
       deadline, duration_minutes, sort_order, completed_at, created_at, updated_at,
       planner.task_is_overdue(deadline, status) AS is_overdue
  FROM planner.tasks;

CREATE VIEW analytics.ai_proposals AS
SELECT id, user_id, goal_id, kind, status, model, latency_ms, created_at, decided_at,
       jsonb_array_length(coalesce(response_data -> 'tasks', '[]')) AS suggested_tasks,
       jsonb_array_length(coalesce(final_data    -> 'tasks', '[]')) AS confirmed_tasks
  FROM planner.ai_proposals;

CREATE VIEW analytics.calendar_load AS
SELECT user_id, 'EVENT' AS kind, start_at, end_at FROM planner.calendar_events
UNION ALL
SELECT user_id, 'SCHEDULE_ITEM', start_at, end_at FROM planner.schedule_items
UNION ALL
SELECT user_id, 'LESSON', start_at, end_at FROM planner.academic_lessons;

GRANT USAGE  ON SCHEMA analytics TO planner_analyst;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO planner_analyst;
-- task_is_overdue вызывается внутри представления с правами владельца,
-- поэтому отдельное право EXECUTE аналитику не нужно.
