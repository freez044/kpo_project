"""Задачи локального адаптера: отдельный владелец в каждой записи."""
from datetime import date, datetime, timezone, timedelta
from enum import StrEnum
from typing import Annotated
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo
import json

from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator
from app.accounts import AccountService, AccountError, PublicUser, unauthorized


class Status(StrEnum):
    BACKLOG = 'BACKLOG'
    PLANNED = 'PLANNED'
    IN_PROGRESS = 'IN_PROGRESS'
    IN_HOLD = 'IN_HOLD'
    DONE = 'DONE'
    CANCELLED = 'CANCELLED'


class Priority(StrEnum):
    LOW = 'LOW'
    MEDIUM = 'MEDIUM'
    HIGH = 'HIGH'
    URGENT = 'URGENT'


class TaskFields(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default='', max_length=10000)
    deadline: AwareDatetime | None = None
    plannedDate: date | None = None
    category: str | None = Field(default=None, max_length=100)
    priority: Priority = Priority.MEDIUM
    status: Status = Status.PLANNED

    @field_validator('title', 'category', mode='before')
    @classmethod
    def trim_text(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError('Укажите непустое название')
        return value


class TaskPatch(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10000)
    deadline: AwareDatetime | None = None
    plannedDate: date | None = None
    category: str | None = Field(default=None, max_length=100)
    priority: Priority | None = None
    status: Status | None = None

    @field_validator('title', 'description', 'priority', 'status', mode='before')
    @classmethod
    def reject_null(cls, value):
        if value is None:
            raise ValueError('Поле не может быть пустым')
        return value

    @field_validator('title', 'category', mode='before')
    @classmethod
    def trim_text(cls, value):
        return TaskFields.trim_text(value)


class TaskRead(TaskFields):
    id: str
    createdAt: AwareDatetime
    updatedAt: AwareDatetime
    completedAt: AwareDatetime | None
    isOverdue: bool
    source: str = 'MANUAL'
    orioks: dict | None = None


class Dashboard(BaseModel):
    date: date
    today: list[TaskRead]
    overdue: list[TaskRead]
    upcoming: list[TaskRead]
    completedCount: int


class TaskService:
    def __init__(self, accounts: AccountService):
        self.accounts = accounts

    def initialize(self):
        with self.accounts.transaction() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
                    description TEXT NOT NULL DEFAULT '',
                    deadline TEXT, planned_date TEXT, category TEXT,
                    priority TEXT NOT NULL CHECK(priority IN ('LOW','MEDIUM','HIGH','URGENT')),
                    status TEXT NOT NULL CHECK(status IN ('BACKLOG','PLANNED','IN_PROGRESS','IN_HOLD','DONE','CANCELLED')),
                    completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS tasks_owner_plan_idx ON tasks(user_id, planned_date);
                CREATE INDEX IF NOT EXISTS tasks_owner_deadline_idx ON tasks(user_id, deadline);
            ''')
            columns = {row['name'] for row in db.execute('PRAGMA table_info(tasks)')}
            for name, declaration in [('source', "TEXT NOT NULL DEFAULT 'MANUAL'"), ('source_key', 'TEXT'), ('orioks_metadata', 'TEXT')]:
                if name not in columns:
                    db.execute(f'ALTER TABLE tasks ADD COLUMN {name} {declaration}')
            db.execute('CREATE UNIQUE INDEX IF NOT EXISTS tasks_owner_source_key ON tasks(user_id,source_key) WHERE source_key IS NOT NULL')

    @staticmethod
    def serialize(row):
        deadline = datetime.fromisoformat(row['deadline']) if row['deadline'] else None
        metadata = json.loads(row['orioks_metadata']) if row['orioks_metadata'] else None
        if metadata:
            now = datetime.now(timezone.utc)
            planned_due = datetime.fromisoformat(metadata['plannedDueAt']) if metadata.get('plannedDueAt') else None
            metadata['stage'] = ('FINISHED' if row['status'] in ('DONE', 'CANCELLED') else 'PENALTY' if deadline and now > deadline else 'GRACE' if deadline and planned_due and now > planned_due else 'BEFORE_FIRST' if planned_due else 'UNKNOWN')
        return TaskRead(id=row['id'], title=row['title'], description=row['description'], deadline=deadline, plannedDate=row['planned_date'], category=row['category'], priority=row['priority'], status=row['status'], completedAt=row['completed_at'], createdAt=row['created_at'], updatedAt=row['updated_at'], source=row['source'], orioks=metadata, isOverdue=bool(deadline and deadline < datetime.now(timezone.utc) and row['status'] not in ('DONE', 'CANCELLED')))

    def list(self, user_id):
        with self.accounts.transaction() as db:
            rows = db.execute('SELECT * FROM tasks WHERE user_id=? ORDER BY created_at,id', (user_id,)).fetchall()
        return [self.serialize(row) for row in rows]

    @staticmethod
    def owned(db, task_id, user_id):
        row = db.execute('SELECT * FROM tasks WHERE id=? AND user_id=?', (str(task_id), user_id)).fetchone()
        if row is None:
            raise AccountError(404, 'NOT_FOUND', 'Задача не найдена.')
        return row

    def get(self, task_id, user_id):
        with self.accounts.transaction() as db:
            return self.serialize(self.owned(db, task_id, user_id))

    def create(self, data, user):
        task_id = str(uuid4())
        now = datetime.now(timezone.utc).isoformat()
        planned = data.plannedDate
        if 'plannedDate' not in data.model_fields_set:
            planned = datetime.now(ZoneInfo(user.timezone)).date()
        with self.accounts.transaction() as db:
            db.execute('INSERT INTO tasks (id,user_id,title,description,deadline,planned_date,category,priority,status,completed_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', (task_id, user.id, data.title, data.description, data.deadline.astimezone(timezone.utc).isoformat() if data.deadline else None, planned.isoformat() if planned else None, data.category, data.priority.value, data.status.value, now if data.status == Status.DONE else None, now, now))
            return self.serialize(self.owned(db, task_id, user.id))

    def update(self, task_id, data, user_id):
        values = data.model_dump(exclude_unset=True)
        columns = {'title': 'title', 'description': 'description', 'deadline': 'deadline', 'plannedDate': 'planned_date', 'category': 'category', 'priority': 'priority', 'status': 'status'}
        with self.accounts.transaction() as db:
            old = self.owned(db, task_id, user_id)
            if not values:
                return self.serialize(old)
            updates = {}
            for key, value in values.items():
                if isinstance(value, datetime):
                    value = value.astimezone(timezone.utc).isoformat()
                elif isinstance(value, date):
                    value = value.isoformat()
                elif isinstance(value, StrEnum):
                    value = value.value
                updates[columns[key]] = value
            now = datetime.now(timezone.utc).isoformat()
            if 'status' in updates and updates['status'] != old['status']:
                updates['completed_at'] = now if updates['status'] == Status.DONE else None
            updates['updated_at'] = now
            if 'deadline' in updates and old['orioks_metadata'] and (datetime.fromisoformat(updates['deadline']) if updates['deadline'] else None) != (datetime.fromisoformat(old['deadline']) if old['deadline'] else None):
                metadata = json.loads(old['orioks_metadata'])
                metadata['noPenaltyUntil'] = updates['deadline']
                metadata['deadlineSource'] = 'MANUAL'
                updates['orioks_metadata'] = json.dumps(metadata, ensure_ascii=False)
            # Column names come exclusively from the fixed map above, never user input.
            assignment = ','.join(f'{column}=?' for column in updates)
            db.execute(f'UPDATE tasks SET {assignment} WHERE id=? AND user_id=?', (*updates.values(), str(task_id), user_id))
            return self.serialize(self.owned(db, task_id, user_id))

    def delete(self, task_id, user_id):
        with self.accounts.transaction() as db:
            self.owned(db, task_id, user_id)
            db.execute('DELETE FROM tasks WHERE id=? AND user_id=?', (str(task_id), user_id))

    def dashboard(self, user):
        tasks = self.list(user.id)
        today = datetime.now(ZoneInfo(user.timezone)).date()
        daily = [t for t in tasks if t.plannedDate == today and t.status != Status.CANCELLED]
        now = datetime.now(timezone.utc)
        overdue = sorted([t for t in tasks if t.isOverdue], key=lambda t: t.deadline)
        upcoming = sorted([t for t in tasks if t.deadline and now <= t.deadline <= now + timedelta(days=7) and t.status not in (Status.DONE, Status.CANCELLED)], key=lambda t: t.deadline)
        return Dashboard(date=today, today=daily, overdue=overdue, upcoming=upcoming, completedCount=sum(t.status == Status.DONE for t in daily))


def create_task_router(service: TaskService):
    router = APIRouter(prefix='/api/v1', tags=['Задачи'])
    bearer = HTTPBearer(auto_error=False)

    def authenticated(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if not credentials:
            raise unauthorized()
        return service.accounts.current_user(credentials.credentials)

    User = Annotated[PublicUser, Depends(authenticated)]

    @router.get('/tasks', response_model=list[TaskRead])
    def list_tasks(user: User):
        return service.list(user.id)

    @router.post('/tasks', response_model=TaskRead, status_code=201)
    def create_task(data: TaskFields, user: User):
        return service.create(data, user)

    @router.get('/tasks/{task_id}', response_model=TaskRead)
    def get_task(task_id: UUID, user: User):
        return service.get(task_id, user.id)

    @router.patch('/tasks/{task_id}', response_model=TaskRead)
    def update_task(task_id: UUID, data: TaskPatch, user: User):
        return service.update(task_id, data, user.id)

    @router.delete('/tasks/{task_id}', status_code=204)
    def delete_task(task_id: UUID, user: User):
        service.delete(task_id, user.id)

    @router.get('/dashboard', response_model=Dashboard)
    def dashboard(user: User):
        return service.dashboard(user)

    return router
