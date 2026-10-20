from enum import Enum

class TaskStatus(str, Enum):
    BACKLOG = 'BACKLOG'
    IN_PROGRESS = 'IN_PROGRESS'
    IN_HOLD = 'IN_HOLD'
    DONE = 'DONE'
    CANCELLED = 'CANCELLED'
    IN_CREATION = 'IN_CREATION'
