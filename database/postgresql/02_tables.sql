-- 02. Таблицы и ограничения.
--
-- Правила, общие для всех таблиц:
--  * первичный ключ — uuid, генерируется базой;
--  * у каждой записи есть владелец user_id; удаление пользователя удаляет всё (ФТ-05);
--  * ссылки между записями одного пользователя — составные внешние ключи
--    (x_id, user_id), поэтому сослаться на чужую запись невозможно даже при ошибке в коде;
--  * время — timestamptz (хранится в UTC);
--  * ограничения названы по шаблону <таблица>_<смысл>: имя попадает в текст ошибки.

-- ─── Пользователи и сеансы ──────────────────────────────────────────────────

CREATE TABLE planner.users (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email              citext      NOT NULL,
    password_hash      text        NOT NULL,
    first_name         varchar(100) NOT NULL,
    last_name          varchar(100) NOT NULL,
    study_group        varchar(50),                       -- необязательна при регистрации
    timezone           varchar(64) NOT NULL DEFAULT 'Europe/Moscow',
    ai_history_enabled boolean     NOT NULL DEFAULT true,  -- ФТ-40
    failed_login_count integer     NOT NULL DEFAULT 0,
    locked_until       timestamptz,                        -- вход заблокирован до этого времени
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT users_email_key           UNIQUE (email),
    CONSTRAINT users_email_format        CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    CONSTRAINT users_password_is_argon2  CHECK (password_hash LIKE '$argon2id$%'),
    CONSTRAINT users_first_name_not_blank CHECK (btrim(first_name) <> ''),
    CONSTRAINT users_last_name_not_blank  CHECK (btrim(last_name) <> ''),
    CONSTRAINT users_study_group_not_blank CHECK (study_group IS NULL OR btrim(study_group) <> ''),
    CONSTRAINT users_failed_login_count_non_negative CHECK (failed_login_count >= 0)
);
COMMENT ON TABLE  planner.users IS 'Учётные записи (ФТ-01, ФТ-41)';
COMMENT ON COLUMN planner.users.password_hash IS
    'Хеш argon2id в стандартной строке $argon2id$v=19$m=…,t=…,p=…$соль$хеш; соль внутри строки';
COMMENT ON COLUMN planner.users.study_group IS
    'Учебная группа; при подключении ОРИОКС перезаписывается группой из профиля ОРИОКС';

CREATE TABLE planner.sessions (
    id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            uuid        NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    refresh_token_hash text        NOT NULL,              -- в базе только хеш токена
    user_agent         varchar(500),
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_used_at       timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz,                        -- выход или замена токена

    CONSTRAINT sessions_refresh_token_hash_key UNIQUE (refresh_token_hash),
    CONSTRAINT sessions_expires_after_created  CHECK (expires_at > created_at)
);
COMMENT ON TABLE planner.sessions IS 'Сеансы входа: одна запись на устройство (ФТ-41)';

CREATE TABLE planner.orioks_connections (
    user_id          uuid        PRIMARY KEY REFERENCES planner.users (id) ON DELETE CASCADE,
    token_encrypted  bytea       NOT NULL,                 -- AES-GCM, ключ в переменной окружения сервера
    group_id         integer     NOT NULL,                 -- числовой id группы в API ОРИОКС
    semester_start   date        NOT NULL,
    connected_at     timestamptz NOT NULL DEFAULT now(),
    last_sync_at     timestamptz,
    last_sync_error  varchar(500),

    CONSTRAINT orioks_connections_group_id_positive CHECK (group_id > 0)
);
COMMENT ON TABLE planner.orioks_connections IS
    'Подключение ОРИОКС (ФТ-43). Пароль ОРИОКС не хранится; название группы — в users.study_group';

-- ─── Категории, цели, задачи ────────────────────────────────────────────────

CREATE TABLE planner.categories (
    id       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid         NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    name     citext       NOT NULL,
    color    char(7),

    CONSTRAINT categories_id_user_key     UNIQUE (id, user_id),     -- для составных ключей
    CONSTRAINT categories_user_name_key   UNIQUE (user_id, name),   -- ФТ-14, без учёта регистра
    CONSTRAINT categories_name_not_blank  CHECK (btrim(name) <> '' AND length(name) <= 100),
    CONSTRAINT categories_color_format    CHECK (color IS NULL OR color ~ '^#[0-9A-Fa-f]{6}$')
);
COMMENT ON TABLE planner.categories IS 'Категории целей и задач (ФТ-14–ФТ-16)';

CREATE TABLE planner.goals (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid         NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    title            varchar(200) NOT NULL,
    description      text         NOT NULL DEFAULT '',
    status           planner.goal_status NOT NULL DEFAULT 'ACTIVE',
    deadline         timestamptz,
    category_id      uuid,
    duration_minutes integer,                               -- необязательна (ФТ-10)
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT goals_id_user_key        UNIQUE (id, user_id),
    CONSTRAINT goals_category_fk        FOREIGN KEY (category_id, user_id)
        REFERENCES planner.categories (id, user_id) ON DELETE SET NULL (category_id),   -- ФТ-16
    CONSTRAINT goals_title_not_blank    CHECK (btrim(title) <> ''),
    CONSTRAINT goals_duration_positive  CHECK (duration_minutes > 0)
);
COMMENT ON TABLE planner.goals IS 'Цели (ФТ-10–ФТ-13)';

CREATE TABLE planner.tasks (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid         NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    title            varchar(200) NOT NULL,
    description      text         NOT NULL DEFAULT '',
    status           planner.task_status   NOT NULL DEFAULT 'BACKLOG',
    priority         planner.task_priority NOT NULL DEFAULT 'MEDIUM',
    deadline         timestamptz,
    goal_id          uuid,
    category_id      uuid,
    duration_minutes integer,
    sort_order       integer,                               -- порядок внутри цели (декомпозиция ИИ)
    source           planner.task_source NOT NULL DEFAULT 'MANUAL',
    completed_at     timestamptz,                           -- ставит триггер при переходе в DONE
    created_at       timestamptz  NOT NULL DEFAULT now(),
    updated_at       timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT tasks_id_user_key        UNIQUE (id, user_id),
    CONSTRAINT tasks_goal_fk            FOREIGN KEY (goal_id, user_id)
        REFERENCES planner.goals (id, user_id) ON DELETE SET NULL (goal_id),           -- ФТ-13
    CONSTRAINT tasks_category_fk        FOREIGN KEY (category_id, user_id)
        REFERENCES planner.categories (id, user_id) ON DELETE SET NULL (category_id),  -- ФТ-16
    CONSTRAINT tasks_title_not_blank    CHECK (btrim(title) <> ''),
    CONSTRAINT tasks_duration_positive  CHECK (duration_minutes > 0),
    CONSTRAINT tasks_sort_order_positive CHECK (sort_order > 0),
    CONSTRAINT tasks_sort_order_needs_goal CHECK (sort_order IS NULL OR goal_id IS NOT NULL),
    CONSTRAINT tasks_completed_at_matches_status                                        -- ФТ-30
        CHECK ((status = 'DONE') = (completed_at IS NOT NULL))
);
COMMENT ON TABLE planner.tasks IS 'Задачи (ФТ-06–ФТ-09, ФТ-30, ФТ-31)';

CREATE TABLE planner.file_attachments (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid         NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    task_id       uuid,
    goal_id       uuid,
    original_name varchar(255) NOT NULL,
    mime_type     varchar(255) NOT NULL,
    size_bytes    bigint       NOT NULL,
    storage_key   varchar(255) NOT NULL,                    -- путь к файлу в хранилище сервера
    sha256        char(64)     NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT file_attachments_task_fk FOREIGN KEY (task_id, user_id)
        REFERENCES planner.tasks (id, user_id) ON DELETE CASCADE,                     -- ФТ-09
    CONSTRAINT file_attachments_goal_fk FOREIGN KEY (goal_id, user_id)
        REFERENCES planner.goals (id, user_id) ON DELETE CASCADE,                     -- ФТ-13
    CONSTRAINT file_attachments_storage_key_key UNIQUE (storage_key),
    CONSTRAINT file_attachments_one_owner       CHECK (num_nonnulls(task_id, goal_id) = 1),  -- ФТ-32
    CONSTRAINT file_attachments_size_positive   CHECK (size_bytes > 0),
    CONSTRAINT file_attachments_name_not_blank  CHECK (btrim(original_name) <> ''),
    CONSTRAINT file_attachments_sha256_format   CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
COMMENT ON TABLE planner.file_attachments IS
    'Описания файлов (ФТ-32–ФТ-34); содержимое — в файловом хранилище по storage_key';

-- Очередь на удаление файлов из хранилища. Строки удаляются из file_attachments
-- в том числе каскадом (удаление задачи, цели, пользователя), а сами файлы лежат вне базы.
-- Триггер кладёт сюда storage_key, фоновая задача сервера удаляет файл и строку очереди.
-- Очередь пишется в той же транзакции, что и удаление: при откате строка в очередь
-- не попадёт, и файл не будет удалён по ошибке.
CREATE TABLE planner.file_deletion_queue (
    storage_key varchar(255) PRIMARY KEY,
    enqueued_at timestamptz  NOT NULL DEFAULT now()
);
COMMENT ON TABLE planner.file_deletion_queue IS
    'Ключи файлов, которые нужно удалить из хранилища (заполняется триггером)';

-- ─── Календарь и учебные данные ─────────────────────────────────────────────

CREATE TABLE planner.calendar_events (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    title       varchar(200) NOT NULL,
    description text,
    start_at    timestamptz  NOT NULL,
    end_at      timestamptz  NOT NULL,

    CONSTRAINT calendar_events_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT calendar_events_end_after_start CHECK (end_at > start_at)               -- НД-04
);
COMMENT ON TABLE planner.calendar_events IS 'Личные события (ФТ-22)';

CREATE TABLE planner.schedule_items (
    id       uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id  uuid         NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    task_id  uuid         NOT NULL,
    title    varchar(200) NOT NULL,
    start_at timestamptz  NOT NULL,
    end_at   timestamptz  NOT NULL,

    CONSTRAINT schedule_items_task_fk FOREIGN KEY (task_id, user_id)
        REFERENCES planner.tasks (id, user_id) ON DELETE CASCADE,                     -- ФТ-09
    CONSTRAINT schedule_items_title_not_blank CHECK (btrim(title) <> ''),
    CONSTRAINT schedule_items_end_after_start CHECK (end_at > start_at)
);
COMMENT ON TABLE planner.schedule_items IS 'Интервалы выполнения задач в календаре (ФТ-22)';

CREATE TABLE planner.academic_lessons (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    title       varchar(200) NOT NULL,
    discipline  varchar(200) NOT NULL,
    lesson_type varchar(50),
    room        varchar(50),
    teacher     varchar(200),
    source      planner.lesson_source NOT NULL,
    start_at    timestamptz  NOT NULL,
    end_at      timestamptz  NOT NULL,

    CONSTRAINT academic_lessons_end_after_start CHECK (end_at > start_at)
);
COMMENT ON TABLE planner.academic_lessons IS
    'Учебные занятия из ОРИОКС или файла (ФТ-23, ФТ-24); только для просмотра';

CREATE TABLE planner.academic_assignments (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid         NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    external_id  varchar(100) NOT NULL,                     -- id дисциплины : вид : неделя
    discipline   varchar(200) NOT NULL,
    title        varchar(300) NOT NULL,
    control_type varchar(50)  NOT NULL,
    week         smallint     NOT NULL,
    deadline     timestamptz,                               -- конец учебной недели week
    max_grade    numeric(6,2),
    is_done      boolean      NOT NULL DEFAULT false,
    fetched_at   timestamptz  NOT NULL DEFAULT now(),

    CONSTRAINT academic_assignments_user_external_key UNIQUE (user_id, external_id),
    CONSTRAINT academic_assignments_week_range CHECK (week BETWEEN 1 AND 60),
    CONSTRAINT academic_assignments_max_grade_non_negative CHECK (max_grade >= 0)
);
COMMENT ON TABLE planner.academic_assignments IS 'Контрольные мероприятия из ОРИОКС (ФТ-26–ФТ-29)';

-- ─── История запросов к ИИ ──────────────────────────────────────────────────

CREATE TABLE planner.ai_proposals (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid         NOT NULL REFERENCES planner.users (id) ON DELETE CASCADE,
    goal_id       uuid,
    kind          planner.proposal_kind   NOT NULL,
    request_text  text         NOT NULL,
    context       jsonb        NOT NULL DEFAULT '{}',       -- что передано модели, без файлов
    response_data jsonb        NOT NULL,                    -- проверенный ответ модели (ФТ-38)
    final_data    jsonb,                                    -- что пользователь подтвердил
    status        planner.proposal_status NOT NULL DEFAULT 'PENDING',
    model         varchar(100) NOT NULL,
    latency_ms    integer,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    decided_at    timestamptz,

    CONSTRAINT ai_proposals_goal_fk FOREIGN KEY (goal_id, user_id)
        REFERENCES planner.goals (id, user_id) ON DELETE SET NULL (goal_id),
    CONSTRAINT ai_proposals_goal_only_for_decompose CHECK (goal_id IS NULL OR kind = 'DECOMPOSE'),
    CONSTRAINT ai_proposals_decided_at_matches_status
        CHECK ((status = 'PENDING') = (decided_at IS NULL)),
    CONSTRAINT ai_proposals_final_data_when_accepted
        CHECK ((status IN ('ACCEPTED', 'EDITED')) = (final_data IS NOT NULL)),
    CONSTRAINT ai_proposals_latency_non_negative CHECK (latency_ms >= 0)
);
COMMENT ON TABLE planner.ai_proposals IS
    'Предложения ИИ и история запросов (ФТ-35–ФТ-40)';
