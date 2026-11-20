import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

import jwt
import pytest
from fastapi.testclient import TestClient
from app.accounts import AuthSettings
from app.main import create_app

PASSWORD = 'Local-test-password-42'


@pytest.fixture
def settings(tmp_path):
    return AuthSettings(_env_file=None, database_path=tmp_path / 'accounts.sqlite3', secret_path=tmp_path / 'jwt.key')


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def register(client, **overrides):
    return client.post('/api/v1/auth/register', json=dict(email='student@example.com', password=PASSWORD, firstName='Иван', lastName='Иванов', studyGroup=None, timezone='Europe/Moscow') | overrides)


def bearer(token):
    return {'Authorization': 'Bearer ' + token}


def test_register_me_normalization_and_password_storage(client, settings):
    result = register(client, email='  STUDENT@EXAMPLE.COM ', firstName=' Иван ')
    assert result.status_code == 201
    body = result.json()
    assert body['user']['email'] == 'student@example.com'
    assert body['user']['firstName'] == 'Иван'
    assert 'password' not in str(body)
    cookie = result.headers['set-cookie']
    assert 'HttpOnly' in cookie and 'SameSite=strict' in cookie and 'Path=/api/v1/auth' in cookie
    assert client.get('/api/v1/me', headers=bearer(body['accessToken'])).json() == body['user']
    with sqlite3.connect(settings.database_path) as db:
        password_hash = db.execute('SELECT password_hash FROM users').fetchone()[0]
        token_hash = db.execute('SELECT refresh_token_hash FROM sessions').fetchone()[0]
    assert password_hash.startswith('$argon2id$') and PASSWORD not in password_hash
    assert client.cookies['refresh_token'] not in token_hash


def test_duplicate_email_is_case_insensitive(client):
    assert register(client).status_code == 201
    response = register(client, email='STUDENT@example.com')
    assert response.status_code == 409
    assert response.json()['error']['code'] == 'EMAIL_TAKEN'


@pytest.mark.parametrize('override', [dict(password='short'), dict(firstName='   '), dict(email='broken'), dict(timezone='No/SuchZone')])
def test_validation_does_not_reflect_passwords(client, override):
    response = register(client, **override)
    assert response.status_code == 422
    assert PASSWORD not in response.text
    assert 'input' not in response.text


def test_login_wrong_credentials_and_lockout_persist(client, settings):
    register(client)
    for _ in range(4):
        assert client.post('/api/v1/auth/login', json={'email': 'student@example.com', 'password': 'wrong-password'}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'email': 'student@example.com', 'password': 'wrong-password'}).status_code == 429
    assert client.post('/api/v1/auth/login', json={'email': 'student@example.com', 'password': PASSWORD}).status_code == 429
    with TestClient(create_app(settings)) as restarted:
        assert restarted.post('/api/v1/auth/login', json={'email': 'student@example.com', 'password': PASSWORD}).status_code == 429
    with sqlite3.connect(settings.database_path) as db:
        db.execute('UPDATE users SET locked_until=?', (time.time() - 1,))
    assert client.post('/api/v1/auth/login', json={'email': 'student@example.com', 'password': PASSWORD}).status_code == 200


def test_unknown_user_has_same_error(client):
    response = client.post('/api/v1/auth/login', json={'email': 'missing@example.com', 'password': PASSWORD})
    assert response.status_code == 401
    assert response.json()['error']['code'] == 'INVALID_CREDENTIALS'


def test_refresh_rotation_logout_and_access_revocation(client):
    token = register(client).json()['accessToken']
    old_cookie = client.cookies['refresh_token']
    response = client.post('/api/v1/auth/refresh', json={})
    assert response.status_code == 200
    assert client.cookies['refresh_token'] != old_cookie
    current_cookie = client.cookies['refresh_token']
    assert client.post('/api/v1/auth/refresh', headers={'cookie': 'refresh_token=' + old_cookie}, json={}).status_code == 401
    client.cookies.set('refresh_token', current_cookie)
    assert client.post('/api/v1/auth/logout', json={}).status_code == 204
    assert client.get('/api/v1/me', headers=bearer(token)).status_code == 401
    assert client.post('/api/v1/auth/refresh', json={}).status_code == 401


def test_accounts_and_multiple_device_sessions_are_separate(client, settings):
    first = register(client).json()
    with TestClient(create_app(settings)) as other:
        second = register(other, email='other@example.com', firstName='Анна').json()
        assert other.get('/api/v1/me', headers=bearer(second['accessToken'])).json()['id'] != first['user']['id']
        login = other.post('/api/v1/auth/login', json={'email': 'student@example.com', 'password': PASSWORD})
        assert login.status_code == 200
        other.post('/api/v1/auth/logout', json={})
    assert client.get('/api/v1/me', headers=bearer(first['accessToken'])).status_code == 200


def test_restart_restores_accounts_and_session(client, settings):
    body = register(client).json()
    cookie = client.cookies['refresh_token']
    with TestClient(create_app(settings)) as restarted:
        assert restarted.get('/api/v1/me', headers=bearer(body['accessToken'])).status_code == 200
        response = restarted.post('/api/v1/auth/refresh', headers={'cookie': 'refresh_token=' + cookie}, json={})
        assert response.status_code == 200
        assert response.json()['user']['id'] == body['user']['id']


def test_missing_expired_and_tampered_tokens(client):
    body = register(client).json()
    assert client.get('/api/v1/me').status_code == 401
    assert client.get('/api/v1/me', headers=bearer(body['accessToken'] + 'broken')).status_code == 401
    claims = jwt.decode(body['accessToken'], options={'verify_signature': False})
    claims['exp'] = int(time.time()) - 1
    expired = jwt.encode(claims, client.app.state.accounts.secret, algorithm='HS256')
    assert client.get('/api/v1/me', headers=bearer(expired)).status_code == 401
    with client.app.state.accounts.transaction() as db:
        db.execute('UPDATE sessions SET expires_at=?', (time.time() - 1,))
    assert client.post('/api/v1/auth/refresh', json={}).status_code == 401


def test_browser_cross_origin_requests_rejected(client):
    response = client.post('/api/v1/auth/register', headers={'Origin': 'https://unrelated.example'}, json={})
    assert response.status_code == 403
    assert register(client).status_code == 201
    assert client.post('/api/v1/auth/logout', headers={'Sec-Fetch-Site': 'cross-site'}, json={}).status_code == 403


def test_old_unowned_task_api_not_exposed(client):
    assert client.get('/tasks').status_code == 404


def test_concurrent_refresh_only_one_succeeds(client):
    register(client)
    service = client.app.state.accounts
    token = client.cookies['refresh_token']
    def rotate():
        from app.accounts import AccountError
        try:
            service.refresh(token)
            return 200
        except AccountError as error:
            return error.status
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: rotate(), range(2))) == [200, 401]
