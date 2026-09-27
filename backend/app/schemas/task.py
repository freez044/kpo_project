from pydantic import BaseModel, Field
from app.statuses import TaskStatus

class TaskCreate(BaseModel):
    id: int
    title: str | None = Field(min_length = 1)
    est_duration: int | None = Field(default=None, gt=0)
    status: TaskStatus | None = TaskStatus.IN_CREATION

class TaskUpdate(BaseModel):
    id: int
    title: str | None = None
    est_duration: int | None = Field(default=None, gt=0)
    status: TaskStatus | None = TaskStatus.IN_CREATION

class TaskRead(BaseModel):
    id: int
    title: str
    est_duration: int | None
    status: TaskStatus | None = TaskStatus.IN_CREATION