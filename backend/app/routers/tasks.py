from fastapi import APIRouter, HTTPException

from app.schemas.task import *
from app.exceptions import TaskNotFoundError
from app.statuses import TaskStatus
router = APIRouter(
    prefix = '/tasks',
    tags=["Tasks"]
)

tasks = [
    {
        'id':1,
        'title':"Изучить FastAPI",
        'est_duration': 60,
        'status': TaskStatus.BACKLOG
    }
]

def find_task(task_id: int) -> dict:
    for task in tasks:
        if task['id'] == task_id:
            return task
    raise TaskNotFoundError(f"Task with id = {task_id} is not found")


@router.get("/{task_id}", response_model=TaskRead)
def get_task(task_id: int):
    try:
        return find_task(task_id)
    except TaskNotFoundError:
        raise HTTPException(
            status_code=404,
            detail='Task not found'
        )


@router.post("", response_model = TaskRead)
def create_task(task: TaskCreate):
    print("Функция была вызвана")

    
    new_task = {
        'id': task.id,
        'title': task.title,
        'est_duration': task.est_duration,
        'status': task.status
    }
    for t in tasks:
        if t['id'] == task.id:
            raise HTTPException(
                status_code=409,
                detail=f'Task with id = {task.id} already exists'
            )
    tasks.append(new_task)
    
    return {
        'title': task.title,
        'estimated_duration_minutes': task.estimated_duration_minutes
    }

@router.get("", response_model = list[TaskRead])
def get_tasks():
    return tasks


@router.patch("/{task_id}", response_model = TaskRead)
def update_task(task_id: int, data: TaskUpdate):
    try:
        task = find_task(task_id)
    except TaskNotFoundError:
        raise HTTPException(
            status_code=404,
            detail="Task not found"
        )
    
    if data.title is not None:
        task["title"] = data.title

    if data.estimated_duration_minutes is not None:
        task["estimated_duration_minutes"] = data.estimated_duration_minutes

    return task

@router.delete("/{task_id}", response_model = TaskRead)
def delete_task(task_id: int):
    try:
        task = find_task(task_id)
        tasks.remove(task)
        return task
    except TaskNotFoundError:
            raise HTTPException(
                status_code=404,
                detail="Task not found"
            )

    