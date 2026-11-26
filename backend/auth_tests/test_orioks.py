import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app.accounts import AccountError
from app.main import create_app
from app.orioks import OrioksClient, unavailable
from test_accounts import settings, register, bearer

TOKEN = '0123456789ABCDEFGHIJKLMNOPQRSTUV'
PASSWORD = 'orioks-test-secret'


class FakeOrioks:
    def __init__(self):
        self.calls = []
        self.fail_events = False
        self.auth_failure = False
        self.revoked = False
        self.malformed = False
    def get(self, path, **kwargs):
        self.calls.append((path, kwargs))
        if path == '/auth':
            if self.auth_failure:
                raise AccountError(400, 'ORIOKS_AUTH_FAILED', 'Неверный логин или пароль ОРИОКС.')
            return {'token': TOKEN}
        if kwargs.get('method') == 'DELETE':
            if self.revoked:
                raise AccountError(400, 'ORIOKS_AUTH_FAILED', 'Ключ отозван')
            return {'info': 'Токен успешно аннулирован'}
        if self.revoked:
            raise AccountError(400, 'ORIOKS_AUTH_FAILED', 'Ключ отозван')
        if path == '/student':
            return {'full_name': 'Тестовый Студент', 'group': 'ПИН-31', 'year': '2026-2027', 'record_book_id': 1234567}
        if path == '/student/disciplines':
            return [{'id': 42, 'name': 'Базы данных', 'max_grade': 100, 'teachers': ['Преподаватель']}]
        if self.fail_events:
            raise unavailable()
        if self.malformed:
            return [{'type': 'Лабораторная работа', 'week': 0}]
        return [
            {'alias': 'ЛР.1', 'name': 'Первая лабораторная', 'type': 'Лабораторная работа', 'week': 2, 'max_grade': 10},
            {'type': 'Лабораторная работа', 'week': 4, 'max_grade': 10, 'current_grade': 0},
            {'type': 'Контрольная работа', 'week': 6, 'max_grade': 10, 'current_grade': -1},
        ]


@pytest.fixture
def integration(settings):
    upstream = FakeOrioks()
    with TestClient(create_app(settings, orioks_client=upstream)) as client:
        auth = register(client).json()
        client.headers.update(bearer(auth['accessToken']))
        yield client, upstream, auth['user']['id']


def connect(client):
    return client.post('/api/v1/orioks/connection', json={'login': 'student-login', 'password': PASSWORD})


def test_connection_snapshot_secrets_and_no_task_creation(integration, settings):
    client, upstream, user_id = integration
    response = connect(client)
    assert response.status_code == 200
    body = response.json()
    assert body['connected'] and body['snapshot']['student']['group'] == 'ПИН-31'
    assert TOKEN not in response.text and PASSWORD not in response.text
    assert 'record_book_id' not in response.text
    events = body['snapshot']['disciplines'][0]['events']
    assert [e['current_grade'] for e in events] == [None, 0, -1]
    assert 'deadline' not in events[0]
    assert client.get('/api/v1/tasks').json() == []
    assert client.get('/api/v1/me').json()['studyGroup'] == 'ПИН-31'
    with sqlite3.connect(settings.database_path) as db:
        row = db.execute('SELECT token_encrypted,snapshot FROM orioks_connections WHERE user_id=?', (user_id,)).fetchone()
    assert TOKEN.encode() not in row[0] and PASSWORD.encode() not in row[0]
    assert TOKEN not in row[1] and PASSWORD not in row[1]
    assert client.app.state.orioks.decrypt(user_id, row[0]) == TOKEN


def test_refresh_and_restart_do_not_issue_another_token(integration, settings):
    client, upstream, _ = integration
    connect(client)
    assert connect(client).status_code == 409
    assert client.post('/api/v1/orioks/sync', json={}).status_code == 200
    with TestClient(create_app(settings, orioks_client=upstream)) as restarted:
        restarted.headers.update({'Authorization': client.headers['Authorization']})
        assert restarted.get('/api/v1/orioks/connection').json()['snapshot']
        assert restarted.post('/api/v1/orioks/sync', json={}).status_code == 200
    assert sum(path == '/auth' for path, _ in upstream.calls) == 1


def test_connect_saves_token_even_if_initial_snapshot_fails(integration):
    client, upstream, _ = integration
    upstream.fail_events = True
    assert connect(client).status_code == 503
    status = client.get('/api/v1/orioks/connection').json()
    assert status['connected'] and status['snapshot'] is None
    upstream.fail_events = False
    assert client.post('/api/v1/orioks/sync', json={}).status_code == 200
    assert sum(path == '/auth' for path, _ in upstream.calls) == 1


@pytest.mark.parametrize('mode', ['fail_events', 'malformed', 'revoked'])
def test_failed_sync_keeps_previous_snapshot(integration, mode):
    client, upstream, _ = integration
    previous = connect(client).json()['snapshot']
    setattr(upstream, mode, True)
    response = client.post('/api/v1/orioks/sync', json={})
    assert response.status_code in (400, 502, 503)
    status = client.get('/api/v1/orioks/connection').json()
    assert status['snapshot'] == previous and status['lastError']
    assert status['needsReconnect'] == (mode == 'revoked')


def test_other_users_cannot_see_or_disconnect_connection(integration, settings):
    client, upstream, _ = integration
    connect(client)
    with TestClient(create_app(settings, orioks_client=upstream)) as other:
        auth = register(other, email='other@example.com').json()
        other.headers.update(bearer(auth['accessToken']))
        assert other.get('/api/v1/orioks/connection').json()['connected'] is False
        assert other.post('/api/v1/orioks/sync', json={}).status_code == 409
        assert other.delete('/api/v1/orioks/connection').status_code == 204
    assert client.get('/api/v1/orioks/connection').json()['connected']


def test_disconnect_revokes_only_current_integration_key(integration):
    client, upstream, _ = integration
    connect(client)
    client.post('/api/v1/tasks', json={'title': 'Оставить задачу'})
    assert client.delete('/api/v1/orioks/connection').status_code == 204
    assert client.get('/api/v1/orioks/connection').json()['connected'] is False
    assert len(client.get('/api/v1/tasks').json()) == 1
    revoked = [(path, data) for path, data in upstream.calls if data.get('method') == 'DELETE']
    assert len(revoked) == 1 and revoked[0][0] == '/student/tokens/' + TOKEN


def test_active_operation_prevents_concurrent_token_creation(integration):
    client, upstream, user_id = integration
    with client.app.state.orioks.operation(user_id):
        assert connect(client).status_code == 409
    assert upstream.calls == []


def test_auth_failure_and_rate_limit(integration):
    client, upstream, _ = integration
    upstream.auth_failure = True
    for _ in range(5):
        response = connect(client)
        assert response.status_code == 400
        assert PASSWORD not in response.text
    assert connect(client).status_code == 429
    assert client.get('/api/v1/orioks/connection').json()['connected'] is False


def test_encryption_is_bound_to_local_user(integration):
    client, upstream, user_id = integration
    connect(client)
    row = client.app.state.orioks.connection(user_id)
    with pytest.raises(AccountError):
        client.app.state.orioks.decrypt('different-user', row['token_encrypted'])


def test_all_routes_require_authentication(settings):
    with TestClient(create_app(settings, orioks_client=FakeOrioks())) as client:
        assert client.get('/api/v1/orioks/connection').status_code == 401
        assert client.post('/api/v1/orioks/connection', json={'login': 'test', 'password': PASSWORD}).status_code == 401
        assert client.post('/api/v1/orioks/sync', json={}).status_code == 401
        assert client.delete('/api/v1/orioks/connection').status_code == 401


def test_fixed_origin_headers_and_redirect_rejection():
    from app.orioks import NoRedirect
    client = OrioksClient()
    captured = []
    class Reply:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self, size): return b'{"token":"' + TOKEN.encode() + b'"}'
    class Opener:
        def open(self, request, timeout):
            captured.append(request)
            return Reply()
    client.opener = Opener()
    assert client.get('/auth', credentials=('test', PASSWORD))['token'] == TOKEN
    request = captured[0]
    assert request.full_url == 'https://orioks.miet.ru/api/v1/auth'
    assert request.headers['Accept'] == 'application/json'
    assert request.headers['Authorization'].startswith('Basic ')
    assert NoRedirect().redirect_request(None, None, 302, '', {}, 'http://other.example') is None
