import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.password_reset import ResetConfirm, SMTPMailer
from test_accounts import settings, register, bearer, PASSWORD

NEW_PASSWORD = 'New-local-test-password-42'
EMAIL = 'student@example.com'


class TestMailer:
    __test__ = False
    configured = True
    def __init__(self):
        self.sent = []
        self.fail = False
    def send_code(self, email, code):
        if self.fail:
            raise RuntimeError('Test SMTP unavailable')
        self.sent.append((email, code))


@pytest.fixture
def recovery(settings):
    mailer = TestMailer()
    with TestClient(create_app(settings, mailer=mailer)) as client:
        yield client, mailer


def request(client, email=EMAIL):
    return client.post('/api/v1/auth/password/request', json={'email': email})


def reset(client, code, email=EMAIL, password=NEW_PASSWORD):
    return client.post('/api/v1/auth/password/reset', json={'email': email, 'code': code, 'newPassword': password})


def release_cooldown(settings):
    with sqlite3.connect(settings.database_path) as db:
        db.execute('UPDATE password_reset_limits SET next_allowed=0')


def test_reset_changes_password_revokes_sessions_preserves_user_data(recovery, settings):
    client, mailer = recovery
    auth = register(client).json()
    headers = bearer(auth['accessToken'])
    client.post('/api/v1/tasks', headers=headers, json={'title': 'Сохранить мои задачи'})
    result = request(client)
    assert result.status_code == 202
    assert len(mailer.sent) == 1
    code = mailer.sent[0][1]
    assert len(code) == 6 and code.isdigit() and code not in result.text
    assert reset(client, code).status_code == 204
    assert client.get('/api/v1/me', headers=headers).status_code == 401
    assert client.post('/api/v1/auth/refresh', json={}).status_code == 401
    assert client.post('/api/v1/auth/login', json={'email': EMAIL, 'password': PASSWORD}).status_code == 401
    login = client.post('/api/v1/auth/login', json={'email': EMAIL, 'password': NEW_PASSWORD})
    assert login.status_code == 200
    assert login.json()['user']['id'] == auth['user']['id']
    assert client.get('/api/v1/tasks', headers=bearer(login.json()['accessToken'])).json()[0]['title'] == 'Сохранить мои задачи'
    assert reset(client, code).status_code == 400


def test_unknown_email_has_same_response_and_no_email(recovery):
    client, mailer = recovery
    register(client)
    known = request(client)
    unknown = request(client, 'missing@example.com')
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert len(mailer.sent) == 1
    assert reset(client, '123456', email='missing@example.com').status_code == 400


def test_codes_not_plaintext_in_database(recovery, settings):
    client, mailer = recovery
    register(client)
    request(client)
    code = mailer.sent[0][1]
    with sqlite3.connect(settings.database_path) as db:
        row = db.execute('SELECT code_hash,attempts,delivered FROM password_resets').fetchone()
    assert len(row[0]) == 64 and code not in row[0]
    assert row[1:] == (0, 1)


def test_expired_code_rejected(recovery, settings):
    client, mailer = recovery
    register(client)
    request(client)
    with sqlite3.connect(settings.database_path) as db:
        db.execute('UPDATE password_resets SET expires_at=?', (time.time() - 1,))
    assert reset(client, mailer.sent[0][1]).status_code == 400


def test_five_wrong_attempts_consume_code_without_locking_login(recovery):
    client, mailer = recovery
    register(client)
    request(client)
    correct = mailer.sent[0][1]
    wrong = '000000' if correct != '000000' else '111111'
    for _ in range(5):
        assert reset(client, wrong).status_code == 400
    assert reset(client, correct).status_code == 400
    assert client.post('/api/v1/auth/login', json={'email': EMAIL, 'password': PASSWORD}).status_code == 200


def test_resend_invalidates_old_code_and_rate_limits(recovery, settings):
    client, mailer = recovery
    register(client)
    request(client)
    old_id = None
    with sqlite3.connect(settings.database_path) as db:
        old_id = db.execute('SELECT id FROM password_resets').fetchone()[0]
    assert request(client).status_code == 429
    release_cooldown(settings)
    request(client)
    with sqlite3.connect(settings.database_path) as db:
        assert db.execute('SELECT id FROM password_resets').fetchone()[0] != old_id
    assert len(mailer.sent) == 2
    # Every replacement has a fresh random code. Collision probability is 1e-6;
    # skip the old-code assertion if that happens, still verify one-time success.
    if mailer.sent[0][1] != mailer.sent[1][1]:
        assert reset(client, mailer.sent[0][1]).status_code == 400
    assert reset(client, mailer.sent[1][1]).status_code == 204
    release_cooldown(settings)
    assert request(client).status_code == 202
    release_cooldown(settings)
    assert request(client).status_code == 429


def test_email_bound_to_user(recovery):
    client, mailer = recovery
    register(client)
    register(client, email='other@example.com')
    request(client)
    assert reset(client, mailer.sent[0][1], email='other@example.com').status_code == 400
    assert reset(client, mailer.sent[0][1]).status_code == 204


def test_delivery_failure_is_not_exposed_and_code_not_active(recovery, caplog):
    client, mailer = recovery
    register(client)
    mailer.fail = True
    result = request(client)
    assert result.status_code == 202
    with client.app.state.accounts.transaction() as db:
        row = db.execute('SELECT delivered,used_at FROM password_resets').fetchone()
    assert row['delivered'] == 0 and row['used_at'] is not None
    assert EMAIL not in caplog.text and 'Test SMTP' not in caplog.text


def test_no_mail_configuration_returns_clear_error(settings):
    with TestClient(create_app(settings)) as client:
        assert request(client).status_code == 503
        assert request(client, 'missing@example.com').status_code == 503


def test_reset_code_survives_restart(recovery, settings):
    client, mailer = recovery
    register(client)
    request(client)
    with TestClient(create_app(settings, mailer=TestMailer())) as restarted:
        assert reset(restarted, mailer.sent[0][1]).status_code == 204


def test_concurrent_code_use_only_once(recovery):
    client, mailer = recovery
    register(client)
    request(client)
    data = ResetConfirm(email=EMAIL, code=mailer.sent[0][1], newPassword=NEW_PASSWORD)
    def consume(_):
        from app.accounts import AccountError
        try:
            client.app.state.password_resets.confirm(data, 'testclient')
            return 204
        except AccountError as error:
            return error.status
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(consume, range(2))) == [204, 400]


@pytest.mark.parametrize('body', [{'email': EMAIL, 'code': '12345', 'newPassword': NEW_PASSWORD}, {'email': EMAIL, 'code': '１２３４５６', 'newPassword': NEW_PASSWORD}, {'email': EMAIL, 'code': '123456', 'newPassword': 'short'}])
def test_invalid_reset_fields(recovery, body):
    client, _ = recovery
    result = client.post('/api/v1/auth/password/reset', json=body)
    assert result.status_code == 422
    assert body['newPassword'] not in result.text


def test_smtp_requires_tls_before_credentials(settings, monkeypatch):
    from pydantic import SecretStr
    settings.smtp_host = 'smtp.example.com'
    settings.smtp_from = 'sender@example.com'
    settings.smtp_username = 'sender@example.com'
    settings.smtp_password = SecretStr('fake-test-only-password')
    settings.smtp_starttls = True
    events = []
    class SMTP:
        def __init__(self, *args, **kwargs): events.append('connect')
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def ehlo(self): events.append('ehlo')
        def starttls(self, **kwargs):
            assert kwargs['context'].check_hostname
            events.append('tls')
        def login(self, *args): events.append('login')
        def send_message(self, message):
            assert message['To'] == EMAIL
            assert '123456' in message.get_content()
            events.append('send')
            return {}
    monkeypatch.setattr('app.password_reset.smtplib.SMTP', SMTP)
    SMTPMailer(settings).send_code(EMAIL, '123456')
    assert events.index('tls') < events.index('login') < events.index('send')
