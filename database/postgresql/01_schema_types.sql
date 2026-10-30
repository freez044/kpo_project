-- Adaptive AI Planner — схема базы данных PostgreSQL (ТЗ v12).
-- 01. Схемы, расширения и перечисления.
--
-- Требуется PostgreSQL 15 или новее: внешние ключи используют
-- ON DELETE SET NULL (столбец), появившийся в версии 15.

-- Рабочие данные приложения.
CREATE SCHEMA planner;
COMMENT ON SCHEMA planner IS 'Данные пользователей Adaptive AI Planner';

-- Обезличенные представления для аналитики (06_roles_analytics.sql).
CREATE SCHEMA analytics;
COMMENT ON SCHEMA analytics IS 'Обезличенные представления для аналитики, только чтение';

-- citext — строки без учёта регистра: email и названия категорий.
CREATE EXTENSION IF NOT EXISTS citext;

-- Перечисления — коды из таблицы 1 ТЗ.
CREATE TYPE planner.task_status AS ENUM
    ('BACKLOG', 'PLANNED', 'IN_PROGRESS', 'IN_HOLD', 'DONE', 'CANCELLED');
CREATE TYPE planner.goal_status AS ENUM
    ('ACTIVE', 'IN_HOLD', 'COMPLETED', 'CANCELLED');
CREATE TYPE planner.task_priority AS ENUM
    ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE planner.task_source AS ENUM
    ('MANUAL', 'AI');                 -- создана вручную или по предложению ИИ
CREATE TYPE planner.lesson_source AS ENUM
    ('ORIOKS', 'FILE');               -- занятие из ОРИОКС или из файла расписания
CREATE TYPE planner.proposal_kind AS ENUM
    ('COMMAND', 'DECOMPOSE');         -- текстовый запрос (ФТ-36) или декомпозиция цели (ФТ-37)
CREATE TYPE planner.proposal_status AS ENUM
    ('PENDING', 'ACCEPTED', 'EDITED', 'REJECTED');
