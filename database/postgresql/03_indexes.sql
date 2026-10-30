-- 03. Индексы.
--
-- PostgreSQL сам создаёт индексы только для PRIMARY KEY и UNIQUE.
-- Внешние ключи индексами не покрываются: без них удаление пользователя или цели
-- просматривало бы дочерние таблицы целиком.

-- Канбан-доска и фильтры (ФТ-17, ФТ-18), главная страница (ФТ-20).
CREATE INDEX tasks_user_status_idx   ON planner.tasks (user_id, status);
CREATE INDEX tasks_user_deadline_idx ON planner.tasks (user_id, deadline) WHERE deadline IS NOT NULL;
-- Страница цели в порядке декомпозиции (ФТ-12, ФТ-37) и каскад при удалении цели.
CREATE INDEX tasks_goal_idx          ON planner.tasks (goal_id, sort_order) WHERE goal_id IS NOT NULL;
CREATE INDEX tasks_category_idx      ON planner.tasks (category_id) WHERE category_id IS NOT NULL;

CREATE INDEX goals_user_status_idx   ON planner.goals (user_id, status);
CREATE INDEX goals_category_idx      ON planner.goals (category_id) WHERE category_id IS NOT NULL;

-- Календарь в режимах «день» и «неделя» (ФТ-21).
CREATE INDEX calendar_events_user_start_idx  ON planner.calendar_events  (user_id, start_at);
CREATE INDEX schedule_items_user_start_idx   ON planner.schedule_items   (user_id, start_at);
CREATE INDEX schedule_items_task_idx         ON planner.schedule_items   (task_id);
CREATE INDEX academic_lessons_user_start_idx ON planner.academic_lessons (user_id, start_at);
CREATE INDEX academic_lessons_user_source_idx ON planner.academic_lessons (user_id, source);

-- Учебные задания по сроку (ФТ-26) и нагрузка (ФТ-27).
CREATE INDEX academic_assignments_user_deadline_idx ON planner.academic_assignments (user_id, deadline);

-- Файлы в карточке задачи и на странице цели (ФТ-33), каскадное удаление.
CREATE INDEX file_attachments_task_idx ON planner.file_attachments (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX file_attachments_goal_idx ON planner.file_attachments (goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX file_attachments_user_idx ON planner.file_attachments (user_id);

-- История ИИ (ФТ-40).
CREATE INDEX ai_proposals_user_created_idx ON planner.ai_proposals (user_id, created_at DESC);
CREATE INDEX ai_proposals_goal_idx         ON planner.ai_proposals (goal_id) WHERE goal_id IS NOT NULL;

-- Сеансы: список устройств пользователя и очистка истёкших.
CREATE INDEX sessions_user_idx    ON planner.sessions (user_id);
CREATE INDEX sessions_expires_idx ON planner.sessions (expires_at);
