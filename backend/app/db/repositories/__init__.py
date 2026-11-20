"""Репозитории: функции слоя данных, user_id — первый аргумент каждого метода.

Методы не фиксируют транзакцию: это делает вызывающий (get_session для запроса API).
Ошибки — исключения из app.db.errors.
"""

from app.db.repositories.categories import CategoryRepository
from app.db.repositories.goals import GoalDeletionPreview, GoalProgress, GoalRepository
from app.db.repositories.tasks import TaskDeletionPreview, TaskFilters, TaskRepository
from app.db.repositories.users import UserRepository

__all__ = [
    'CategoryRepository',
    'GoalDeletionPreview',
    'GoalProgress',
    'GoalRepository',
    'TaskDeletionPreview',
    'TaskFilters',
    'TaskRepository',
    'UserRepository',
]
