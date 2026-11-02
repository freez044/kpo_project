from enum import Enum


# Как появилась задача: вручную или по предложению ИИ (planner.task_source).
class TaskSource(str, Enum):
    MANUAL = 'MANUAL'
    AI = 'AI'
