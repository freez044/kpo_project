-- Проверка схемы: ограничения, каскады, триггеры, функции, процедуры, права.
-- Запуск после install.sql: psql -d planner -f database/postgresql/tests/test_schema.sql
-- Всё выполняется в одной транзакции и откатывается: база остаётся пустой.
-- Успех — последняя строка «Все проверки пройдены». При ошибке скрипт останавливается.

\set ON_ERROR_STOP on
\set QUIET on
-- Результаты SELECT не нужны: итог каждой проверки печатается сообщением «ok: …».
-- Пустое устройство называется по-разному: NUL в Windows, /dev/null в Linux и macOS.
\getenv windows_os OS
\if :{?windows_os}
\o NUL
\else
\o /dev/null
\endif
BEGIN;

-- Ожидаем, что запрос упадёт с заданным SQLSTATE.
CREATE FUNCTION pg_temp.expect_error(p_sql text, p_sqlstate text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'Ожидалась ошибка % для: %', p_sqlstate, p_sql;
EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_sqlstate THEN
        RAISE;
    END IF;
END;
$$;

CREATE FUNCTION pg_temp.check(p_ok boolean, p_what text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    IF p_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'Проверка не пройдена: %', p_what;
    END IF;
    RAISE NOTICE 'ok: %', p_what;
END;
$$;

SET client_min_messages = notice;

-- ─── Данные ─────────────────────────────────────────────────────────────────
-- Два пользователя: A и B. Хеш пароля — формально верная строка argon2id.
INSERT INTO planner.users (id, email, password_hash, first_name, last_name, study_group)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Student@Example.com',
        '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2g', '  Иван ', 'Иванов', '   '),
       ('bbbbbbbb-0000-0000-0000-000000000002', 'other@example.com',
        '$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2g', 'Пётр', 'Петров', 'ПИН-31');

INSERT INTO planner.categories (id, user_id, name, color)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Учёба', '#4A6FA5');

INSERT INTO planner.goals (id, user_id, title, category_id)
VALUES ('99999999-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        'Сдать курсовую', 'cccccccc-0000-0000-0000-000000000001'),
       ('99999999-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000002',
        'Чужая цель', NULL);

INSERT INTO planner.tasks (id, user_id, title, goal_id, category_id, sort_order, deadline, priority)
VALUES ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Модель данных',
        '99999999-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 1,
        now() - interval '1 day', 'HIGH'),
       ('11111111-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Контракты API',
        '99999999-0000-0000-0000-000000000001', NULL, 2, now() + interval '2 days', 'MEDIUM'),
       ('11111111-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Без цели',
        NULL, NULL, NULL, NULL, 'LOW');

-- ─── Пользователи ───────────────────────────────────────────────────────────
SELECT pg_temp.check(
    (SELECT first_name = 'Иван' AND study_group IS NULL
       FROM planner.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'имя обрезано, пустая группа стала NULL');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.users (email, password_hash, first_name, last_name)
      VALUES ('STUDENT@example.COM', '$argon2id$v=19$x', 'А', 'Б')$$, '23505');
SELECT pg_temp.check(true, 'email уникален без учёта регистра');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.users (email, password_hash, first_name, last_name)
      VALUES ('new@example.com', 'plain-password', 'А', 'Б')$$, '23514');
SELECT pg_temp.check(true, 'пароль не в формате argon2id отклонён');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.users (email, password_hash, first_name, last_name, timezone)
      VALUES ('tz@example.com', '$argon2id$v=19$x', 'А', 'Б', 'Moscow/Nowhere')$$, '23514');
SELECT pg_temp.check(true, 'неизвестный часовой пояс отклонён');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.users (email, password_hash, first_name, last_name)
      VALUES ('not-an-email', '$argon2id$v=19$x', 'А', 'Б')$$, '23514');
SELECT pg_temp.check(true, 'email без @ отклонён');

UPDATE planner.users SET updated_at = '2000-01-01' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.check(
    (SELECT updated_at > '2000-01-01' FROM planner.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'updated_at обновляется триггером');

-- ─── Категории и чужие ссылки ───────────────────────────────────────────────
SELECT pg_temp.expect_error(
    $$INSERT INTO planner.categories (user_id, name)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'УЧЁБА')$$, '23505');
SELECT pg_temp.check(true, 'название категории уникально без учёта регистра');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.categories (user_id, name, color)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Спорт', 'red')$$, '23514');
SELECT pg_temp.check(true, 'цвет не в формате #RRGGBB отклонён');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.tasks (user_id, title, goal_id)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Чужая ссылка',
              '99999999-0000-0000-0000-000000000002')$$, '23503');
SELECT pg_temp.check(true, 'задача не может сослаться на чужую цель');

-- ─── Задачи ─────────────────────────────────────────────────────────────────
SELECT pg_temp.expect_error(
    $$INSERT INTO planner.tasks (user_id, title) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '   ')$$,
    '23514');
SELECT pg_temp.check(true, 'пустое название задачи отклонено');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.tasks (user_id, title, duration_minutes)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Ноль минут', 0)$$, '23514');
SELECT pg_temp.check(true, 'длительность 0 отклонена');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.tasks (user_id, title, status)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Статус', 'IN_CREATION')$$, '22P02');
SELECT pg_temp.check(true, 'неизвестный статус отклонён');

UPDATE planner.tasks SET status = 'DONE' WHERE id = '11111111-0000-0000-0000-000000000002';
SELECT pg_temp.check(
    (SELECT completed_at IS NOT NULL FROM planner.tasks WHERE id = '11111111-0000-0000-0000-000000000002'),
    'DONE ставит completed_at');
UPDATE planner.tasks SET status = 'IN_PROGRESS' WHERE id = '11111111-0000-0000-0000-000000000002';
SELECT pg_temp.check(
    (SELECT completed_at IS NULL FROM planner.tasks WHERE id = '11111111-0000-0000-0000-000000000002'),
    'выход из DONE очищает completed_at');

SELECT pg_temp.check(
    (SELECT planner.task_is_overdue(deadline, status) FROM planner.tasks
      WHERE id = '11111111-0000-0000-0000-000000000001'),
    'задача с прошедшим сроком просрочена');
SELECT pg_temp.check(
    NOT planner.task_is_overdue(now() - interval '1 day', 'DONE'),
    'выполненная задача не просрочена');

UPDATE planner.tasks SET status = 'DONE' WHERE id = '11111111-0000-0000-0000-000000000001';
SELECT pg_temp.check(
    (SELECT (done, total, percent) = (1, 2, 50)
       FROM planner.goal_progress('aaaaaaaa-0000-0000-0000-000000000001',
                                  '99999999-0000-0000-0000-000000000001')),
    'прогресс цели: 1 из 2, 50%');
SELECT pg_temp.check(
    (SELECT total = 0 FROM planner.goal_progress('bbbbbbbb-0000-0000-0000-000000000002',
                                                 '99999999-0000-0000-0000-000000000001')),
    'прогресс чужой цели не виден');

-- ─── Файлы ──────────────────────────────────────────────────────────────────
INSERT INTO planner.file_attachments (id, user_id, task_id, goal_id, original_name, mime_type, size_bytes, storage_key, sha256)
VALUES ('ffffffff-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000002', NULL, 'tz.docx', 'application/msword', 1024,
        'files/task-file', repeat('a', 64)),
       ('ffffffff-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
        NULL, '99999999-0000-0000-0000-000000000001', 'plan.pdf', 'application/pdf', 2048,
        'files/goal-file', repeat('b', 64));

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.file_attachments (user_id, task_id, goal_id, original_name, mime_type, size_bytes, storage_key, sha256)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002',
              '99999999-0000-0000-0000-000000000001', 'x', 'x', 1, 'files/both', repeat('c', 64))$$, '23514');
SELECT pg_temp.check(true, 'файл не может принадлежать и задаче, и цели');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.file_attachments (user_id, original_name, mime_type, size_bytes, storage_key, sha256)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'x', 1, 'files/none', repeat('c', 64))$$, '23514');
SELECT pg_temp.check(true, 'файл без владельца отклонён');

-- ─── Календарь ──────────────────────────────────────────────────────────────
SELECT pg_temp.expect_error(
    $$INSERT INTO planner.calendar_events (user_id, title, start_at, end_at)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Наоборот',
              '2026-11-02 11:00+03', '2026-11-02 10:00+03')$$, '23514');
SELECT pg_temp.check(true, 'конец события раньше начала отклонён');

INSERT INTO planner.calendar_events (id, user_id, title, start_at, end_at)
VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Встреча',
        '2026-11-02 10:00+03', '2026-11-02 11:00+03');
INSERT INTO planner.schedule_items (id, user_id, task_id, title, start_at, end_at)
VALUES ('dddddddd-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000002', 'Контракты API', '2026-11-02 10:30+03', '2026-11-02 11:30+03'),
       ('dddddddd-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-0000-0000-0000-000000000003', 'Без цели', '2026-11-02 11:30+03', '2026-11-02 12:00+03');

CALL planner.replace_lessons('aaaaaaaa-0000-0000-0000-000000000001', 'ORIOKS', '[
    {"title": "Базы данных", "discipline": "Базы данных", "lesson_type": "Лекция", "room": "3103",
     "start_at": "2026-11-02T08:30:00+03:00", "end_at": "2026-11-02T10:00:00+03:00"},
    {"title": "Сети", "discipline": "Сети", "start_at": "2026-11-02T08:30:00+03:00", "end_at": "2026-11-02T10:00:00+03:00"}
]');

SELECT pg_temp.check(
    (SELECT count(*) = 5 FROM planner.calendar_items('aaaaaaaa-0000-0000-0000-000000000001',
                                                     '2026-11-02 00:00+03', '2026-11-03 00:00+03')),
    'календарь дня: 1 событие, 2 интервала, 2 занятия');

-- Пересечения: событие 10:00–11:00 ↔ интервал 10:30–11:30 — есть;
-- занятия 08:30–10:00 ↔ событие 10:00 — нет (граница); занятие ↔ занятие — не показывается;
-- интервалы 10:30–11:30 и 11:30–12:00 — нет (граница).
SELECT pg_temp.check(
    (SELECT count(*) = 1
       FROM planner.calendar_overlaps('aaaaaaaa-0000-0000-0000-000000000001',
                                      '2026-11-02 00:00+03', '2026-11-03 00:00+03')),
    'найдено ровно одно пересечение (событие и интервал задачи)');

CALL planner.replace_lessons('aaaaaaaa-0000-0000-0000-000000000001', 'FILE', '[
    {"title": "Физкультура", "discipline": "Физкультура",
     "start_at": "2026-11-03T09:00:00+03:00", "end_at": "2026-11-03T10:30:00+03:00"}]');
CALL planner.replace_lessons('aaaaaaaa-0000-0000-0000-000000000001', 'ORIOKS', '[]');
SELECT pg_temp.check(
    (SELECT count(*) = 1 AND bool_and(source = 'FILE') FROM planner.academic_lessons
      WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'замена расписания ОРИОКС не трогает занятия из файла');

-- ─── Удаление задачи и цели ─────────────────────────────────────────────────
SELECT pg_temp.check(
    (SELECT (schedule_items, files) = (1, 1)
       FROM planner.task_deletion_preview('aaaaaaaa-0000-0000-0000-000000000001',
                                          '11111111-0000-0000-0000-000000000002')),
    'превью удаления задачи: 1 интервал, 1 файл');

DELETE FROM planner.tasks WHERE id = '11111111-0000-0000-0000-000000000002';
SELECT pg_temp.check(
    NOT EXISTS (SELECT 1 FROM planner.schedule_items WHERE task_id = '11111111-0000-0000-0000-000000000002')
    AND NOT EXISTS (SELECT 1 FROM planner.file_attachments WHERE task_id = '11111111-0000-0000-0000-000000000002')
    AND EXISTS (SELECT 1 FROM planner.file_deletion_queue WHERE storage_key = 'files/task-file'),
    'удаление задачи удалило интервалы и файлы, файл в очереди на удаление');

SELECT pg_temp.check(
    (SELECT (tasks, files) = (1, 1)
       FROM planner.goal_deletion_preview('aaaaaaaa-0000-0000-0000-000000000001',
                                          '99999999-0000-0000-0000-000000000001')),
    'превью удаления цели: 1 задача, 1 файл');

DELETE FROM planner.goals WHERE id = '99999999-0000-0000-0000-000000000001';
SELECT pg_temp.check(
    (SELECT goal_id IS NULL AND sort_order IS NULL AND user_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       FROM planner.tasks WHERE id = '11111111-0000-0000-0000-000000000001'),
    'удаление цели: задача осталась без цели и порядка, владелец не потерян');
SELECT pg_temp.check(
    EXISTS (SELECT 1 FROM planner.file_deletion_queue WHERE storage_key = 'files/goal-file'),
    'файл цели удалён и поставлен в очередь');

DELETE FROM planner.categories WHERE id = 'cccccccc-0000-0000-0000-000000000001';
SELECT pg_temp.check(
    (SELECT category_id IS NULL FROM planner.tasks WHERE id = '11111111-0000-0000-0000-000000000001'),
    'удаление категории: задача осталась без категории');

-- ─── Предложения ИИ ─────────────────────────────────────────────────────────
INSERT INTO planner.goals (id, user_id, title)
VALUES ('99999999-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Подготовиться к сессии');
INSERT INTO planner.tasks (user_id, title, goal_id, sort_order)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Уже есть', '99999999-0000-0000-0000-000000000003', 1);

INSERT INTO planner.ai_proposals (id, user_id, goal_id, kind, request_text, response_data, model)
VALUES ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
        '99999999-0000-0000-0000-000000000003', 'DECOMPOSE', 'Подготовиться к сессии',
        '{"tasks": [{"title": "Билеты 1–10", "priority": "HIGH", "durationMinutes": 180},
                    {"title": "Билеты 11–20", "priority": "MEDIUM", "durationMinutes": 180}]}',
        'test-model'),
       ('a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
        NULL, 'COMMAND', 'Встреча в пятницу', '{"action": "CREATE", "kind": "EVENT"}', 'test-model');

SELECT pg_temp.expect_error(
    $$INSERT INTO planner.ai_proposals (user_id, goal_id, kind, request_text, response_data, model)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '99999999-0000-0000-0000-000000000003',
              'COMMAND', 'x', '{}', 'm')$$, '23514');
SELECT pg_temp.check(true, 'у текстового запроса не может быть цели');

SELECT pg_temp.check(
    (SELECT count(*) = 3
       FROM planner.apply_decomposition('aaaaaaaa-0000-0000-0000-000000000001',
                                        'a1a1a1a1-0000-0000-0000-000000000001',
                                        '{"tasks": [{"title": "Билеты 1–10", "priority": "HIGH", "durationMinutes": 180},
                                                    {"title": "Билеты 11–20", "priority": "MEDIUM", "durationMinutes": 180},
                                                    {"title": "Консультация"}]}')),
    'декомпозиция создала 3 задачи');
SELECT pg_temp.check(
    (SELECT array_agg(sort_order ORDER BY sort_order) = ARRAY[1, 2, 3, 4]
       FROM planner.tasks WHERE goal_id = '99999999-0000-0000-0000-000000000003'),
    'порядок новых задач продолжает существующие');
SELECT pg_temp.check(
    (SELECT status = 'EDITED' AND decided_at IS NOT NULL AND final_data IS NOT NULL
       FROM planner.ai_proposals WHERE id = 'a1a1a1a1-0000-0000-0000-000000000001'),
    'добавленная задача → статус EDITED, время решения поставлено');

SELECT pg_temp.expect_error(
    $$SELECT planner.apply_decomposition('aaaaaaaa-0000-0000-0000-000000000001',
                                        'a1a1a1a1-0000-0000-0000-000000000001', '{"tasks": [{"title": "x"}]}')$$,
    'AP002');
SELECT pg_temp.check(true, 'повторное применение отклонено');

SELECT pg_temp.expect_error(
    $$SELECT planner.apply_decomposition('bbbbbbbb-0000-0000-0000-000000000002',
                                        'a1a1a1a1-0000-0000-0000-000000000002', '{"tasks": [{"title": "x"}]}')$$,
    'AP001');
SELECT pg_temp.check(true, 'чужое предложение не найдено');

UPDATE planner.users SET ai_history_enabled = false WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
CALL planner.reject_proposal('aaaaaaaa-0000-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000002');
SELECT pg_temp.check(
    NOT EXISTS (SELECT 1 FROM planner.ai_proposals WHERE id = 'a1a1a1a1-0000-0000-0000-000000000002'),
    'история отключена: отклонённое предложение удалено');
UPDATE planner.users SET ai_history_enabled = true WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ─── ОРИОКС и нагрузка ──────────────────────────────────────────────────────
INSERT INTO planner.orioks_connections (user_id, token_encrypted, group_id, semester_start)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '\x00', 312, '2026-09-01');

CALL planner.upsert_assignments('aaaaaaaa-0000-0000-0000-000000000001', '[
    {"external_id": "1042:КР:8", "discipline": "БД", "title": "КР 1", "control_type": "КР", "week": 8,
     "deadline": "2026-11-08T20:59:59Z", "max_grade": 10},
    {"external_id": "1042:ЛР:9", "discipline": "БД", "title": "ЛР 2", "control_type": "ЛР", "week": 9,
     "deadline": "2026-11-15T20:59:59Z", "max_grade": 5}]');
CALL planner.upsert_assignments('aaaaaaaa-0000-0000-0000-000000000001', '[
    {"external_id": "1042:КР:8", "discipline": "БД", "title": "КР 1", "control_type": "КР", "week": 8,
     "deadline": "2026-11-08T20:59:59Z", "max_grade": 10, "is_done": true}]');
SELECT pg_temp.check(
    (SELECT count(*) = 1 AND bool_and(is_done) FROM planner.academic_assignments
      WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'задания обновлены по external_id, исчезнувшее удалено');
SELECT pg_temp.check(
    (SELECT last_sync_at IS NOT NULL FROM planner.orioks_connections
      WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'время синхронизации ОРИОКС записано');

UPDATE planner.academic_assignments SET is_done = false WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
UPDATE planner.tasks SET deadline = '2026-11-05 12:00+03', priority = 'URGENT'
 WHERE id = '11111111-0000-0000-0000-000000000003';
SELECT pg_temp.check(
    (SELECT (tasks_due, high_priority_due, assignments_due) = (1, 1, 1)
       FROM planner.workload_by_week('aaaaaaaa-0000-0000-0000-000000000001', '2026-11-02', 2)
      WHERE week_start = '2026-11-02'),
    'нагрузка недели 02.11: 1 задача (срочная) и 1 задание');

-- ─── Вход и сеансы ──────────────────────────────────────────────────────────
CALL planner.register_login_failure('aaaaaaaa-0000-0000-0000-000000000001', 3);
CALL planner.register_login_failure('aaaaaaaa-0000-0000-0000-000000000001', 3);
SELECT pg_temp.check(
    (SELECT failed_login_count = 2 AND locked_until IS NULL FROM planner.users
      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'две неудачные попытки — ещё не блокировка');
CALL planner.register_login_failure('aaaaaaaa-0000-0000-0000-000000000001', 3);
SELECT pg_temp.check(
    (SELECT failed_login_count = 0 AND locked_until > now() FROM planner.users
      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'третья неудачная попытка блокирует вход');
CALL planner.register_login_success('aaaaaaaa-0000-0000-0000-000000000001');
SELECT pg_temp.check(
    (SELECT locked_until IS NULL FROM planner.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'успешный вход снимает блокировку');

INSERT INTO planner.sessions (id, user_id, refresh_token_hash, expires_at)
VALUES ('5e550000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'hash-1', now() + interval '30 days'),
       ('5e550000-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'hash-2', now() + interval '30 days');
CALL planner.revoke_user_sessions('aaaaaaaa-0000-0000-0000-000000000001', '5e550000-0000-0000-0000-000000000001');
SELECT pg_temp.check(
    (SELECT count(*) FILTER (WHERE revoked_at IS NULL) = 1 FROM planner.sessions
      WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
    'выход со всех устройств, кроме текущего');

-- ─── Права ──────────────────────────────────────────────────────────────────
SET ROLE planner_analyst;
SELECT pg_temp.check(
    (SELECT count(*) = 2 FROM analytics.users),
    'аналитик читает обезличенное представление');
SELECT pg_temp.expect_error($$SELECT email FROM planner.users$$, '42501');
SELECT pg_temp.check(true, 'аналитику закрыта таблица users');
SELECT pg_temp.expect_error($$SELECT email FROM analytics.users$$, '42703');
SELECT pg_temp.check(true, 'в представлении нет email');
RESET ROLE;

SET ROLE planner_app;
SELECT pg_temp.check(
    (SELECT count(*) >= 1 FROM planner.tasks),
    'серверная часть читает таблицы');
SELECT pg_temp.expect_error($$DROP TABLE planner.tasks$$, '42501');
SELECT pg_temp.check(true, 'серверная часть не может удалять таблицы');
RESET ROLE;

-- ─── Удаление пользователя (ФТ-05) ──────────────────────────────────────────
INSERT INTO planner.file_attachments (user_id, task_id, original_name, mime_type, size_bytes, storage_key, sha256)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
        'last.txt', 'text/plain', 1, 'files/last', repeat('d', 64));
DELETE FROM planner.users WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT pg_temp.check(
    NOT EXISTS (SELECT 1 FROM planner.tasks WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
    AND NOT EXISTS (SELECT 1 FROM planner.ai_proposals WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
    AND NOT EXISTS (SELECT 1 FROM planner.sessions WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
    AND NOT EXISTS (SELECT 1 FROM planner.orioks_connections WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
    AND EXISTS (SELECT 1 FROM planner.file_deletion_queue WHERE storage_key = 'files/last'),
    'удаление пользователя удалило все его данные, файлы в очереди');
SELECT pg_temp.check(
    EXISTS (SELECT 1 FROM planner.goals WHERE user_id = 'bbbbbbbb-0000-0000-0000-000000000002'),
    'данные другого пользователя не затронуты');

\echo 'Все проверки пройдены'
ROLLBACK;
