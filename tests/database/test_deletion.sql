
-- ================================================
-- 003_test_deletion.sql
-- Проверка удаления данных из PostgreSQL
-- ================================================
--
-- Скрипт:
-- 1. Создаёт временные тестовые записи.
-- 2. Проверяет правила удаления.
-- 3. Проверяет сохранность независимых данных.
-- 4. Откатывает все изменения.
--
-- Запускать целиком как один DO-блок.
-- BEGIN / COMMIT вручную не требуются.
--
-- ================================================

DO $test$

DECLARE

    -- Пользователи
    v_user_a BIGINT;
    v_user_b BIGINT;

    -- Категории
    v_category_a BIGINT;
    v_category_a_new BIGINT;
    v_category_b BIGINT;

    -- Цели
    v_goal_a BIGINT;
    v_goal_a_new BIGINT;
    v_goal_b BIGINT;

    -- Задачи
    v_task_a BIGINT;
    v_task_independent BIGINT;
    v_task_goal BIGINT;
    v_task_new BIGINT;
    v_task_b BIGINT;

    -- Рабочие сессии
    v_session_a BIGINT;
    v_session_independent BIGINT;
    v_session_goal BIGINT;
    v_session_new BIGINT;
    v_session_b BIGINT;

    -- Элементы расписания
    v_schedule_a BIGINT;
    v_schedule_independent BIGINT;
    v_schedule_independent_2 BIGINT;
    v_schedule_goal BIGINT;
    v_schedule_new BIGINT;
    v_schedule_b BIGINT;

    -- Прикреплённые файлы
    v_file_a BIGINT;
    v_file_independent BIGINT;
    v_file_goal BIGINT;
    v_file_goal_task BIGINT;
    v_file_new BIGINT;
    v_file_new_goal BIGINT;
    v_file_b BIGINT;

    -- Уникальные значения для тестовых записей
    v_email_a TEXT;
    v_email_b TEXT;
    v_storage_prefix TEXT;

    -- Счётчик успешных проверок
    v_passed INTEGER := 0;

BEGIN

    -- Вложенный блок нужен для отката
    -- всех изменений после проверок.

    BEGIN

        -- ========================================
        -- 1. ПОДГОТОВКА ТЕСТОВЫХ ДАННЫХ
        -- ========================================

        -- Используем идентификатор транзакции,
        -- чтобы избежать конфликтов с другими
        -- тестовыми записями.

        v_email_a := format(
            'delete-test-%s-a@example.invalid',
            txid_current()
        );

        v_email_b := format(
            'delete-test-%s-b@example.invalid',
            txid_current()
        );

        v_storage_prefix := format(
            'tests/deletion/%s/',
            txid_current()
        );


        -- ========================================
        -- ПОЛЬЗОВАТЕЛИ
        -- ========================================

        INSERT INTO app_user (
            first_name,
            last_name,
            email,
            password_hash
        )
        VALUES (
            'DeleteTest',
            'UserA',
            v_email_a,
            'TEST_ONLY'
        )
        RETURNING id INTO v_user_a;


        INSERT INTO app_user (
            first_name,
            last_name,
            email,
            password_hash
        )
        VALUES (
            'DeleteTest',
            'UserB',
            v_email_b,
            'TEST_ONLY'
        )
        RETURNING id INTO v_user_b;


        -- ========================================
        -- КАТЕГОРИИ
        -- ========================================

        INSERT INTO category (
            user_id,
            name
        )
        VALUES (
            v_user_a,
            'DeleteTest Category A'
        )
        RETURNING id INTO v_category_a;


        INSERT INTO category (
            user_id,
            name
        )
        VALUES (
            v_user_b,
            'DeleteTest Category B'
        )
        RETURNING id INTO v_category_b;


        -- ========================================
        -- ЦЕЛИ
        -- ========================================

        INSERT INTO goal (
            user_id,
            category_id,
            title
        )
        VALUES (
            v_user_a,
            v_category_a,
            'DeleteTest Goal A'
        )
        RETURNING id INTO v_goal_a;


        INSERT INTO goal (
            user_id,
            category_id,
            title
        )
        VALUES (
            v_user_b,
            v_category_b,
            'DeleteTest Goal B'
        )
        RETURNING id INTO v_goal_b;


        -- ========================================
        -- ЗАДАЧИ
        -- ========================================

        -- Задача пользователя A с целью

        INSERT INTO task (
            user_id,
            goal_id,
            category_id,
            title
        )
        VALUES (
            v_user_a,
            v_goal_a,
            v_category_a,
            'DeleteTest Task A'
        )
        RETURNING id INTO v_task_a;


        -- Самостоятельная задача пользователя A

        INSERT INTO task (
            user_id,
            category_id,
            title
        )
        VALUES (
            v_user_a,
            v_category_a,
            'DeleteTest Independent Task'
        )
        RETURNING id INTO v_task_independent;


        -- Задача пользователя B

        INSERT INTO task (
            user_id,
            goal_id,
            category_id,
            title
        )
        VALUES (
            v_user_b,
            v_goal_b,
            v_category_b,
            'DeleteTest Task B'
        )
        RETURNING id INTO v_task_b;


        -- ========================================
        -- РАБОЧИЕ СЕССИИ
        -- ========================================

        INSERT INTO task_session (
            task_id,
            started_at,
            ended_at
        )
        VALUES (
            v_task_a,
            NOW() - INTERVAL '2 hours',
            NOW() - INTERVAL '1 hour'
        )
        RETURNING id INTO v_session_a;


        INSERT INTO task_session (
            task_id,
            started_at,
            ended_at
        )
        VALUES (
            v_task_independent,
            NOW() - INTERVAL '3 hours',
            NOW() - INTERVAL '2 hours'
        )
        RETURNING id INTO v_session_independent;


        INSERT INTO task_session (
            task_id,
            started_at,
            ended_at
        )
        VALUES (
            v_task_b,
            NOW() - INTERVAL '2 hours',
            NOW() - INTERVAL '1 hour'
        )
        RETURNING id INTO v_session_b;


        -- ========================================
        -- РАСПИСАНИЕ
        -- ========================================

        INSERT INTO schedule_item (
            task_id,
            start_at,
            end_at
        )
        VALUES (
            v_task_a,
            '2030-01-15 10:00:00+00',
            '2030-01-15 11:00:00+00'
        )
        RETURNING id INTO v_schedule_a;


        -- Два интервала самостоятельной задачи

        INSERT INTO schedule_item (
            task_id,
            start_at,
            end_at
        )
        VALUES (
            v_task_independent,
            '2030-01-15 12:00:00+00',
            '2030-01-15 13:00:00+00'
        )
        RETURNING id INTO v_schedule_independent;


        INSERT INTO schedule_item (
            task_id,
            start_at,
            end_at
        )
        VALUES (
            v_task_independent,
            '2030-01-15 15:00:00+00',
            '2030-01-15 16:00:00+00'
        )
        RETURNING id INTO v_schedule_independent_2;


        INSERT INTO schedule_item (
            task_id,
            start_at,
            end_at
        )
        VALUES (
            v_task_b,
            '2030-01-15 17:00:00+00',
            '2030-01-15 18:00:00+00'
        )
        RETURNING id INTO v_schedule_b;


        -- ========================================
        -- ПРИКРЕПЛЁННЫЕ ФАЙЛЫ
        -- ========================================

        -- Файл задачи A

        INSERT INTO file_attachment (
            user_id,
            task_id,
            original_name,
            storage_key,
            mime_type,
            size_bytes
        )
        VALUES (
            v_user_a,
            v_task_a,
            'task_a.pdf',
            v_storage_prefix || 'task_a.pdf',
            'application/pdf',
            100
        )
        RETURNING id INTO v_file_a;


        -- Файл самостоятельной задачи

        INSERT INTO file_attachment (
            user_id,
            task_id,
            original_name,
            storage_key,
            mime_type,
            size_bytes
        )
        VALUES (
            v_user_a,
            v_task_independent,
            'independent.pdf',
            v_storage_prefix || 'independent.pdf',
            'application/pdf',
            100
        )
        RETURNING id INTO v_file_independent;


        -- Файл цели A

        INSERT INTO file_attachment (
            user_id,
            goal_id,
            original_name,
            storage_key,
            mime_type,
            size_bytes
        )
        VALUES (
            v_user_a,
            v_goal_a,
            'goal_a.pdf',
            v_storage_prefix || 'goal_a.pdf',
            'application/pdf',
            100
        )
        RETURNING id INTO v_file_goal;


        -- Файл пользователя B

        INSERT INTO file_attachment (
            user_id,
            task_id,
            original_name,
            storage_key,
            mime_type,
            size_bytes
        )
        VALUES (
            v_user_b,
            v_task_b,
            'task_b.pdf',
            v_storage_prefix || 'task_b.pdf',
            'application/pdf',
            100
        )
        RETURNING id INTO v_file_b;


        RAISE NOTICE 'Test data created';


        -- ========================================
        -- ТЕСТ 1. УДАЛЕНИЕ КАТЕГОРИИ
        -- ========================================

        DELETE FROM category
        WHERE id = v_category_a;


        -- Категория удалена

        IF EXISTS (
            SELECT 1
            FROM category
            WHERE id = v_category_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: category was not deleted';

        END IF;


        -- Цель сохранилась без категории

        IF NOT EXISTS (
            SELECT 1
            FROM goal
            WHERE id = v_goal_a
              AND category_id IS NULL
        ) THEN

            RAISE EXCEPTION
                'FAIL: goal was not preserved';

        END IF;


        -- Обе задачи сохранились без категории

        IF (
            SELECT COUNT(*)
            FROM task
            WHERE id IN (
                v_task_a,
                v_task_independent
            )
              AND category_id IS NULL
        ) <> 2 THEN

            RAISE EXCEPTION
                'FAIL: tasks were not preserved';

        END IF;


        -- Категория другого пользователя сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM category
            WHERE id = v_category_b
        ) THEN

            RAISE EXCEPTION
                'FAIL: another user category was deleted';

        END IF;


        v_passed := v_passed + 1;

        RAISE NOTICE
            'PASS 1: category deletion';


        -- ========================================
        -- ТЕСТ 2. УДАЛЕНИЕ ЭЛЕМЕНТА РАСПИСАНИЯ
        -- ========================================

        DELETE FROM schedule_item
        WHERE id = v_schedule_independent;


        -- Выбранный интервал удалён

        IF EXISTS (
            SELECT 1
            FROM schedule_item
            WHERE id = v_schedule_independent
        ) THEN

            RAISE EXCEPTION
                'FAIL: schedule item was not deleted';

        END IF;


        -- Второй интервал сохранился

        IF NOT EXISTS (
            SELECT 1
            FROM schedule_item
            WHERE id = v_schedule_independent_2
              AND task_id = v_task_independent
        ) THEN

            RAISE EXCEPTION
                'FAIL: another schedule item was deleted';

        END IF;


        -- Сама задача сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM task
            WHERE id = v_task_independent
        ) THEN

            RAISE EXCEPTION
                'FAIL: task was deleted with schedule item';

        END IF;


        v_passed := v_passed + 1;

        RAISE NOTICE
            'PASS 2: schedule item deletion';


        -- ========================================
        -- ТЕСТ 3. УДАЛЕНИЕ РАБОЧЕЙ СЕССИИ
        -- ========================================

        DELETE FROM task_session
        WHERE id = v_session_independent;


        -- Сессия удалена

        IF EXISTS (
            SELECT 1
            FROM task_session
            WHERE id = v_session_independent
        ) THEN

            RAISE EXCEPTION
                'FAIL: session was not deleted';

        END IF;


        -- Задача осталась

        IF NOT EXISTS (
            SELECT 1
            FROM task
            WHERE id = v_task_independent
        ) THEN

            RAISE EXCEPTION
                'FAIL: task was deleted with session';

        END IF;


        -- Сессия другой задачи осталась

        IF NOT EXISTS (
            SELECT 1
            FROM task_session
            WHERE id = v_session_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: unrelated session was deleted';

        END IF;


        v_passed := v_passed + 1;

        RAISE NOTICE
            'PASS 3: task session deletion';


        -- ========================================
        -- ТЕСТ 4. УДАЛЕНИЕ ФАЙЛА
        -- ========================================

        DELETE FROM file_attachment
        WHERE id = v_file_independent;


        -- Метаданные файла удалены

        IF EXISTS (
            SELECT 1
            FROM file_attachment
            WHERE id = v_file_independent
        ) THEN

            RAISE EXCEPTION
                'FAIL: attachment was not deleted';

        END IF;


        -- Задача сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM task
            WHERE id = v_task_independent
        ) THEN

            RAISE EXCEPTION
                'FAIL: task was deleted with attachment';

        END IF;


        -- Другой файл сохранился

        IF NOT EXISTS (
            SELECT 1
            FROM file_attachment
            WHERE id = v_file_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: unrelated attachment was deleted';

        END IF;


        v_passed := v_passed + 1;

        RAISE NOTICE
            'PASS 4: attachment metadata deletion';


        -- ========================================
        -- ТЕСТ 5. УДАЛЕНИЕ ЗАДАЧИ
        -- ========================================

        DELETE FROM task
        WHERE id = v_task_a;


        -- Задача удалена

        IF EXISTS (
            SELECT 1
            FROM task
            WHERE id = v_task_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: task was not deleted';

        END IF;


        -- Рабочая сессия удалена

        IF EXISTS (
            SELECT 1
            FROM task_session
            WHERE id = v_session_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: task session was not deleted';

        END IF;


        -- Запланированный интервал удалён

        IF EXISTS (
            SELECT 1
            FROM schedule_item
            WHERE id = v_schedule_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: task schedule was not deleted';

        END IF;


        -- Метаданные файла удалены

        IF EXISTS (
            SELECT 1
            FROM file_attachment
            WHERE id = v_file_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: task attachment was not deleted';

        END IF;


        -- Цель сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM goal
            WHERE id = v_goal_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: goal was deleted with task';

        END IF;


        -- Самостоятельная задача сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM task
            WHERE id = v_task_independent
        ) THEN

            RAISE EXCEPTION
                'FAIL: unrelated task was deleted';

        END IF;


        -- Её расписание сохранилось

        IF NOT EXISTS (
            SELECT 1
            FROM schedule_item
            WHERE id = v_schedule_independent_2
        ) THEN

            RAISE EXCEPTION
                'FAIL: unrelated schedule was deleted';

        END IF;


        v_passed := v_passed + 1;

        RAISE NOTICE
            'PASS 5: task cascade deletion';


        -- ========================================
        -- ПОДГОТОВКА ТЕСТА УДАЛЕНИЯ ЦЕЛИ
        -- ========================================

        -- Создаём новую задачу внутри цели A

        INSERT INTO task (
            user_id,
            goal_id,
            title
        )
        VALUES (
            v_user_a,
            v_goal_a,
            'DeleteTest Goal Task'
        )
        RETURNING id INTO v_task_goal;


        INSERT INTO task_session (
            task_id,
            started_at,
            ended_at
        )
        VALUES (
            v_task_goal,
            NOW() - INTERVAL '2 hours',
            NOW() - INTERVAL '1 hour'
        )
        RETURNING id INTO v_session_goal;


        INSERT INTO schedule_item (
            task_id,
            start_at,
            end_at
        )
        VALUES (
            v_task_goal,
            '2030-01-16 10:00:00+00',
            '2030-01-16 11:00:00+00'
        )
        RETURNING id INTO v_schedule_goal;


        INSERT INTO file_attachment (
            user_id,
            task_id,
            original_name,
            storage_key,
            mime_type,
            size_bytes
        )
        VALUES (
            v_user_a,
            v_task_goal,
            'goal_task.pdf',
            v_storage_prefix || 'goal_task.pdf',
            'application/pdf',
            100
        )
        RETURNING id INTO v_file_goal_task;


        -- ========================================
        -- ТЕСТ 6. УДАЛЕНИЕ ЦЕЛИ
        -- ========================================

        DELETE FROM goal
        WHERE id = v_goal_a;


        -- Цель удалена

        IF EXISTS (
            SELECT 1
            FROM goal
            WHERE id = v_goal_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: goal was not deleted';

        END IF;


        -- Задача цели удалена

        IF EXISTS (
            SELECT 1
            FROM task
            WHERE id = v_task_goal
        ) THEN

            RAISE EXCEPTION
                'FAIL: goal task was not deleted';

        END IF;


        -- Сессия задачи удалена

        IF EXISTS (
            SELECT 1
            FROM task_session
            WHERE id = v_session_goal
        ) THEN

            RAISE EXCEPTION
                'FAIL: goal task session was not deleted';

        END IF;


        -- Запланированный интервал удалён

        IF EXISTS (
            SELECT 1
            FROM schedule_item
            WHERE id = v_schedule_goal
        ) THEN

            RAISE EXCEPTION
                'FAIL: goal task schedule was not deleted';

        END IF;


        -- Файл задачи удалён

        IF EXISTS (
            SELECT 1
            FROM file_attachment
            WHERE id = v_file_goal_task
        ) THEN

            RAISE EXCEPTION
                'FAIL: goal task attachment was not deleted';

        END IF;


        -- Файл самой цели удалён

        IF EXISTS (
            SELECT 1
            FROM file_attachment
            WHERE id = v_file_goal
        ) THEN

            RAISE EXCEPTION
                'FAIL: goal attachment was not deleted';

        END IF;


        -- Самостоятельная задача сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM task
            WHERE id = v_task_independent
              AND goal_id IS NULL
        ) THEN

            RAISE EXCEPTION
                'FAIL: independent task was deleted';

        END IF;


        -- Её расписание сохранилось

        IF NOT EXISTS (
            SELECT 1
            FROM schedule_item
            WHERE id = v_schedule_independent_2
        ) THEN

            RAISE EXCEPTION
                'FAIL: independent task schedule was deleted';

        END IF;


        v_passed := v_passed + 1;

        RAISE NOTICE
            'PASS 6: goal cascade deletion';


        -- ========================================
        -- ПОДГОТОВКА УДАЛЕНИЯ ПОЛЬЗОВАТЕЛЯ
        -- ========================================

        -- Создаём новую категорию

        INSERT INTO category (
            user_id,
            name
        )
        VALUES (
            v_user_a,
            'DeleteTest New Category'
        )
        RETURNING id INTO v_category_a_new;


        -- Создаём новую цель

        INSERT INTO goal (
            user_id,
            category_id,
            title
        )
        VALUES (
            v_user_a,
            v_category_a_new,
            'DeleteTest New Goal'
        )
        RETURNING id INTO v_goal_a_new;


        -- Создаём задачу новой цели

        INSERT INTO task (
            user_id,
            goal_id,
            category_id,
            title
        )
        VALUES (
            v_user_a,
            v_goal_a_new,
            v_category_a_new,
            'DeleteTest New Task'
        )
        RETURNING id INTO v_task_new;


        -- Рабочая сессия

        INSERT INTO task_session (
            task_id,
            started_at,
            ended_at
        )
        VALUES (
            v_task_new,
            NOW() - INTERVAL '2 hours',
            NOW() - INTERVAL '1 hour'
        )
        RETURNING id INTO v_session_new;


        -- Расписание

        INSERT INTO schedule_item (
            task_id,
            start_at,
            end_at
        )
        VALUES (
            v_task_new,
            '2030-01-17 10:00:00+00',
            '2030-01-17 11:00:00+00'
        )
        RETURNING id INTO v_schedule_new;


        -- Файл задачи

        INSERT INTO file_attachment (
            user_id,
            task_id,
            original_name,
            storage_key,
            mime_type,
            size_bytes
        )
        VALUES (
            v_user_a,
            v_task_new,
            'new_task.pdf',
            v_storage_prefix || 'new_task.pdf',
            'application/pdf',
            100
        )
        RETURNING id INTO v_file_new;


        -- Файл цели

        INSERT INTO file_attachment (
            user_id,
            goal_id,
            original_name,
            storage_key,
            mime_type,
            size_bytes
        )
        VALUES (
            v_user_a,
            v_goal_a_new,
            'new_goal.pdf',
            v_storage_prefix || 'new_goal.pdf',
            'application/pdf',
            100
        )
        RETURNING id INTO v_file_new_goal;


        -- ========================================
        -- ТЕСТ 7. УДАЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
        -- ========================================

        DELETE FROM app_user
        WHERE id = v_user_a;


        -- Пользователь удалён

        IF EXISTS (
            SELECT 1
            FROM app_user
            WHERE id = v_user_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: user was not deleted';

        END IF;


        -- Категории пользователя удалены

        IF EXISTS (
            SELECT 1
            FROM category
            WHERE user_id = v_user_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: user categories remain';

        END IF;


        -- Цели пользователя удалены

        IF EXISTS (
            SELECT 1
            FROM goal
            WHERE user_id = v_user_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: user goals remain';

        END IF;


        -- Задачи пользователя удалены

        IF EXISTS (
            SELECT 1
            FROM task
            WHERE user_id = v_user_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: user tasks remain';

        END IF;


        -- Рабочие сессии удалены

        IF EXISTS (
            SELECT 1
            FROM task_session
            WHERE id = v_session_new
        ) THEN

            RAISE EXCEPTION
                'FAIL: user sessions remain';

        END IF;


        -- Расписание удалено

        IF EXISTS (
            SELECT 1
            FROM schedule_item
            WHERE id IN (
                v_schedule_independent_2,
                v_schedule_new
            )
        ) THEN

            RAISE EXCEPTION
                'FAIL: user schedule remains';

        END IF;


        -- Метаданные файлов удалены

        IF EXISTS (
            SELECT 1
            FROM file_attachment
            WHERE user_id = v_user_a
        ) THEN

            RAISE EXCEPTION
                'FAIL: user attachments remain';

        END IF;


        v_passed := v_passed + 1;

        RAISE NOTICE
            'PASS 7: complete user deletion';


        -- ========================================
        -- ТЕСТ 8. ДАННЫЕ ДРУГОГО ПОЛЬЗОВАТЕЛЯ
        -- ========================================

        -- Сам пользователь сохранился

        IF NOT EXISTS (
            SELECT 1
            FROM app_user
            WHERE id = v_user_b
        ) THEN

            RAISE EXCEPTION
                'FAIL: another user was deleted';

        END IF;


        -- Категория сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM category
            WHERE id = v_category_b
              AND user_id = v_user_b
        ) THEN

            RAISE EXCEPTION
                'FAIL: another user category was deleted';

        END IF;


        -- Цель сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM goal
            WHERE id = v_goal_b
              AND user_id = v_user_b
        ) THEN

            RAISE EXCEPTION
                'FAIL: another user goal was deleted';

        END IF;


        -- Задача сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM task
            WHERE id = v_task_b
              AND user_id = v_user_b
        ) THEN

            RAISE EXCEPTION
                'FAIL: another user task was deleted';

        END IF;


        -- Сессия сохранилась

        IF NOT EXISTS (
            SELECT 1
            FROM task_session
            WHERE id = v_session_b
              AND task_id = v_task_b
        ) THEN

            RAISE EXCEPTION
                'FAIL: another user session was deleted';

        END IF;


        -- Расписание сохранилось

        IF NOT EXISTS (
            SELECT 1
            FROM schedule_item
            WHERE id = v_schedule_b
              AND task_id = v_task_b
        ) THEN

            RAISE EXCEPTION
                'FAIL: another user schedule was deleted';

        END IF;


        -- Файл сохранился

        IF NOT EXISTS (
            SELECT 1
            FROM file_attachment
            WHERE id = v_file_b
              AND user_id = v_user_b
        ) THEN

            RAISE EXCEPTION
                'FAIL: another user attachment was deleted';

        END IF;


        v_passed := v_passed + 1;

        RAISE NOTICE
            'PASS 8: other user data preserved';


        -- ========================================
        -- ИТОГ ТЕСТИРОВАНИЯ
        -- ========================================

        IF v_passed <> 8 THEN

            RAISE EXCEPTION
                'FAIL: expected 8 tests, passed %',
                v_passed;

        END IF;


        -- Специальное исключение для отката
        -- всех тестовых изменений.

        RAISE EXCEPTION
            USING
                ERRCODE = 'ZT001',
                MESSAGE = 'ROLLBACK_TEST_DATA';


    EXCEPTION

        WHEN SQLSTATE 'ZT001' THEN

            RAISE NOTICE
                'Test data rolled back successfully';

            RAISE NOTICE
                'ALL % DELETION TESTS PASSED',
                v_passed;

    END;

END;

$test$;