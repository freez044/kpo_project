"""TaskRepository — операции, которые вызывает TaskService (CL-02)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.db.errors import DataValidationError, NotFoundError
from app.db.repositories import TaskFilters
from app.enums.priority import TaskPriority
from app.enums.source import TaskSource
from app.enums.statuses import TaskStatus


def test_create_fills_defaults(tasks, user_id):
    task = tasks.create(user_id, {'title': 'Описать модель данных'})

    assert task.user_id == user_id
    assert task.status is TaskStatus.BACKLOG
    assert task.priority is TaskPriority.MEDIUM
    assert task.source is TaskSource.MANUAL
    assert task.description == ''
    assert task.completed_at is None
    assert task.created_at.tzinfo is not None


def test_get_other_users_task_is_not_found(tasks, user_id, other_user_id):
    task = tasks.create(user_id, {'title': 'Моя задача'})

    assert tasks.get(user_id, task.id).id == task.id
    with pytest.raises(NotFoundError):
        tasks.get(other_user_id, task.id)


def test_list_returns_only_own_tasks(tasks, user_id, other_user_id):
    tasks.create(user_id, {'title': 'Моя'})
    tasks.create(other_user_id, {'title': 'Чужая'})

    assert [t.title for t in tasks.list(user_id)] == ['Моя']


def test_list_filters(tasks, goals, categories, user_id):
    goal = goals.create(user_id, {'title': 'Курсовая'})
    category = categories.create(user_id, {'name': 'Учёба'})
    past = datetime.now(UTC) - timedelta(days=1)

    tasks.create(user_id, {'title': 'В цели', 'goal_id': goal.id})
    tasks.create(user_id, {'title': 'В категории', 'category_id': category.id, 'priority': 'HIGH'})
    tasks.create(user_id, {'title': 'Просрочена', 'deadline': past, 'status': TaskStatus.PLANNED})
    tasks.create(user_id, {'title': 'Сделана в срок', 'deadline': past, 'status': TaskStatus.DONE})

    def titles(**filters):
        return {t.title for t in tasks.list(user_id, TaskFilters(**filters))}

    assert titles(goal_id=goal.id) == {'В цели'}
    assert titles(category_id=category.id) == {'В категории'}
    assert titles(priority=TaskPriority.HIGH) == {'В категории'}
    assert titles(status=TaskStatus.DONE) == {'Сделана в срок'}
    assert titles(overdue=True) == {'Просрочена'}                     # ФТ-31
    assert 'Просрочена' not in titles(overdue=False)


def test_list_orders_goal_tasks_by_sort_order(tasks, goals, user_id):
    goal = goals.create(user_id, {'title': 'Курсовая'})
    tasks.create(user_id, {'title': 'Второй', 'goal_id': goal.id, 'sort_order': 2})
    tasks.create(user_id, {'title': 'Первый', 'goal_id': goal.id, 'sort_order': 1})

    assert [t.title for t in tasks.list(user_id, TaskFilters(goal_id=goal.id))] == ['Первый', 'Второй']


def test_update_changes_only_given_fields_and_clears_with_none(tasks, goals, user_id):
    goal = goals.create(user_id, {'title': 'Курсовая'})
    task = tasks.create(user_id, {'title': 'Старое', 'goal_id': goal.id, 'description': 'текст'})

    updated = tasks.update(user_id, task.id, {'title': 'Новое', 'goal_id': None})

    assert updated.title == 'Новое'
    assert updated.description == 'текст'
    assert updated.goal_id is None


def test_update_returns_trigger_values(tasks, user_id, session):
    task = tasks.create(user_id, {'title': 'Задача'})
    # Внутри транзакции теста now() не меняется, поэтому сдвигаем updated_at в прошлое
    # в обход триггеров (session_replication_role = replica, нужен суперпользователь).
    session.execute(text('SET LOCAL session_replication_role = replica'))
    session.execute(text("UPDATE planner.tasks SET updated_at = now() - interval '1 hour' WHERE id = :id"),
                    {'id': task.id})
    session.execute(text('SET LOCAL session_replication_role = origin'))
    before = tasks.get(user_id, task.id).updated_at

    updated = tasks.update(user_id, task.id, {'title': 'Другая'})

    assert updated.updated_at > before


def test_change_status_sets_and_clears_completed_at(tasks, user_id):
    task = tasks.create(user_id, {'title': 'Задача'})

    done = tasks.change_status(user_id, task.id, TaskStatus.DONE)
    assert done.completed_at is not None                                # ФТ-30

    reopened = tasks.change_status(user_id, task.id, TaskStatus.IN_PROGRESS)
    assert reopened.completed_at is None


def test_update_other_users_task_is_not_found(tasks, user_id, other_user_id):
    task = tasks.create(user_id, {'title': 'Моя'})

    with pytest.raises(NotFoundError):
        tasks.update(other_user_id, task.id, {'title': 'Взлом'})
    assert tasks.get(user_id, task.id).title == 'Моя'


def test_cannot_link_task_to_other_users_goal(tasks, goals, user_id, other_user_id):
    foreign_goal = goals.create(other_user_id, {'title': 'Чужая цель'})

    with pytest.raises(NotFoundError) as error:
        tasks.create(user_id, {'title': 'Задача', 'goal_id': foreign_goal.id})
    assert error.value.constraint == 'tasks_goal_fk'


def test_check_violation_is_validation_error_and_session_survives(tasks, user_id):
    with pytest.raises(DataValidationError) as error:
        tasks.create(user_id, {'title': '   '})
    assert error.value.constraint == 'tasks_title_not_blank'

    # Откатилась только точка сохранения: сеанс продолжает работать.
    assert tasks.create(user_id, {'title': 'Нормальная'}).title == 'Нормальная'


def test_unknown_field_is_rejected(tasks, user_id):
    with pytest.raises(ValueError):
        tasks.create(user_id, {'title': 'Задача', 'user_id': user_id})
    task = tasks.create(user_id, {'title': 'Задача'})
    with pytest.raises(ValueError):
        tasks.update(user_id, task.id, {'source': TaskSource.AI})


def test_delete(tasks, user_id, other_user_id):
    task = tasks.create(user_id, {'title': 'Задача'})

    with pytest.raises(NotFoundError):
        tasks.delete(other_user_id, task.id)
    tasks.delete(user_id, task.id)
    with pytest.raises(NotFoundError):
        tasks.get(user_id, task.id)
    with pytest.raises(NotFoundError):
        tasks.delete(user_id, task.id)


def test_deletion_preview_counts_schedule_items(tasks, user_id, other_user_id, session):
    task = tasks.create(user_id, {'title': 'Задача'})
    session.execute(
        text("""INSERT INTO planner.schedule_items (user_id, task_id, title, start_at, end_at)
                VALUES (:u, :t, 'Работа', now(), now() + interval '1 hour')"""),
        {'u': user_id, 't': task.id},
    )

    preview = tasks.deletion_preview(user_id, task.id)
    assert (preview.schedule_items, preview.files) == (1, 0)
    with pytest.raises(NotFoundError):
        tasks.deletion_preview(other_user_id, task.id)
