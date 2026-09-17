
-- ================================================
-- ADAPTIVE AI TASK MANAGER
-- Initial Database Schema
-- PostgreSQL
-- ================================================
--
-- Скрипт предназначен для пустой базы task_manager.
-- Создаёт таблицы, ограничения и индексы.
-- Саму базу данных CREATE DATABASE не создаёт.
--
-- ================================================

BEGIN;


-- ================================================
-- 1. ПОЛЬЗОВАТЕЛИ
-- ================================================

CREATE TABLE app_user (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,

    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,

    timezone VARCHAR(64) NOT NULL DEFAULT 'UTC',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ================================================
-- 2. КАТЕГОРИИ
-- ================================================

CREATE TABLE category (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id BIGINT NOT NULL,

    name VARCHAR(100) NOT NULL,
    color VARCHAR(20),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Категория принадлежит пользователю
    CONSTRAINT fk_category_user
        FOREIGN KEY (user_id)
        REFERENCES app_user(id)
        ON DELETE CASCADE,

    -- У пользователя не может быть двух
    -- категорий с одинаковым названием
    CONSTRAINT uq_category_user_name
        UNIQUE (user_id, name),

    -- Обеспечивает составные внешние ключи
    CONSTRAINT uq_category_id_user
        UNIQUE (id, user_id)
);


-- ================================================
-- 3. ЦЕЛИ
-- ================================================

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

    -- При удалении пользователя
    -- удаляются его цели
    CONSTRAINT fk_goal_user
        FOREIGN KEY (user_id)
        REFERENCES app_user(id)
        ON DELETE CASCADE,

    -- При удалении категории цель сохраняется,
    -- но связь с категорией обнуляется
    CONSTRAINT fk_goal_category
        FOREIGN KEY (category_id, user_id)
        REFERENCES category(id, user_id)
        ON DELETE SET NULL (category_id),

    -- Для проверки принадлежности цели
    -- конкретному пользователю
    CONSTRAINT uq_goal_id_user
        UNIQUE (id, user_id),

    -- Допустимые статусы цели
    CONSTRAINT chk_goal_status
        CHECK (
            status IN (
                'ACTIVE',
                'IN_HOLD',
                'COMPLETED',
                'CANCELLED'
            )
        ),

    -- Оценочная длительность положительна
    CONSTRAINT chk_goal_duration
        CHECK (
            estimated_duration_minutes > 0
        )
);


-- ================================================
-- 4. ЗАДАЧИ
-- ================================================

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

    -- При удалении пользователя
    -- удаляются его задачи
    CONSTRAINT fk_task_user
        FOREIGN KEY (user_id)
        REFERENCES app_user(id)
        ON DELETE CASCADE,

    -- При удалении цели
    -- удаляются все связанные задачи
    CONSTRAINT fk_task_goal
        FOREIGN KEY (goal_id, user_id)
        REFERENCES goal(id, user_id)
        ON DELETE CASCADE,

    -- При удалении категории
    -- задачи сохраняются
    CONSTRAINT fk_task_category
        FOREIGN KEY (category_id, user_id)
        REFERENCES category(id, user_id)
        ON DELETE SET NULL (category_id),

    -- Для проверки принадлежности задачи
    -- конкретному пользователю
    CONSTRAINT uq_task_id_user
        UNIQUE (id, user_id),

    -- Допустимые статусы задачи
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

    -- Допустимые приоритеты задачи
    CONSTRAINT chk_task_priority
        CHECK (
            priority IN (
                'LOW',
                'MEDIUM',
                'HIGH',
                'URGENT'
            )
        ),

    -- Оценочная длительность положительна
    CONSTRAINT chk_task_duration
        CHECK (
            estimated_duration_minutes > 0
        ),

    -- Для выполненной задачи обязательно
    -- указывается время завершения.
    -- Для остальных статусов оно отсутствует.
    CONSTRAINT chk_task_completed
        CHECK (
            (status = 'DONE' AND completed_at IS NOT NULL)
            OR
            (status <> 'DONE' AND completed_at IS NULL)
        )
);


-- ================================================
-- 5. РАБОЧИЕ СЕССИИ
-- ================================================

CREATE TABLE task_session (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    task_id BIGINT NOT NULL,

    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,

    note TEXT,

    -- При удалении задачи
    -- удаляются её рабочие сессии
    CONSTRAINT fk_session_task
        FOREIGN KEY (task_id)
        REFERENCES task(id)
        ON DELETE CASCADE,

    -- Окончание сессии должно быть
    -- позже её начала
    CONSTRAINT chk_session_time
        CHECK (
            ended_at IS NULL
            OR ended_at > started_at
        )
);


-- ================================================
-- 6. ЭЛЕМЕНТЫ РАСПИСАНИЯ
-- ================================================

CREATE TABLE schedule_item (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    task_id BIGINT NOT NULL,

    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,

    -- При удалении задачи удаляются только
    -- связанные с ней запланированные интервалы.
    -- Остальное расписание сохраняется.
    CONSTRAINT fk_schedule_task
        FOREIGN KEY (task_id)
        REFERENCES task(id)
        ON DELETE CASCADE,

    -- Конец интервала позже начала
    CONSTRAINT chk_schedule_time
        CHECK (
            end_at > start_at
        )
);


-- ================================================
-- 7. ПРИКРЕПЛЁННЫЕ ФАЙЛЫ
-- ================================================

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

    -- При удалении пользователя
    -- удаляются метаданные его файлов
    CONSTRAINT fk_file_user
        FOREIGN KEY (user_id)
        REFERENCES app_user(id)
        ON DELETE CASCADE,

    -- При удалении задачи
    -- удаляются метаданные прикреплённых файлов
    CONSTRAINT fk_file_task
        FOREIGN KEY (task_id, user_id)
        REFERENCES task(id, user_id)
        ON DELETE CASCADE,

    -- При удалении цели
    -- удаляются метаданные прикреплённых файлов
    CONSTRAINT fk_file_goal
        FOREIGN KEY (goal_id, user_id)
        REFERENCES goal(id, user_id)
        ON DELETE CASCADE,

    -- Файл должен принадлежать ровно одному
    -- объекту: задаче ИЛИ цели
    CONSTRAINT chk_file_parent
        CHECK (
            (task_id IS NOT NULL AND goal_id IS NULL)
            OR
            (task_id IS NULL AND goal_id IS NOT NULL)
        ),

    -- Размер файла не может быть отрицательным
    CONSTRAINT chk_file_size
        CHECK (
            size_bytes >= 0
        )
);


-- ================================================
-- 8. ИНДЕКСЫ
-- ================================================

-- Быстрый поиск целей пользователя
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


-- Поиск рабочих сессий задачи
CREATE INDEX idx_session_task_started
ON task_session(task_id, started_at);


-- У задачи может быть не более
-- одной активной рабочей сессии
CREATE UNIQUE INDEX idx_one_active_session
ON task_session(task_id)
WHERE ended_at IS NULL;


-- Поиск запланированных интервалов задачи
CREATE INDEX idx_schedule_task_start
ON schedule_item(task_id, start_at);


-- Поиск файлов задачи
CREATE INDEX idx_file_task_user
ON file_attachment(task_id, user_id);


-- Поиск файлов цели
CREATE INDEX idx_file_goal_user
ON file_attachment(goal_id, user_id);


-- Поиск всех файлов пользователя
CREATE INDEX idx_file_user
ON file_attachment(user_id);


-- ================================================
-- ЗАВЕРШЕНИЕ ТРАНЗАКЦИИ
-- ================================================

COMMIT;