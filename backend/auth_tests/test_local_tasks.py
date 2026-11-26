from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from test_accounts import settings, client, register, bearer


@pytest.fixture
def authorized(client):
    auth = register(client).json()
    client.headers.update(bearer(auth['accessToken']))
    return client


def task(client, **fields):
    return client.post('/api/v1/tasks', json={'title': 'Подготовить лабораторную', 'category': 'Учёба', **fields})


def test_create_edit_list_and_completion(authorized):
    created = task(authorized, title='  Лабораторная  ').json()
    assert created['title'] == 'Лабораторная'
    assert created['plannedDate'] == authorized.get('/api/v1/dashboard').json()['date']
    assert authorized.get('/api/v1/tasks').json() == [created]
    updated = authorized.patch('/api/v1/tasks/' + created['id'], json={'description': 'Описание', 'priority': 'HIGH', 'status': 'IN_PROGRESS'}).json()
    assert updated['description'] == 'Описание' and updated['status'] == 'IN_PROGRESS'
    done = authorized.patch('/api/v1/tasks/' + created['id'], json={'status': 'DONE'}).json()
    assert done['completedAt'] is not None
    again = authorized.patch('/api/v1/tasks/' + created['id'], json={'status': 'DONE'}).json()
    assert again['completedAt'] == done['completedAt']
    reopened = authorized.patch('/api/v1/tasks/' + created['id'], json={'status': 'PLANNED'}).json()
    assert reopened['completedAt'] is None


def test_owner_is_enforced_on_every_operation(authorized, settings):
    created = task(authorized).json()
    with TestClient(create_app(settings)) as other:
        auth = register(other, email='another@example.com').json()
        other.headers.update(bearer(auth['accessToken']))
        assert other.get('/api/v1/tasks').json() == []
        assert other.get('/api/v1/dashboard').json()['today'] == []
        path = '/api/v1/tasks/' + created['id']
        assert other.get(path).status_code == 404
        assert other.patch(path, json={'title': 'Чужое изменение'}).status_code == 404
        assert other.delete(path).status_code == 404
        assert task(other, userId=created['id']).status_code == 422
    assert authorized.get('/api/v1/tasks/' + created['id']).json()['title'] == created['title']


def test_delete_is_permanent_and_scoped(authorized):
    created = task(authorized).json()
    path = '/api/v1/tasks/' + created['id']
    assert authorized.delete(path).status_code == 204
    assert authorized.get(path).status_code == 404
    assert authorized.delete(path).status_code == 404
    assert authorized.get('/api/v1/tasks').json() == []


@pytest.mark.parametrize('fields', [{'title': '  '}, {'title': None}, {'title': 'x' * 201}, {'description': None}, {'description': 'x' * 10001}, {'priority': 'HIGHEST'}, {'status': 'unknown'}, {'deadline': '2026-12-01T10:00:00'}, {'plannedDate': 'tomorrow'}, {'category': '  '}])
def test_invalid_data_never_persists(authorized, fields):
    assert task(authorized, **fields).status_code == 422
    assert authorized.get('/api/v1/tasks').json() == []


@pytest.mark.parametrize('field', ['title', 'description', 'priority', 'status'])
def test_null_required_patch_fields_rejected(authorized, field):
    created = task(authorized).json()
    path = '/api/v1/tasks/' + created['id']
    assert authorized.patch(path, json={field: None}).status_code == 422
    assert authorized.get(path).json()['title'] == created['title']


def test_clear_optional_fields_and_timezone_normalization(authorized):
    created = task(authorized, deadline='2030-01-01T12:00:00+03:00').json()
    assert datetime.fromisoformat(created['deadline']) == datetime(2030, 1, 1, 9, tzinfo=timezone.utc)
    changed = authorized.patch('/api/v1/tasks/' + created['id'], json={'deadline': None, 'plannedDate': None, 'category': None}).json()
    assert changed['deadline'] is changed['plannedDate'] is changed['category'] is None


def test_dashboard_real_dates_overdue_and_upcoming(authorized):
    now = datetime.now(timezone.utc)
    old = task(authorized, deadline=(now - timedelta(days=2)).isoformat()).json()
    soon = task(authorized, deadline=(now + timedelta(days=2)).isoformat(), plannedDate='2030-01-01').json()
    task(authorized, deadline=(now + timedelta(days=20)).isoformat(), plannedDate=None)
    task(authorized, status='CANCELLED', deadline=(now - timedelta(days=1)).isoformat())
    task(authorized, status='DONE', deadline=(now - timedelta(days=1)).isoformat())
    summary = authorized.get('/api/v1/dashboard').json()
    assert [t['id'] for t in summary['overdue']] == [old['id']]
    assert [t['id'] for t in summary['upcoming']] == [soon['id']]
    assert len(summary['today']) == 2 and summary['completedCount'] == 1
    authorized.patch('/api/v1/tasks/' + old['id'], json={'status': 'DONE'})
    assert authorized.get('/api/v1/dashboard').json()['overdue'] == []


def test_persistence_after_restart(authorized, settings):
    created = task(authorized, description='Не терять после перезапуска').json()
    with TestClient(create_app(settings)) as restarted:
        restarted.headers.update({'Authorization': authorized.headers['Authorization']})
        assert restarted.get('/api/v1/tasks/' + created['id']).json() == created


def test_all_task_routes_require_login(client):
    path = '/api/v1/tasks/00000000-0000-0000-0000-000000000000'
    assert client.get('/api/v1/tasks').status_code == 401
    assert client.get('/api/v1/dashboard').status_code == 401
    assert client.get(path).status_code == 401
    assert client.post('/api/v1/tasks', json={'title': 'Без входа'}).status_code == 401
    assert client.patch(path, json={'title': 'Без входа'}).status_code == 401
    assert client.delete(path).status_code == 401


def test_kanban_moves_preserve_task_details_and_survive_reload(authorized):
    created = task(authorized, description='Переносим только статус', priority='HIGH', deadline='2030-01-01T18:00:00+03:00', plannedDate='2029-12-30').json()
    path = '/api/v1/tasks/' + created['id']
    for status in ['BACKLOG', 'PLANNED', 'IN_PROGRESS', 'IN_HOLD', 'DONE', 'CANCELLED', 'PLANNED']:
        response = authorized.patch(path, json={'status': status})
        assert response.status_code == 200
        reloaded = authorized.get(path).json()
        assert reloaded['status'] == status
        assert (reloaded['completedAt'] is not None) == (status == 'DONE')
        for field in ['title', 'description', 'deadline', 'plannedDate', 'priority', 'category']:
            assert reloaded[field] == created[field]
