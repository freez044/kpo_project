from datetime import datetime

from pydantic import BaseModel, Field, ConfigDict

from backend.app.enums.statuses import TaskStatus
from backend.app.enums.priority import TaskPriority

class TaskCreate(BaseModel):
    title: str = Field(min_length = 1, max_length = 255)
    description: str | None = Field(default = None, max_length = 2000)

    status: TaskStatus
    priority: TaskPriority

    estimated_duration_minutes: int | None = Field(default=None, gt=0)
    deadline: datetime | None = None
    
class TaskUpdate(BaseModel):
    title: str | None = Field(default = None, min_length = 1, max_length = 255)
    description: str | None = Field(default = None, max_length = 2000)

    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    
    estimated_duration_minutes: int | None = Field(default=None, gt=0)
    deadline: datetime | None = None

class TaskRead(BaseModel):
    title: str
    description: str | None
    
    status: TaskStatus 
    priority: TaskPriority 
    
    estimated_duration_minutes: int | None
    deadline: datetime | None