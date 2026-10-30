-- 05. Процедуры.
--
-- Процедуры (CALL) — для операций, которые меняют данные и ничего не возвращают.
-- Каждая выполняется целиком или не выполняется (НД-03).
-- Коды ошибок — как в 04_functions_triggers.sql.

-- ФТ-39, ФТ-40: отклонить предложение ИИ.
CREATE PROCEDURE planner.reject_proposal(p_user_id uuid, p_proposal_id uuid)
LANGUAGE plpgsql
AS $$
DECLARE
    v_status planner.proposal_status;
BEGIN
    SELECT status INTO v_status
      FROM planner.ai_proposals
     WHERE id = p_proposal_id AND user_id = p_user_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Предложение не найдено' USING ERRCODE = 'AP001';
    END IF;
    IF v_status <> 'PENDING' THEN
        RAISE EXCEPTION 'Предложение ИИ уже решено' USING ERRCODE = 'AP002';
    END IF;

    IF (SELECT ai_history_enabled FROM planner.users WHERE id = p_user_id) THEN
        UPDATE planner.ai_proposals SET status = 'REJECTED' WHERE id = p_proposal_id;
    ELSE
        DELETE FROM planner.ai_proposals WHERE id = p_proposal_id;
    END IF;
END;
$$;

-- ФТ-23, ФТ-24: новое расписание полностью заменяет занятия того же источника.
-- p_lessons — массив объектов с ключами:
--   title, discipline, lesson_type, room, teacher, start_at, end_at
CREATE PROCEDURE planner.replace_lessons(
    p_user_id uuid,
    p_source  planner.lesson_source,
    p_lessons jsonb
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF jsonb_typeof(p_lessons) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Ожидается массив занятий' USING ERRCODE = 'AP003';
    END IF;

    DELETE FROM planner.academic_lessons
     WHERE user_id = p_user_id AND source = p_source;

    INSERT INTO planner.academic_lessons
           (user_id, source, title, discipline, lesson_type, room, teacher, start_at, end_at)
    SELECT p_user_id, p_source,
           l.title, l.discipline, l.lesson_type, l.room, l.teacher, l.start_at, l.end_at
      FROM jsonb_to_recordset(p_lessons) AS l (
               title       varchar,
               discipline  varchar,
               lesson_type varchar,
               room        varchar,
               teacher     varchar,
               start_at    timestamptz,
               end_at      timestamptz
           );
END;
$$;

-- ФТ-26: обновить задания из ОРИОКС по external_id.
-- p_items — полный список заданий семестра с ключами:
--   external_id, discipline, title, control_type, week, deadline, max_grade, is_done
-- p_remove_missing = true удаляет задания, которых больше нет в ОРИОКС.
-- Вызывать только после успешного ответа ОРИОКС, иначе список окажется пустым.
CREATE PROCEDURE planner.upsert_assignments(
    p_user_id        uuid,
    p_items          jsonb,
    p_remove_missing boolean DEFAULT true
)
LANGUAGE plpgsql
AS $$
BEGIN
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Ожидается массив заданий' USING ERRCODE = 'AP003';
    END IF;

    INSERT INTO planner.academic_assignments AS a
           (user_id, external_id, discipline, title, control_type, week, deadline, max_grade, is_done, fetched_at)
    SELECT p_user_id, i.external_id, i.discipline, i.title, i.control_type,
           i.week, i.deadline, i.max_grade, coalesce(i.is_done, false), now()
      FROM jsonb_to_recordset(p_items) AS i (
               external_id  varchar,
               discipline   varchar,
               title        varchar,
               control_type varchar,
               week         smallint,
               deadline     timestamptz,
               max_grade    numeric,
               is_done      boolean
           )
    ON CONFLICT (user_id, external_id) DO UPDATE
       SET discipline   = EXCLUDED.discipline,
           title        = EXCLUDED.title,
           control_type = EXCLUDED.control_type,
           week         = EXCLUDED.week,
           deadline     = EXCLUDED.deadline,
           max_grade    = EXCLUDED.max_grade,
           is_done      = EXCLUDED.is_done,
           fetched_at   = EXCLUDED.fetched_at;

    IF p_remove_missing THEN
        DELETE FROM planner.academic_assignments a
         WHERE a.user_id = p_user_id
           AND NOT EXISTS (SELECT 1
                             FROM jsonb_array_elements(p_items) AS e
                            WHERE e ->> 'external_id' = a.external_id);
    END IF;

    UPDATE planner.orioks_connections
       SET last_sync_at = now(), last_sync_error = NULL
     WHERE user_id = p_user_id;
END;
$$;

-- ФТ-41: неудачная попытка входа. После p_max_attempts подряд вход блокируется
-- на p_lock_for, счётчик начинается заново.
CREATE PROCEDURE planner.register_login_failure(
    p_user_id      uuid,
    p_max_attempts integer  DEFAULT 5,
    p_lock_for     interval DEFAULT interval '15 minutes'
)
LANGUAGE sql
AS $$
    UPDATE planner.users
       SET failed_login_count = CASE WHEN failed_login_count + 1 >= p_max_attempts
                                     THEN 0 ELSE failed_login_count + 1 END,
           locked_until       = CASE WHEN failed_login_count + 1 >= p_max_attempts
                                     THEN now() + p_lock_for ELSE locked_until END
     WHERE id = p_user_id;
$$;

-- ФТ-41: успешный вход сбрасывает счётчик и блокировку.
CREATE PROCEDURE planner.register_login_success(p_user_id uuid)
LANGUAGE sql
AS $$
    UPDATE planner.users
       SET failed_login_count = 0, locked_until = NULL
     WHERE id = p_user_id
       AND (failed_login_count <> 0 OR locked_until IS NOT NULL);
$$;

-- Выход со всех устройств, кроме текущего (например, после смены пароля).
CREATE PROCEDURE planner.revoke_user_sessions(p_user_id uuid, p_keep_session_id uuid DEFAULT NULL)
LANGUAGE sql
AS $$
    UPDATE planner.sessions
       SET revoked_at = now()
     WHERE user_id = p_user_id
       AND revoked_at IS NULL
       AND id IS DISTINCT FROM p_keep_session_id;
$$;

-- Очистка: истёкшие сеансы и отозванные дольше p_keep_revoked назад.
-- Запускать по расписанию, например раз в сутки.
CREATE PROCEDURE planner.purge_sessions(p_keep_revoked interval DEFAULT interval '7 days')
LANGUAGE sql
AS $$
    DELETE FROM planner.sessions
     WHERE expires_at < now()
        OR revoked_at < now() - p_keep_revoked;
$$;
