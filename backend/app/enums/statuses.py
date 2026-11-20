from enum import Enum


# Коды из таблицы 1 ТЗ; совпадают с перечислениями planner.task_status и planner.goal_status.
class TaskStatus(str, Enum):
    BACKLOG = 'BACKLOG'
    PLANNED = 'PLANNED'
    IN_PROGRESS = 'IN_PROGRESS'
    IN_HOLD = 'IN_HOLD'
    DONE = 'DONE'
    CANCELLED = 'CANCELLED'


class GoalStatus(str, Enum):
    ACTIVE = 'ACTIVE'
    IN_HOLD = 'IN_HOLD'
    COMPLETED = 'COMPLETED'
    CANCELLED = 'CANCELLED'
