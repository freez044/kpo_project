-- 04. Функции и триггеры.
--
-- Собственные коды ошибок (SQLSTATE), которые серверная часть переводит в коды API:
--   AP001 — объект не найден или принадлежит другому пользователю → 404 NOT_FOUND
--   AP002 — предложение ИИ уже решено                              → 409 CONFLICT
--   AP003 — неверные данные для операции                           → 422 VALIDATION_ERROR
-- Стандартные коды: 23514 check_violation, 23505 unique_violation,
-- 23503 foreign_key_violation, 22P02 invalid_text_representation → 422 VALIDATION_ERROR.

-- ─── Вспомогательные функции ────────────────────────────────────────────────

CREATE FUNCTION planner.is_valid_timezone(p_timezone text)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone);
$$;
COMMENT ON FUNCTION planner.is_valid_timezone(text) IS 'Есть ли такой часовой пояс IANA';

-- ФТ-31: просроченность вычисляется, а не хранится.
CREATE FUNCTION planner.task_is_overdue(
    p_deadline timestamptz,
    p_status   planner.task_status,
    p_at       timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
    SELECT p_deadline IS NOT NULL
       AND p_deadline < p_at
       AND p_status NOT IN ('DONE', 'CANCELLED');
$$;
COMMENT ON FUNCTION planner.task_is_overdue(timestamptz, planner.task_status, timestamptz) IS
    'Задача просрочена: срок прошёл, а статус не DONE и не CANCELLED (ФТ-31)';

-- ─── Триггерные функции ─────────────────────────────────────────────────────

-- Время последнего изменения записи.
CREATE FUNCTION planner.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

-- Пользователь: убрать пробелы по краям, пустую группу превратить в NULL,
-- проверить часовой пояс. CHECK не может читать pg_timezone_names, поэтому — триггер.
CREATE FUNCTION planner.users_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.first_name  := btrim(NEW.first_name);
    NEW.last_name   := btrim(NEW.last_name);
    NEW.study_group := nullif(btrim(NEW.study_group), '');

    IF TG_OP = 'INSERT' OR NEW.timezone IS DISTINCT FROM OLD.timezone THEN
        IF NOT planner.is_valid_timezone(NEW.timezone) THEN
            RAISE EXCEPTION 'Неизвестный часовой пояс: %', NEW.timezone
                USING ERRCODE = 'check_violation',
                      CONSTRAINT = 'users_timezone_valid',
                      TABLE = 'users',
                      COLUMN = 'timezone';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Задача:
--  * DONE → ставится completed_at, выход из DONE → completed_at очищается (ФТ-30);
--  * задача без цели не имеет порядка: срабатывает и при ON DELETE SET NULL,
--    когда удаляют цель (ФТ-13), потому что ссылочное действие — это тоже UPDATE.
CREATE FUNCTION planner.tasks_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'DONE' THEN
        IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'DONE' THEN
            NEW.completed_at := coalesce(NEW.completed_at, now());
        END IF;
    ELSE
        NEW.completed_at := NULL;
    END IF;

    IF NEW.goal_id IS NULL THEN
        NEW.sort_order := NULL;
    END IF;
    RETURN NEW;
END;
$$;

-- Файл удалён из базы (в том числе каскадом) → его ключ попадает в очередь удаления
-- из хранилища. Очередь пишется в той же транзакции: если транзакция откатится,
-- строка в очередь не попадёт и файл не будет удалён по ошибке.
CREATE FUNCTION planner.file_attachments_after_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO planner.file_deletion_queue (storage_key)
    VALUES (OLD.storage_key)
    ON CONFLICT (storage_key) DO NOTHING;
    RETURN OLD;
END;
$$;

-- Предложение ИИ: решение принимается один раз, время решения ставится само.
CREATE FUNCTION planner.ai_proposals_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Предложение ИИ уже решено' USING ERRCODE = 'AP002';
    END IF;
    IF OLD.status = 'PENDING' AND NEW.status <> 'PENDING' THEN
        NEW.decided_at := coalesce(NEW.decided_at, now());
    END IF;
    RETURN NEW;
END;
$$;

-- ─── Триггеры ───────────────────────────────────────────────────────────────

CREATE TRIGGER users_before_write
    BEFORE INSERT OR UPDATE ON planner.users
    FOR EACH ROW EXECUTE FUNCTION planner.users_before_write();

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON planner.users
    FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
    EXECUTE FUNCTION planner.set_updated_at();

CREATE TRIGGER goals_set_updated_at
    BEFORE UPDATE ON planner.goals
    FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
    EXECUTE FUNCTION planner.set_updated_at();

CREATE TRIGGER tasks_before_write
    BEFORE INSERT OR UPDATE ON planner.tasks
    FOR EACH ROW EXECUTE FUNCTION planner.tasks_before_write();

CREATE TRIGGER tasks_set_updated_at
    BEFORE UPDATE ON planner.tasks
    FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
    EXECUTE FUNCTION planner.set_updated_at();

CREATE TRIGGER file_attachments_after_delete
    AFTER DELETE ON planner.file_attachments
    FOR EACH ROW EXECUTE FUNCTION planner.file_attachments_after_delete();

CREATE TRIGGER ai_proposals_before_update
    BEFORE UPDATE ON planner.ai_proposals
    FOR EACH ROW EXECUTE FUNCTION planner.ai_proposals_before_update();

-- ─── Функции для экранов ────────────────────────────────────────────────────
-- Все принимают p_user_id и видят только записи этого пользователя.

-- ФТ-12: прогресс цели — доля выполненных среди неотменённых задач.
CREATE FUNCTION planner.goal_progress(p_user_id uuid, p_goal_id uuid)
RETURNS TABLE (done integer, total integer, percent integer)
LANGUAGE sql STABLE
AS $$
    SELECT count(*) FILTER (WHERE status = 'DONE')::integer,
           count(*)::integer,
           CASE WHEN count(*) = 0 THEN 0
                ELSE round(100.0 * count(*) FILTER (WHERE status = 'DONE') / count(*))::integer
           END
      FROM planner.tasks
     WHERE user_id = p_user_id
       AND goal_id = p_goal_id
       AND status <> 'CANCELLED';
$$;

-- ФТ-09: что будет удалено вместе с задачей — для окна подтверждения.
CREATE FUNCTION planner.task_deletion_preview(p_user_id uuid, p_task_id uuid)
RETURNS TABLE (schedule_items integer, files integer)
LANGUAGE sql STABLE
AS $$
    SELECT (SELECT count(*) FROM planner.schedule_items
             WHERE user_id = p_user_id AND task_id = p_task_id)::integer,
           (SELECT count(*) FROM planner.file_attachments
             WHERE user_id = p_user_id AND task_id = p_task_id)::integer;
$$;

-- ФТ-13: сколько задач останется без цели и сколько файлов цели будет удалено.
CREATE FUNCTION planner.goal_deletion_preview(p_user_id uuid, p_goal_id uuid)
RETURNS TABLE (tasks integer, files integer)
LANGUAGE sql STABLE
AS $$
    SELECT (SELECT count(*) FROM planner.tasks
             WHERE user_id = p_user_id AND goal_id = p_goal_id)::integer,
           (SELECT count(*) FROM planner.file_attachments
             WHERE user_id = p_user_id AND goal_id = p_goal_id)::integer;
$$;

-- ФТ-21: все элементы календаря, пересекающие отрезок [p_from, p_to).
CREATE FUNCTION planner.calendar_items(p_user_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
    kind      text,          -- EVENT, SCHEDULE_ITEM, LESSON
    id        uuid,
    title     varchar,
    start_at  timestamptz,
    end_at    timestamptz,
    task_id   uuid,          -- только у интервалов задач
    read_only boolean        -- занятия только для просмотра (ФТ-23)
)
LANGUAGE sql STABLE
AS $$
    SELECT 'EVENT', e.id, e.title, e.start_at, e.end_at, NULL::uuid, false
      FROM planner.calendar_events e
     WHERE e.user_id = p_user_id AND e.start_at < p_to AND e.end_at > p_from
    UNION ALL
    SELECT 'SCHEDULE_ITEM', s.id, s.title, s.start_at, s.end_at, s.task_id, false
      FROM planner.schedule_items s
     WHERE s.user_id = p_user_id AND s.start_at < p_to AND s.end_at > p_from
    UNION ALL
    SELECT 'LESSON', l.id, l.title, l.start_at, l.end_at, NULL::uuid, true
      FROM planner.academic_lessons l
     WHERE l.user_id = p_user_id AND l.start_at < p_to AND l.end_at > p_from
     ORDER BY 4, 1;
$$;

-- ФТ-25: пересечения по времени. Границы нестрогие: 10:00–11:00 и 11:00–12:00
-- не пересекаются. Пересечения занятий между собой не показываются.
CREATE FUNCTION planner.calendar_overlaps(p_user_id uuid, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
    first_kind    text,
    first_id      uuid,
    second_kind   text,
    second_id     uuid,
    overlap_start timestamptz,
    overlap_end   timestamptz
)
LANGUAGE sql STABLE
AS $$
    WITH items AS (
        SELECT * FROM planner.calendar_items(p_user_id, p_from, p_to)
    )
    SELECT a.kind, a.id, b.kind, b.id,
           greatest(a.start_at, b.start_at),
           least(a.end_at, b.end_at)
      FROM items a
      JOIN items b
        ON a.start_at < b.end_at
       AND b.start_at < a.end_at
       AND (a.kind, a.id) < (b.kind, b.id)          -- каждую пару — один раз
     WHERE NOT (a.kind = 'LESSON' AND b.kind = 'LESSON')
     ORDER BY 5;
$$;

-- ФТ-27: нагрузка по неделям в часовом поясе пользователя.
-- Считает только цифры; решение, что показать (ФТ-28, ФТ-29), принимает сервер.
CREATE FUNCTION planner.workload_by_week(p_user_id uuid, p_from date, p_weeks integer DEFAULT 4)
RETURNS TABLE (
    week_start        date,
    tasks_due         integer,   -- невыполненные задачи со сроком на этой неделе
    high_priority_due integer,   -- из них HIGH и URGENT
    assignments_due   integer    -- невыполненные задания ОРИОКС со сроком на этой неделе
)
LANGUAGE sql STABLE
AS $$
    WITH u AS (
        SELECT timezone FROM planner.users WHERE id = p_user_id
    ),
    weeks AS (
        SELECT (date_trunc('week', p_from::timestamp) + make_interval(weeks => g))::date AS week_start
          FROM generate_series(0, greatest(p_weeks, 1) - 1) AS g
    )
    SELECT w.week_start,
           (SELECT count(*) FROM planner.tasks t, u
             WHERE t.user_id = p_user_id
               AND t.status NOT IN ('DONE', 'CANCELLED')
               AND (t.deadline AT TIME ZONE u.timezone)::date >= w.week_start
               AND (t.deadline AT TIME ZONE u.timezone)::date <  w.week_start + 7)::integer,
           (SELECT count(*) FROM planner.tasks t, u
             WHERE t.user_id = p_user_id
               AND t.status NOT IN ('DONE', 'CANCELLED')
               AND t.priority IN ('HIGH', 'URGENT')
               AND (t.deadline AT TIME ZONE u.timezone)::date >= w.week_start
               AND (t.deadline AT TIME ZONE u.timezone)::date <  w.week_start + 7)::integer,
           (SELECT count(*) FROM planner.academic_assignments a, u
             WHERE a.user_id = p_user_id
               AND NOT a.is_done
               AND (a.deadline AT TIME ZONE u.timezone)::date >= w.week_start
               AND (a.deadline AT TIME ZONE u.timezone)::date <  w.week_start + 7)::integer
      FROM weeks w
     ORDER BY w.week_start;
$$;

-- ─── Предложения ИИ ─────────────────────────────────────────────────────────

-- ФТ-37, ФТ-39, ФТ-40: применить декомпозицию цели одной транзакцией.
-- p_final — то, что подтвердил пользователь, в той же форме, что response_data:
--   {"tasks": [{"title": "...", "description": "...", "priority": "HIGH", "durationMinutes": 120}, ...]}
-- Порядок задач — порядок в массиве; номера продолжают уже существующие задачи цели.
-- Возвращает id созданных задач.
CREATE FUNCTION planner.apply_decomposition(p_user_id uuid, p_proposal_id uuid, p_final jsonb)
RETURNS SETOF uuid
LANGUAGE plpgsql
AS $$
DECLARE
    v_proposal planner.ai_proposals;
    v_task     jsonb;
    v_order    integer;
    v_task_id  uuid;
BEGIN
    SELECT * INTO v_proposal
      FROM planner.ai_proposals
     WHERE id = p_proposal_id AND user_id = p_user_id
       FOR UPDATE;                                   -- два одновременных «Применить» не создадут задачи дважды

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Предложение не найдено' USING ERRCODE = 'AP001';
    END IF;
    IF v_proposal.kind <> 'DECOMPOSE' THEN
        RAISE EXCEPTION 'Предложение не является декомпозицией цели' USING ERRCODE = 'AP003';
    END IF;
    IF v_proposal.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Предложение ИИ уже решено' USING ERRCODE = 'AP002';
    END IF;
    IF v_proposal.goal_id IS NULL THEN
        RAISE EXCEPTION 'Цель предложения удалена' USING ERRCODE = 'AP001';
    END IF;
    IF jsonb_typeof(p_final -> 'tasks') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_final -> 'tasks') = 0 THEN
        RAISE EXCEPTION 'В предложении нет задач' USING ERRCODE = 'AP003';
    END IF;

    SELECT coalesce(max(sort_order), 0) INTO v_order
      FROM planner.tasks
     WHERE user_id = p_user_id AND goal_id = v_proposal.goal_id;

    FOR v_task IN SELECT value FROM jsonb_array_elements(p_final -> 'tasks') LOOP
        v_order := v_order + 1;
        INSERT INTO planner.tasks
               (user_id, goal_id, title, description, priority, duration_minutes, sort_order, source)
        VALUES (p_user_id,
                v_proposal.goal_id,
                v_task ->> 'title',
                coalesce(v_task ->> 'description', ''),
                coalesce((v_task ->> 'priority')::planner.task_priority, 'MEDIUM'),
                (v_task ->> 'durationMinutes')::integer,
                v_order,
                'AI')
        RETURNING id INTO v_task_id;
        RETURN NEXT v_task_id;
    END LOOP;

    IF (SELECT ai_history_enabled FROM planner.users WHERE id = p_user_id) THEN
        UPDATE planner.ai_proposals
           SET status = CASE WHEN p_final -> 'tasks' = response_data -> 'tasks'
                             THEN 'ACCEPTED'::planner.proposal_status
                             ELSE 'EDITED'::planner.proposal_status END,
               final_data = p_final
         WHERE id = p_proposal_id;
    ELSE
        DELETE FROM planner.ai_proposals WHERE id = p_proposal_id;   -- история отключена (ФТ-40)
    END IF;
END;
$$;
