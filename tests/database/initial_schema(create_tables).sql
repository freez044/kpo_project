
BEGIN;

-- ==========================================
-- 1. ПОЛЬЗОВАТЕЛИ
-- ==========================================

CREATE TABLE app_user (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,

    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ==========================================
-- 2. КАТЕГОРИИ
-- ==========================================

CREATE TABLE category (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL,

    name VARCHAR(100) NOT NULL,
    color VARCHAR(20),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_category_user
        FOREIGN KEY (user_id)
        REFERENCES app_user(id)
        ON DELETE CASCADE,

    -- Название уникально для одного пользователя
    CONSTRAINT uq_category_user_name
        UNIQUE (user_id, name),

    -- Для проверки принадлежности категории
    CONSTRAINT uq_category_id_user
        UNIQUE (id, user_id)
);


-- ==========================================
-- 3. ЦЕЛИ
-- ==========================================

CREATE TABLE goal (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL,
    category_id BIGINT,

    title VARCHAR(255) NOT NULL,
    description TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',

    deadline TIMESTAMPTZ,
    estimated_duration_minutes INTEGER,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_goal_user
        FOREIGN KEY (user_id)
        REFERENCES app_user(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_goal_category
        FOREIGN KEY (category_id, user_id)
        REFERENCES category(id, user_id)
        ON DELETE SET NULL (category_id),

    CONSTRAINT uq_goal_id_user
        UNIQUE (id, user_id),

    CONSTRAINT chk_goal_status
        CHECK (
            status IN (
                'ACTIVE',
                'IN_HOLD',
                'COMPLETED',
                'CANCELLED'
            )
        ),

    CONSTRAINT chk_goal_duration
        CHECK (
            estimated_duration_minutes > 0
        )
);


-- ==========================================
-- 4. ЗАДАЧИ
-- ==========================================

CREATE TABLE task (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL,
    goal_id BIGINT,
    category_id BIGINT,

    title VARCHAR(255) NOT NULL,
    description TEXT,

    status VARCHAR(20) NOT NULL DEFAULT 'BACKLOG',
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',

    estimated_duration_minutes INTEGER,

    deadline TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_task_user
        FOREIGN KEY (user_id)
        REFERENCES app_user(id)
        ON DELETE CASCADE,

    -- Удаление цели удаляет связанные задачи
    CONSTRAINT fk_task_goal
        FOREIGN KEY (goal_id, user_id)
        REFERENCES goal(id, user_id)
        ON DELETE CASCADE,

    -- Удаление категории сохраняет задачи
    CONSTRAINT fk_task_category
        FOREIGN KEY (category_id, user_id)
        REFERENCES category(id, user_id)
        ON DELETE SET NULL (category_id),

    CONSTRAINT uq_task_id_user
        UNIQUE (id, user_id),

    CONSTRAINT chk_task_status
        CHECK (
            status IN (
                'BACKLOG',
                'PLANNED',
                'IN_PROGRESS',
                'IN_HOLD',
                'DONE',
                'CANCELLED'
            )
        ),

    CONSTRAINT chk_task_priority
        CHECK (
            priority IN (
                'LOW',
                'MEDIUM',
                'HIGH',
                'URGENT'
            )
        ),

    CONSTRAINT chk_task_duration
        CHECK (
            estimated_duration_minutes > 0
        ),

    CONSTRAINT chk_task_completed
        CHECK (
            (status = 'DONE' AND completed_at IS NOT NULL)
            OR
            (status <> 'DONE' AND completed_at IS NULL)
        )
);


-- ==========================================
-- 5. РАБОЧИЕ СЕССИИ
-- ==========================================

CREATE TABLE task_session (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    task_id BIGINT NOT NULL,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,

    note TEXT,

    CONSTRAINT fk_session_task
        FOREIGN KEY (task_id)
        REFERENCES task(id)
        ON DELETE CASCADE,

    CONSTRAINT chk_session_time
        CHECK (
            ended_at IS NULL
            OR ended_at > started_at
        )
);


-- ==========================================
-- 6. ЭЛЕМЕНТЫ РАСПИСАНИЯ
-- ==========================================

CREATE TABLE schedule_item (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    task_id BIGINT NOT NULL,

    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,

    CONSTRAINT fk_schedule_task
        FOREIGN KEY (task_id)
        REFERENCES task(id)
        ON DELETE CASCADE,

    CONSTRAINT chk_schedule_time
        CHECK (end_at > start_at)
);


-- ==========================================
-- 7. ПРИКРЕПЛЁННЫЕ ФАЙЛЫ
-- ==========================================

CREATE TABLE file_attachment (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL,

    task_id BIGINT,
    goal_id BIGINT,

    original_name TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,

    mime_type VARCHAR(255) NOT NULL,
    size_bytes BIGINT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_file_user
        FOREIGN KEY (user_id)
        REFERENCES app_user(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_file_task
        FOREIGN KEY (task_id, user_id)
        REFERENCES task(id, user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_file_goal
        FOREIGN KEY (goal_id, user_id)
        REFERENCES goal(id, user_id)
        ON DELETE CASCADE,

    -- Файл прикреплён ровно к одному объекту
    CONSTRAINT chk_file_parent
        CHECK (
            (task_id IS NOT NULL AND goal_id IS NULL)
            OR
            (task_id IS NULL AND goal_id IS NOT NULL)
        ),

    CONSTRAINT chk_file_size
        CHECK (size_bytes >= 0)
);


-- ==========================================
-- 8. ИНДЕКСЫ
-- ==========================================

-- Поиск целей пользователя
CREATE INDEX idx_goal_user
ON goal(user_id);

-- Поиск целей по категории
CREATE INDEX idx_goal_category_user
ON goal(category_id, user_id);

-- Поиск задач пользователя по статусу
CREATE INDEX idx_task_user_status
ON task(user_id, status);

-- Поиск задач по цели
CREATE INDEX idx_task_goal_user
ON task(goal_id, user_id);

-- Поиск задач по категории
CREATE INDEX idx_task_category_user
ON task(category_id, user_id);

-- История рабочих сессий
CREATE INDEX idx_session_task_started
ON task_session(task_id, started_at);

-- У одной задачи максимум одна активная сессия
CREATE UNIQUE INDEX idx_one_active_session
ON task_session(task_id)
WHERE ended_at IS NULL;

-- Поиск запланированных блоков задачи
CREATE INDEX idx_schedule_task_start
ON schedule_item(task_id, start_at);

-- Поиск прикреплённых файлов
CREATE INDEX idx_file_task_user
ON file_attachment(task_id, user_id);

CREATE INDEX idx_file_goal_user
ON file_attachment(goal_id, user_id);

CREATE INDEX idx_file_user
ON file_attachment(user_id);


COMMIT;