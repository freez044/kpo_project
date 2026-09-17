
-- ================================================
-- 002_test_constraints.sql
-- Автоматическая проверка ограничений БД
-- ================================================
--
-- 23505 = unique_violation
-- 23503 = foreign_key_violation
-- 23514 = check_violation
--
-- Тестовые данные автоматически откатываются.
-- ================================================

DO $tests$

DECLARE
    v_user_a BIGINT;
    v_user_b BIGINT;

    v_category_a BIGINT;
    v_category_b BIGINT;

    v_goal_a BIGINT;
    v_goal_b BIGINT;

    v_task_a BIGINT;

    v_email_a TEXT;
    v_email_b TEXT;

    v_test RECORD;
    v_actual_state TEXT;

    v_passed INTEGER := 0;

BEGIN

    -- Вложенный блок создаёт область,
    -- изменения которой можно откатить
    -- при помощи обработчика исключений.

    BEGIN

        -- ========================================
        -- 1. ПОДГОТОВКА ТЕСТОВЫХ ДАННЫХ
        -- ========================================

        -- Уникальные email для каждого запуска

        v_email_a := format(
            'kpo-constraint-%s-a@example.invalid',
            txid_current()
        );

        v_email_b := format(
            'kpo-constraint-%s-b@example.invalid',
            txid_current()
        );


        -- Пользователь A

        INSERT INTO app_user (
            first_name,
            last_name,
            email,
            password_hash
        )
        VALUES (
            'Constraint',
            'UserA',
            v_email_a,
            'TEST_ONLY'
        )
        RETURNING id INTO v_user_a;


        -- Пользователь B

        INSERT INTO app_user (
            first_name,
            last_name,
            email,
            password_hash
        )
        VALUES (
            'Constraint',
            'UserB',
            v_email_b,
            'TEST_ONLY'
        )
        RETURNING id INTO v_user_b;


        -- Категория пользователя A

        INSERT INTO category (
            user_id,
            name
        )
        VALUES (
            v_user_a,
            'TestCategoryA'
        )
        RETURNING id INTO v_category_a;


        -- Категория пользователя B

        INSERT INTO category (
            user_id,
            name
        )
        VALUES (
            v_user_b,
            'TestCategoryB'
        )
        RETURNING id INTO v_category_b;


        -- Цель пользователя A

        INSERT INTO goal (
            user_id,
            category_id,
            title
        )
        VALUES (
            v_user_a,
            v_category_a,
            'TestGoalA'
        )
        RETURNING id INTO v_goal_a;


        -- Цель пользователя B

        INSERT INTO goal (
            user_id,
            category_id,
            title
        )
        VALUES (
            v_user_b,
            v_category_b,
            'TestGoalB'
        )
        RETURNING id INTO v_goal_b;


        -- Задача пользователя A

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
            'TestTaskA'
        )
        RETURNING id INTO v_task_a;


        -- Активная сессия задачи A

        INSERT INTO task_session (
            task_id,
            started_at
        )
        VALUES (
            v_task_a,
            NOW()
        );


        -- ========================================
        -- 2. СПИСОК НЕГАТИВНЫХ ТЕСТОВ
        -- ========================================
        --
        -- Каждый тест содержит:
        -- название, SQL-команду, ожидаемый SQLSTATE.
        --
        -- Команды намеренно некорректны.
        -- PostgreSQL должен их отклонить.
        -- ========================================

        FOR v_test IN

            SELECT *
            FROM (
                VALUES

                -- 1. Дублирование email

                (
                    'Duplicate email',

                    format(
                        'INSERT INTO app_user (
                            first_name,
                            last_name,
                            email,
                            password_hash
                        )
                        VALUES (
                            %L, %L, %L, %L
                        )',
                        'Duplicate',
                        'User',
                        v_email_a,
                        'TEST_ONLY'
                    ),

                    '23505'
                ),


                -- 2. Дублирование категории

                (
                    'Duplicate category name',

                    format(
                        'INSERT INTO category (
                            user_id,
                            name
                        )
                        VALUES (%s, %L)',
                        v_user_a,
                        'TestCategoryA'
                    ),

                    '23505'
                ),


                -- 3. Несуществующий пользователь

                (
                    'Invalid user foreign key',

                    format(
                        'INSERT INTO task (
                            user_id,
                            title
                        )
                        VALUES (-1, %L)',
                        'InvalidUserTask'
                    ),

                    '23503'
                ),


                -- 4. Чужая цель

                (
                    'Task with another user goal',

                    format(
                        'INSERT INTO task (
                            user_id,
                            goal_id,
                            title
                        )
                        VALUES (%s, %s, %L)',
                        v_user_a,
                        v_goal_b,
                        'InvalidGoalTask'
                    ),

                    '23503'
                ),


                -- 5. Чужая категория

                (
                    'Task with another user category',

                    format(
                        'INSERT INTO task (
                            user_id,
                            category_id,
                            title
                        )
                        VALUES (%s, %s, %L)',
                        v_user_a,
                        v_category_b,
                        'InvalidCategoryTask'
                    ),

                    '23503'
                ),


                -- 6. Чужая категория у цели

                (
                    'Goal with another user category',

                    format(
                        'INSERT INTO goal (
                            user_id,
                            category_id,
                            title
                        )
                        VALUES (%s, %s, %L)',
                        v_user_a,
                        v_category_b,
                        'InvalidCategoryGoal'
                    ),

                    '23503'
                ),


                -- 7. Недопустимый статус задачи

                (
                    'Invalid task status',

                    format(
                        'INSERT INTO task (
                            user_id,
                            title,
                            status
                        )
                        VALUES (%s, %L, %L)',
                        v_user_a,
                        'InvalidStatusTask',
                        'UNKNOWN'
                    ),

                    '23514'
                ),


                -- 8. Недопустимый приоритет

                (
                    'Invalid task priority',

                    format(
                        'INSERT INTO task (
                            user_id,
                            title,
                            priority
                        )
                        VALUES (%s, %L, %L)',
                        v_user_a,
                        'InvalidPriorityTask',
                        'SUPER_HIGH'
                    ),

                    '23514'
                ),


                -- 9. Отрицательная длительность

                (
                    'Negative task duration',

                    format(
                        'INSERT INTO task (
                            user_id,
                            title,
                            estimated_duration_minutes
                        )
                        VALUES (%s, %L, -10)',
                        v_user_a,
                        'InvalidDurationTask'
                    ),

                    '23514'
                ),


                -- 10. DONE без completed_at

                (
                    'Completed task without completion time',

                    format(
                        'INSERT INTO task (
                            user_id,
                            title,
                            status
                        )
                        VALUES (%s, %L, %L)',
                        v_user_a,
                        'InvalidCompletedTask',
                        'DONE'
                    ),

                    '23514'
                ),


                -- 11. Две активные сессии задачи

                (
                    'Two active sessions',

                    format(
                        'INSERT INTO task_session (
                            task_id,
                            started_at
                        )
                        VALUES (%s, NOW())',
                        v_task_a
                    ),

                    '23505'
                ),


                -- 12. Некорректный интервал

                (
                    'Invalid schedule interval',

                    format(
                        'INSERT INTO schedule_item (
                            task_id,
                            start_at,
                            end_at
                        )
                        VALUES (
                            %s,
                            NOW(),
                            NOW() - INTERVAL ''1 hour''
                        )',
                        v_task_a
                    ),

                    '23514'
                ),


                -- 13. Файл без родителя

                (
                    'Attachment without parent',

                    format(
                        'INSERT INTO file_attachment (
                            user_id,
                            original_name,
                            storage_key,
                            mime_type,
                            size_bytes
                        )
                        VALUES (
                            %s,
                            %L,
                            %L,
                            %L,
                            100
                        )',
                        v_user_a,
                        'orphan.pdf',
                        'constraint-test/orphan.pdf',
                        'application/pdf'
                    ),

                    '23514'
                ),


                -- 14. Файл с двумя родителями

                (
                    'Attachment with two parents',

                    format(
                        'INSERT INTO file_attachment (
                            user_id,
                            task_id,
                            goal_id,
                            original_name,
                            storage_key,
                            mime_type,
                            size_bytes
                        )
                        VALUES (
                            %s, %s, %s,
                            %L, %L, %L, 100
                        )',
                        v_user_a,
                        v_task_a,
                        v_goal_a,
                        'two_parents.pdf',
                        'constraint-test/two_parents.pdf',
                        'application/pdf'
                    ),

                    '23514'
                ),


                -- 15. Файл чужого пользователя

                (
                    'Attachment with wrong owner',

                    format(
                        'INSERT INTO file_attachment (
                            user_id,
                            task_id,
                            original_name,
                            storage_key,
                            mime_type,
                            size_bytes
                        )
                        VALUES (
                            %s, %s, %L, %L, %L, 100
                        )',
                        v_user_b,
                        v_task_a,
                        'wrong_owner.pdf',
                        'constraint-test/wrong_owner.pdf',
                        'application/pdf'
                    ),

                    '23503'
                ),


                -- 16. Отрицательный размер файла

                (
                    'Negative attachment size',

                    format(
                        'INSERT INTO file_attachment (
                            user_id,
                            task_id,
                            original_name,
                            storage_key,
                            mime_type,
                            size_bytes
                        )
                        VALUES (
                            %s, %s, %L, %L, %L, -100
                        )',
                        v_user_a,
                        v_task_a,
                        'negative.pdf',
                        'constraint-test/negative.pdf',
                        'application/pdf'
                    ),

                    '23514'
                )

            ) AS tests (
                test_name,
                sql_command,
                expected_sqlstate
            )

        LOOP

            -- Сбрасываем результат предыдущего теста

            v_actual_state := NULL;

            -- Выполняем некорректный запрос.
            -- Ожидаем ошибку PostgreSQL.

            BEGIN

                EXECUTE v_test.sql_command;

            EXCEPTION
                WHEN OTHERS THEN

                    GET STACKED DIAGNOSTICS
                        v_actual_state = RETURNED_SQLSTATE;

            END;


            -- ====================================
            -- ПРОВЕРКА РЕЗУЛЬТАТА
            -- ====================================

            IF v_actual_state
                IS DISTINCT FROM v_test.expected_sqlstate
            THEN

                RAISE EXCEPTION
                    'FAIL: %, expected SQLSTATE %, got %',
                    v_test.test_name,
                    v_test.expected_sqlstate,
                    COALESCE(v_actual_state, 'NO ERROR');

            END IF;


            v_passed := v_passed + 1;

            RAISE NOTICE
                'PASS: %',
                v_test.test_name;

        END LOOP;


        -- ========================================
        -- 3. ИТОГ
        -- ========================================

        RAISE NOTICE
            'ALL % CONSTRAINT TESTS PASSED',
            v_passed;


        -- Вызываем специальное исключение,
        -- чтобы откатить все тестовые данные.

        RAISE EXCEPTION
            USING
                ERRCODE = 'ZT001',
                MESSAGE = 'ROLLBACK_TEST_DATA';


    -- Обработчик откатывает все изменения
    -- внутри вложенного блока.

    EXCEPTION

        WHEN SQLSTATE 'ZT001' THEN

            RAISE NOTICE
                'Test data rolled back successfully';

    END;

END;
$tests$;	