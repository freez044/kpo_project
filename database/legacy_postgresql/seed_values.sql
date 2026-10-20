
-- ================================================
-- 002_seed_values.sql
-- Наполнение БД тестовыми данными
-- ================================================

DO $seed$
DECLARE
    v_user_a BIGINT;
    v_user_b BIGINT;

    v_category_a BIGINT;
    v_category_b BIGINT;

    v_goal_a BIGINT;
    v_goal_b BIGINT;

    v_task_a BIGINT;
    v_task_independent BIGINT;
    v_task_b BIGINT;

BEGIN

    -- ============================================
    -- 1. ПОЛЬЗОВАТЕЛИ
    -- ============================================

    INSERT INTO app_user (
        first_name,
        last_name,
        email,
        password_hash
    )
    VALUES (
        'Денис',
        'Тестовый',
        'kpo-demo-a@example.invalid',
        'TEST_ONLY_NOT_A_REAL_HASH'
    )
    ON CONFLICT (email) DO NOTHING;

    INSERT INTO app_user (
        first_name,
        last_name,
        email,
        password_hash
    )
    VALUES (
        'Алексей',
        'Тестовый',
        'kpo-demo-b@example.invalid',
        'TEST_ONLY_NOT_A_REAL_HASH'
    )
    ON CONFLICT (email) DO NOTHING;

    SELECT id INTO STRICT v_user_a
    FROM app_user
    WHERE email = 'kpo-demo-a@example.invalid';

    SELECT id INTO STRICT v_user_b
    FROM app_user
    WHERE email = 'kpo-demo-b@example.invalid';


    -- ============================================
    -- 2. КАТЕГОРИИ
    -- ============================================

    INSERT INTO category (
        user_id,
        name,
        color
    )
    VALUES (
        v_user_a,
        '[KPO DEMO] Учёба',
        '#4285F4'
    )
    ON CONFLICT (user_id, name) DO NOTHING;

    INSERT INTO category (
        user_id,
        name,
        color
    )
    VALUES (
        v_user_b,
        '[KPO DEMO] Работа',
        '#16A34A'
    )
    ON CONFLICT (user_id, name) DO NOTHING;

    SELECT id INTO STRICT v_category_a
    FROM category
    WHERE user_id = v_user_a
      AND name = '[KPO DEMO] Учёба';

    SELECT id INTO STRICT v_category_b
    FROM category
    WHERE user_id = v_user_b
      AND name = '[KPO DEMO] Работа';


    -- ============================================
    -- 3. ЦЕЛИ
    -- ============================================

    INSERT INTO goal (
        user_id,
        category_id,
        title,
        description,
        status,
        deadline,
        estimated_duration_minutes
    )
    SELECT
        v_user_a,
        v_category_a,
        '[KPO DEMO] Изучить PostgreSQL',
        'Разобраться с SQL и проектированием БД',
        'ACTIVE',
        '2030-01-31 23:59:00+00',
        240
    WHERE NOT EXISTS (
        SELECT 1
        FROM goal
        WHERE user_id = v_user_a
          AND title = '[KPO DEMO] Изучить PostgreSQL'
    );

    INSERT INTO goal (
        user_id,
        category_id,
        title,
        description,
        status,
        deadline
    )
    SELECT
        v_user_b,
        v_category_b,
        '[KPO DEMO] Рабочий проект',
        'Тестовая цель второго пользователя',
        'ACTIVE',
        '2030-02-28 23:59:00+00'
    WHERE NOT EXISTS (
        SELECT 1
        FROM goal
        WHERE user_id = v_user_b
          AND title = '[KPO DEMO] Рабочий проект'
    );

    SELECT id INTO STRICT v_goal_a
    FROM goal
    WHERE user_id = v_user_a
      AND title = '[KPO DEMO] Изучить PostgreSQL';

    SELECT id INTO STRICT v_goal_b
    FROM goal
    WHERE user_id = v_user_b
      AND title = '[KPO DEMO] Рабочий проект';


    -- ============================================
    -- 4. ЗАДАЧИ
    -- ============================================

    -- Задача первого пользователя, связанная с целью

    INSERT INTO task (
        user_id,
        goal_id,
        category_id,
        title,
        description,
        status,
        priority,
        estimated_duration_minutes
    )
    SELECT
        v_user_a,
        v_goal_a,
        v_category_a,
        '[KPO DEMO] Изучить JOIN',
        'Изучить INNER JOIN и LEFT JOIN',
        'IN_PROGRESS',
        'HIGH',
        90
    WHERE NOT EXISTS (
        SELECT 1
        FROM task
        WHERE user_id = v_user_a
          AND title = '[KPO DEMO] Изучить JOIN'
    );

    -- Самостоятельная задача без цели

    INSERT INTO task (
        user_id,
        title,
        description,
        status,
        priority,
        estimated_duration_minutes
    )
    SELECT
        v_user_a,
        '[KPO DEMO] Купить продукты',
        'Самостоятельная задача без цели',
        'PLANNED',
        'LOW',
        60
    WHERE NOT EXISTS (
        SELECT 1
        FROM task
        WHERE user_id = v_user_a
          AND title = '[KPO DEMO] Купить продукты'
    );

    -- Задача второго пользователя

    INSERT INTO task (
        user_id,
        goal_id,
        category_id,
        title,
        status,
        priority,
        estimated_duration_minutes
    )
    SELECT
        v_user_b,
        v_goal_b,
        v_category_b,
        '[KPO DEMO] Подготовить отчёт',
        'BACKLOG',
        'MEDIUM',
        120
    WHERE NOT EXISTS (
        SELECT 1
        FROM task
        WHERE user_id = v_user_b
          AND title = '[KPO DEMO] Подготовить отчёт'
    );

    SELECT id INTO STRICT v_task_a
    FROM task
    WHERE user_id = v_user_a
      AND title = '[KPO DEMO] Изучить JOIN';

    SELECT id INTO STRICT v_task_independent
    FROM task
    WHERE user_id = v_user_a
      AND title = '[KPO DEMO] Купить продукты';

    SELECT id INTO STRICT v_task_b
    FROM task
    WHERE user_id = v_user_b
      AND title = '[KPO DEMO] Подготовить отчёт';


    -- ============================================
    -- 5. РАБОЧИЕ СЕССИИ
    -- ============================================

    -- Завершённая сессия

    INSERT INTO task_session (
        task_id,
        started_at,
        ended_at,
        note
    )
    SELECT
        v_task_a,
        '2026-09-15 09:00:00+00',
        '2026-09-15 10:00:00+00',
        'Разобрал основы JOIN'
    WHERE NOT EXISTS (
        SELECT 1
        FROM task_session
        WHERE task_id = v_task_a
          AND started_at =
              '2026-09-15 09:00:00+00'
    );

    -- Активная сессия

    INSERT INTO task_session (
        task_id,
        started_at,
        note
    )
    SELECT
        v_task_a,
        NOW(),
        'Активная тестовая сессия'
    WHERE NOT EXISTS (
        SELECT 1
        FROM task_session
        WHERE task_id = v_task_a
          AND ended_at IS NULL
    );


    -- ============================================
    -- 6. РАСПИСАНИЕ
    -- ============================================

    -- Первый интервал задачи

    INSERT INTO schedule_item (
        task_id,
        start_at,
        end_at
    )
    SELECT
        v_task_a,
        '2030-01-15 10:00:00+00',
        '2030-01-15 11:30:00+00'
    WHERE NOT EXISTS (
        SELECT 1
        FROM schedule_item
        WHERE task_id = v_task_a
          AND start_at =
              '2030-01-15 10:00:00+00'
    );

    -- Второй интервал той же задачи

    INSERT INTO schedule_item (
        task_id,
        start_at,
        end_at
    )
    SELECT
        v_task_a,
        '2030-01-15 16:00:00+00',
        '2030-01-15 17:00:00+00'
    WHERE NOT EXISTS (
        SELECT 1
        FROM schedule_item
        WHERE task_id = v_task_a
          AND start_at =
              '2030-01-15 16:00:00+00'
    );

    -- Интервал самостоятельной задачи

    INSERT INTO schedule_item (
        task_id,
        start_at,
        end_at
    )
    SELECT
        v_task_independent,
        '2030-01-15 12:00:00+00',
        '2030-01-15 13:00:00+00'
    WHERE NOT EXISTS (
        SELECT 1
        FROM schedule_item
        WHERE task_id = v_task_independent
          AND start_at =
              '2030-01-15 12:00:00+00'
    );


    -- ============================================
    -- 7. ПРИКРЕПЛЁННЫЕ ФАЙЛЫ
    -- ============================================

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
        v_task_a,
        'join_notes.pdf',
        'seed/kpo-demo/join_notes.pdf',
        'application/pdf',
        102400
    )
    ON CONFLICT (storage_key) DO NOTHING;

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
        v_goal_a,
        'postgresql_roadmap.pdf',
        'seed/kpo-demo/postgresql_roadmap.pdf',
        'application/pdf',
        204800
    )
    ON CONFLICT (storage_key) DO NOTHING;


    RAISE NOTICE 'PASS: demo data created';

END;
$seed$;