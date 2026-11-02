"""UserRepository, CategoryRepository, GoalRepository."""

import pytest

from app.db.errors import ConflictError, DataValidationError, NotFoundError
from app.enums.statuses import GoalStatus, TaskStatus
from tests.conftest import make_user

# ─── Пользователи ───────────────────────────────────────────────────────────


def test_user_create_and_find_by_email_ignores_case(users):
    user_id = make_user(users, email='Student@Example.com', study_group='  ')

    user = users.find_by_email('student@example.com')
    assert user is not None and user.id == user_id
    assert user.study_group is None              # триггер превращает пустую группу в NULL
    assert user.timezone == 'Europe/Moscow'
    assert user.ai_history_enabled is True
    assert users.find_by_email('nobody@example.com') is None


def test_user_email_taken_is_conflict(users):
    make_user(users, email='same@example.com')

    with pytest.raises(ConflictError) as error:
        make_user(users, email='SAME@example.com')
    assert error.value.constraint == 'users_email_key'


def test_user_invalid_timezone(users):
    with pytest.raises(DataValidationError) as error:
        make_user(users, timezone='Mars/Olympus')
    assert error.value.constraint == 'users_timezone_valid'


def test_user_update_and_delete_cascade(users, tasks, user_id):
    tasks.create(user_id, {'title': 'Задача'})

    assert users.update(user_id, {'ai_history_enabled': False}).ai_history_enabled is False
    users.delete(user_id)
    with pytest.raises(NotFoundError):
        users.get(user_id)
    assert tasks.list(user_id) == []             # ФТ-05


# ─── Категории ──────────────────────────────────────────────────────────────


def test_category_name_unique_ignoring_case(categories, user_id, other_user_id):
    categories.create(user_id, {'name': 'Учёба', 'color': '#4A6FA5'})
    categories.create(other_user_id, {'name': 'Учёба'})          # у другого пользователя можно

    with pytest.raises(ConflictError) as error:
        categories.create(user_id, {'name': 'УЧЁБА'})             # ФТ-14
    assert error.value.constraint == 'categories_user_name_key'


def test_category_color_format(categories, user_id):
    with pytest.raises(DataValidationError) as error:
        categories.create(user_id, {'name': 'Спорт', 'color': 'RED'})
    assert error.value.constraint == 'categories_color_format'


def test_category_list_update_and_isolation(categories, user_id, other_user_id):
    category = categories.create(user_id, {'name': 'Учёба'})
    categories.create(user_id, {'name': 'Английский'})

    assert [c.name for c in categories.list(user_id)] == ['Английский', 'Учёба']
    assert categories.update(user_id, category.id, {'name': 'Вуз'}).name == 'Вуз'
    with pytest.raises(NotFoundError):
        categories.update(other_user_id, category.id, {'name': 'Чужая'})


def test_category_delete_clears_it_on_tasks_and_goals(categories, goals, tasks, user_id):
    category = categories.create(user_id, {'name': 'Учёба'})
    goal = goals.create(user_id, {'title': 'Цель', 'category_id': category.id})
    task = tasks.create(user_id, {'title': 'Задача', 'category_id': category.id})

    categories.delete(user_id, category.id)                       # ФТ-16

    assert goals.get(user_id, goal.id).category_id is None
    assert tasks.get(user_id, task.id).category_id is None


# ─── Цели ───────────────────────────────────────────────────────────────────


def test_goal_list_by_status(goals, user_id, other_user_id):
    goals.create(user_id, {'title': 'Активная'})
    goals.create(user_id, {'title': 'На паузе', 'status': GoalStatus.IN_HOLD})
    goals.create(other_user_id, {'title': 'Чужая'})

    assert {g.title for g in goals.list(user_id)} == {'Активная', 'На паузе'}
    assert [g.title for g in goals.list(user_id, GoalStatus.IN_HOLD)] == ['На паузе']


def test_goal_progress_and_deletion(goals, tasks, user_id, other_user_id):
    goal = goals.create(user_id, {'title': 'Курсовая'})
    first = tasks.create(user_id, {'title': '1', 'goal_id': goal.id, 'sort_order': 1})
    tasks.create(user_id, {'title': '2', 'goal_id': goal.id, 'status': TaskStatus.DONE})
    tasks.create(user_id, {'title': '3', 'goal_id': goal.id, 'status': TaskStatus.CANCELLED})

    progress = goals.progress(user_id, goal.id)                   # ФТ-12
    assert (progress.done, progress.total, progress.percent) == (1, 2, 50)
    assert goals.deletion_preview(user_id, goal.id).tasks == 3
    with pytest.raises(NotFoundError):
        goals.progress(other_user_id, goal.id)

    goals.delete(user_id, goal.id)                                # ФТ-13: задачи остаются без цели
    orphan = tasks.get(user_id, first.id)
    assert orphan.goal_id is None
    assert orphan.sort_order is None
