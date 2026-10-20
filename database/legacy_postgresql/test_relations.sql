
-- ================================================
-- 001_test_relations.sql
-- Проверка связей между таблицами
-- ================================================

DO $test$
DECLARE
    v_count INTEGER;

BEGIN

    -- ============================================
    -- 1. ПРОВЕРКА ПОЛЬЗОВАТЕЛЕЙ
    -- ============================================

    SELECT COUNT(*)
    INTO v_count
    FROM app_user
    WHERE email IN (
        'kpo-demo-a@example.invalid',
        'kpo-demo-b@example.invalid'
    );

    IF v_count <> 2 THEN
        RAISE EXCEPTION
            'FAIL: demo users not found';
    END IF;

    RAISE NOTICE 'PASS: users';


    -- ============================================
    -- 2. USER -> CATEGORY
    -- ============================================

    SELECT COUNT(*)
    INTO v_count
    FROM category c
    JOIN app_user u
        ON c.user_id = u.id
    WHERE
        (
            u.email = 'kpo-demo-a@example.invalid'
            AND c.name = '[KPO DEMO] Учёба'
        )
        OR
        (
            u.email = 'kpo-demo-b@example.invalid'
            AND c.name = '[KPO DEMO] Работа'
        );

    IF v_count <> 2 THEN
        RAISE EXCEPTION
            'FAIL: user-category relation';
    END IF;

    RAISE NOTICE 'PASS: user-category';


    -- ============================================
    -- 3. USER -> GOAL -> CATEGORY
    -- ============================================

    SELECT COUNT(*)
    INTO v_count
    FROM goal g

    JOIN app_user u
        ON g.user_id = u.id

    JOIN category c
        ON g.category_id = c.id
       AND c.user_id = u.id

    WHERE u.email = 'kpo-demo-a@example.invalid'
      AND g.title = '[KPO DEMO] Изучить PostgreSQL'
      AND c.name = '[KPO DEMO] Учёба';

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FAIL: goal-category relation';
    END IF;

    RAISE NOTICE 'PASS: goal-category';


    -- ============================================
    -- 4. USER -> GOAL -> TASK
    -- ============================================

    SELECT COUNT(*)
    INTO v_count
    FROM task t

    JOIN goal g
        ON t.goal_id = g.id
       AND t.user_id = g.user_id

    JOIN app_user u
        ON t.user_id = u.id

    WHERE u.email = 'kpo-demo-a@example.invalid'
      AND g.title = '[KPO DEMO] Изучить PostgreSQL'
      AND t.title = '[KPO DEMO] Изучить JOIN';

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FAIL: goal-task relation';
    END IF;

    RAISE NOTICE 'PASS: goal-task';


    -- ============================================
    -- 5. САМОСТОЯТЕЛЬНАЯ ЗАДАЧА
    -- ============================================

    SELECT COUNT(*)
    INTO v_count
    FROM task t
    JOIN app_user u
        ON t.user_id = u.id

    WHERE u.email = 'kpo-demo-a@example.invalid'
      AND t.title = '[KPO DEMO] Купить продукты'
      AND t.goal_id IS NULL;

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FAIL: independent task';
    END IF;

    RAISE NOTICE 'PASS: independent task';


    -- ============================================
    -- 6. TASK -> TASK_SESSION
    -- ============================================

    SELECT COUNT(*)
    INTO v_count
    FROM task_session s

    JOIN task t
        ON s.task_id = t.id

    JOIN app_user u
        ON t.user_id = u.id

    WHERE u.email = 'kpo-demo-a@example.invalid'
      AND t.title = '[KPO DEMO] Изучить JOIN';

    IF v_count <> 2 THEN
        RAISE EXCEPTION
            'FAIL: task sessions';
    END IF;

    RAISE NOTICE 'PASS: task sessions';


    -- ============================================
    -- 7. TASK -> SCHEDULE_ITEM
    -- ============================================

    SELECT COUNT(*)
    INTO v_count
    FROM schedule_item s

    JOIN task t
        ON s.task_id = t.id

    JOIN app_user u
        ON t.user_id = u.id

    WHERE u.email = 'kpo-demo-a@example.invalid'
      AND t.title = '[KPO DEMO] Изучить JOIN';

    IF v_count <> 2 THEN
        RAISE EXCEPTION
            'FAIL: task schedule';
    END IF;

    RAISE NOTICE 'PASS: task schedule';


    -- ============================================
    -- 8. USER -> TASK -> FILE
    -- ============================================

    SELECT COUNT(*)
    INTO v_count
    FROM file_attachment f

    JOIN task t
        ON f.task_id = t.id
       AND f.user_id = t.user_id

    JOIN app_user u
        ON f.user_id = u.id

    WHERE u.email = 'kpo-demo-a@example.invalid'
      AND f.storage_key =
          'seed/kpo-demo/join_notes.pdf';

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FAIL: task attachment';
    END IF;

    RAISE NOTICE 'PASS: task attachment';


    -- ============================================
    -- 9. USER -> GOAL -> FILE
    -- ============================================

    SELECT COUNT(*)
    INTO v_count
    FROM file_attachment f

    JOIN goal g
        ON f.goal_id = g.id
       AND f.user_id = g.user_id

    JOIN app_user u
        ON f.user_id = u.id

    WHERE u.email = 'kpo-demo-a@example.invalid'
      AND f.storage_key =
          'seed/kpo-demo/postgresql_roadmap.pdf';

    IF v_count <> 1 THEN
        RAISE EXCEPTION
            'FAIL: goal attachment';
    END IF;

    RAISE NOTICE 'PASS: goal attachment';


    -- ============================================
    -- 10. ПРОВЕРКА ВЛАДЕЛЬЦЕВ
    -- ============================================

    IF EXISTS (
        SELECT 1
        FROM task t
        JOIN goal g ON t.goal_id = g.id
        WHERE t.user_id <> g.user_id
    ) THEN
        RAISE EXCEPTION
            'FAIL: task belongs to another user goal';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM task t
        JOIN category c ON t.category_id = c.id
        WHERE t.user_id <> c.user_id
    ) THEN
        RAISE EXCEPTION
            'FAIL: task belongs to another user category';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM goal g
        JOIN category c ON g.category_id = c.id
        WHERE g.user_id <> c.user_id
    ) THEN
        RAISE EXCEPTION
            'FAIL: goal belongs to another user category';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM file_attachment f
        JOIN task t ON f.task_id = t.id
        WHERE f.user_id <> t.user_id
    ) THEN
        RAISE EXCEPTION
            'FAIL: file belongs to another user task';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM file_attachment f
        JOIN goal g ON f.goal_id = g.id
        WHERE f.user_id <> g.user_id
    ) THEN
        RAISE EXCEPTION
            'FAIL: file belongs to another user goal';
    END IF;

    RAISE NOTICE 'PASS: ownership checks';

    RAISE NOTICE
        'ALL RELATION TESTS PASSED';

END;
$test$;


-- ================================================
-- ПРОСМОТР СВЯЗАННЫХ ДАННЫХ
-- ================================================


-- Просмотр связанных данных
SELECT
    u.email AS user_email,
    t.title AS task_title,
    g.title AS goal_title,
    c.name AS category_name,
    t.status,
    t.priority
FROM task t
JOIN app_user u
    ON t.user_id = u.id
LEFT JOIN goal g
    ON t.goal_id = g.id
LEFT JOIN category c
    ON t.category_id = c.id

WHERE u.email IN (
    'kpo-demo-a@example.invalid',
    'kpo-demo-b@example.invalid'
)

ORDER BY u.email, t.id;