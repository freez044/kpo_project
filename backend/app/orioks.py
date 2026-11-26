"""Read-only ОРИОКС integration, fixed HTTPS origin, encrypted per-user token."""
import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
import re
import secrets
import socket
import ssl
import time
from typing import Annotated
from urllib.error import HTTPError, URLError
from urllib.request import Request as URLRequest, build_opener, HTTPSHandler, HTTPRedirectHandler

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, SecretStr, ValidationError, field_validator
from app.accounts import AccountService, AccountError, PublicUser, unauthorized


class ConnectInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    login: str = Field(min_length=1, max_length=200)
    password: SecretStr = Field(min_length=1, max_length=1024)

    @field_validator('login')
    @classmethod
    def login_valid(cls, value):
        value = value.strip()
        if not value or ':' in value or any(ord(c) < 32 for c in value):
            raise ValueError('Некорректный логин')
        return value


class Student(BaseModel):
    full_name: str = Field(max_length=500)
    group: str = Field(max_length=100)
    course: int | None = None
    semester: int | None = None
    year: str | None = None


class Event(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    alias: str | None = Field(default=None, max_length=500)
    name: str | None = Field(default=None, max_length=1000)
    type: str = Field(max_length=500)
    week: int = Field(ge=1, le=60)
    current_grade: float | None = None
    max_grade: float = Field(ge=0)


class Discipline(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    id: int = Field(gt=0)
    name: str = Field(max_length=500)
    department: str = Field(default='', max_length=500)
    teachers: list[str] | None = None
    control_form: str | None = None
    exam_date: str | None = None
    current_grade: float | None = None
    max_grade: float = Field(ge=0)
    events: list[Event] = []


class Snapshot(BaseModel):
    student: Student
    disciplines: list[Discipline]
    syncedAt: str


class Connection(BaseModel):
    connected: bool
    needsReconnect: bool = False
    lastError: str | None = None
    snapshot: Snapshot | None = None


def unavailable():
    return AccountError(503, 'ORIOKS_UNAVAILABLE', 'ОРИОКС временно недоступен. Попробуйте обновить данные позже.')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class OrioksClient:
    def __init__(self):
        self.opener = build_opener(HTTPSHandler(context=ssl.create_default_context()), NoRedirect())

    def get(self, path, *, token=None, credentials=None, deadline=None, method='GET'):
        if deadline is not None and time.monotonic() >= deadline:
            raise unavailable()
        headers = {'Accept': 'application/json', 'User-Agent': 'adaptive_planner/0.4 Windows'}
        if credentials:
            headers['Authorization'] = 'Basic ' + base64.b64encode(f'{credentials[0]}:{credentials[1]}'.encode()).decode()
        elif token:
            headers['Authorization'] = 'Bearer ' + token
        timeout = min(8, max(.1, deadline - time.monotonic())) if deadline else 8
        request = URLRequest('https://orioks.miet.ru/api/v1' + path, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=timeout) as response:
                raw = response.read(4_000_001)
                if len(raw) > 4_000_000:
                    raise ValueError('response too large')
                return json.loads(raw)
        except HTTPError as error:
            if error.code == 401:
                raise AccountError(400, 'ORIOKS_AUTH_FAILED', 'Неверный логин или пароль ОРИОКС.' if credentials else 'Ключ ОРИОКС отозван. Отключите интеграцию и подключитесь заново.') from None
            if credentials and error.code == 403:
                raise AccountError(409, 'ORIOKS_TOKEN_LIMIT', 'ОРИОКС не выдал ключ. Возможно, достигнут лимит восьми подключений. Проверьте активные ключи в ОРИОКС.') from None
            if method == 'DELETE' and error.code == 400:
                return None  # documented already revoked/nonexistent token response
            if error.code == 410:
                raise AccountError(502, 'ORIOKS_API_CHANGED', 'Версия API ОРИОКС изменилась. Интеграция требует обновления.') from None
            raise unavailable() from None
        except (URLError, TimeoutError, socket.timeout, OSError):
            raise unavailable() from None
        except (ValueError, UnicodeError):
            raise AccountError(502, 'ORIOKS_BAD_RESPONSE', 'ОРИОКС вернул неожиданные данные. Сохранённые данные не изменены.') from None


class OrioksService:
    def __init__(self, accounts: AccountService, client=None):
        self.accounts = accounts
        self.client = client or OrioksClient()
        self.cipher = None

    def initialize(self):
        key_path = self.accounts.settings.orioks_key_path or self.accounts.settings.database_path.parent / 'orioks.key'
        key_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            descriptor = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, 'wb') as file:
                file.write(AESGCM.generate_key(bit_length=256))
        self.cipher = AESGCM(key_path.read_bytes())
        with self.accounts.transaction() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS orioks_connections (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    token_encrypted BLOB NOT NULL, snapshot TEXT,
                    needs_reconnect INTEGER NOT NULL DEFAULT 0, last_error TEXT
                );
                CREATE TABLE IF NOT EXISTS orioks_operations (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    operation_id TEXT NOT NULL, busy_until REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS orioks_connect_attempts (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    window_start REAL NOT NULL, attempts INTEGER NOT NULL
                );
            ''')

    @contextmanager
    def operation(self, user_id):
        operation_id = secrets.token_hex(16)
        with self.accounts.transaction() as db:
            row = db.execute('SELECT busy_until FROM orioks_operations WHERE user_id=?', (user_id,)).fetchone()
            if row and row['busy_until'] > time.time():
                raise AccountError(409, 'ORIOKS_BUSY', 'Обновление ОРИОКС уже выполняется. Подождите немного.')
            db.execute('INSERT OR REPLACE INTO orioks_operations VALUES (?,?,?)', (user_id, operation_id, time.time() + 70))
        try:
            yield time.monotonic() + 45
        finally:
            with self.accounts.transaction() as db:
                db.execute('DELETE FROM orioks_operations WHERE user_id=? AND operation_id=?', (user_id, operation_id))

    def connection(self, user_id):
        with self.accounts.transaction() as db:
            row = db.execute('SELECT * FROM orioks_connections WHERE user_id=?', (user_id,)).fetchone()
        return row

    def status(self, user_id):
        row = self.connection(user_id)
        return Connection(connected=row is not None, needsReconnect=bool(row and row['needs_reconnect']), lastError=row['last_error'] if row else None, snapshot=Snapshot.model_validate_json(row['snapshot']) if row and row['snapshot'] else None)

    def encrypt(self, user_id, token):
        nonce = os.urandom(12)
        return nonce + self.cipher.encrypt(nonce, token.encode(), user_id.encode())

    def decrypt(self, user_id, encrypted):
        try:
            return self.cipher.decrypt(encrypted[:12], encrypted[12:], user_id.encode()).decode()
        except (InvalidTag, ValueError, UnicodeError):
            raise AccountError(503, 'ORIOKS_KEY_UNAVAILABLE', 'Не удалось прочитать ключ подключения ОРИОКС. Проверьте файл ключа шифрования на сервере.') from None

    def sync_with_token(self, user_id, token, deadline):
        try:
            student = Student.model_validate(self.client.get('/student', token=token, deadline=deadline))
            data = self.client.get('/student/disciplines', token=token, deadline=deadline)
            if not isinstance(data, list) or len(data) > 150:
                raise ValueError('invalid disciplines')
            disciplines = []
            for item in data:
                subject = Discipline.model_validate(item)
                raw_events = self.client.get(f'/student/disciplines/{subject.id}/events', token=token, deadline=deadline)
                if not isinstance(raw_events, list) or len(raw_events) > 1000:
                    raise ValueError('invalid events')
                subject.events = [Event.model_validate(event) for event in raw_events]
                disciplines.append(subject)
            snapshot = Snapshot(student=student, disciplines=disciplines, syncedAt=datetime.now(timezone.utc).isoformat())
            with self.accounts.transaction() as db:
                db.execute('UPDATE orioks_connections SET snapshot=?,needs_reconnect=0,last_error=NULL WHERE user_id=?', (snapshot.model_dump_json(), user_id))
                db.execute('UPDATE users SET study_group=? WHERE id=?', (student.group, user_id))
        except (ValidationError, ValueError, TypeError):
            error = AccountError(502, 'ORIOKS_BAD_RESPONSE', 'Структура данных ОРИОКС отличается от ожидаемой. Последняя успешная загрузка сохранена.')
            self.record_error(user_id, error)
            raise error from None
        except AccountError as error:
            self.record_error(user_id, error)
            raise

    def record_error(self, user_id, error):
        with self.accounts.transaction() as db:
            db.execute('UPDATE orioks_connections SET last_error=?,needs_reconnect=? WHERE user_id=?', (error.message, int(error.code == 'ORIOKS_AUTH_FAILED'), user_id))

    def connect(self, user_id, data):
        with self.operation(user_id) as deadline:
            if self.connection(user_id):
                raise AccountError(409, 'ORIOKS_ALREADY_CONNECTED', 'ОРИОКС уже подключён. Используйте обновление данных.')
            with self.accounts.transaction() as db:
                row = db.execute('SELECT * FROM orioks_connect_attempts WHERE user_id=?', (user_id,)).fetchone()
                now = time.time()
                if row and row['window_start'] > now - 900 and row['attempts'] >= 5:
                    raise AccountError(429, 'TOO_MANY_ATTEMPTS', 'Слишком много попыток подключения. Повторите через 15 минут.')
                attempts = row['attempts'] + 1 if row and row['window_start'] > now - 900 else 1
                db.execute('INSERT OR REPLACE INTO orioks_connect_attempts VALUES (?,?,?)', (user_id, row['window_start'] if attempts > 1 else now, attempts))
            result = self.client.get('/auth', credentials=(data.login, data.password.get_secret_value()), deadline=deadline)
            token = result.get('token') if isinstance(result, dict) else None
            if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9]{32}', token):
                raise AccountError(502, 'ORIOKS_BAD_RESPONSE', 'ОРИОКС не вернул корректный ключ подключения.')
            # Save the newly minted key BEFORE further calls; retrying sync must not mint another.
            try:
                with self.accounts.transaction() as db:
                    db.execute('INSERT INTO orioks_connections (user_id,token_encrypted) VALUES (?,?)', (user_id, self.encrypt(user_id, token)))
            except Exception:
                try:
                    self.client.get('/student/tokens/' + token, token=token, method='DELETE', deadline=deadline)
                except Exception:
                    pass
                raise
            self.sync_with_token(user_id, token, deadline)
        return self.status(user_id)

    def sync(self, user_id):
        with self.operation(user_id) as deadline:
            row = self.connection(user_id)
            if row is None:
                raise AccountError(409, 'ORIOKS_NOT_CONNECTED', 'Сначала подключите ОРИОКС.')
            self.sync_with_token(user_id, self.decrypt(user_id, row['token_encrypted']), deadline)
        return self.status(user_id)

    def disconnect(self, user_id):
        with self.operation(user_id) as deadline:
            row = self.connection(user_id)
            if row:
                token = self.decrypt(user_id, row['token_encrypted'])
                try:
                    self.client.get('/student/tokens/' + token, token=token, method='DELETE', deadline=deadline)
                except AccountError as error:
                    if error.code != 'ORIOKS_AUTH_FAILED':
                        raise
                with self.accounts.transaction() as db:
                    db.execute('DELETE FROM orioks_connections WHERE user_id=?', (user_id,))
                    for table in ('orioks_planning', 'orioks_previews'):
                        if db.execute('SELECT name FROM sqlite_master WHERE type=? AND name=?', ('table', table)).fetchone():
                            db.execute(f'DELETE FROM {table} WHERE user_id=?', (user_id,))


def create_orioks_router(service: OrioksService):
    router = APIRouter(prefix='/api/v1/orioks', tags=['ОРИОКС'])
    bearer = HTTPBearer(auto_error=False)

    def authenticated(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if not credentials:
            raise unauthorized()
        return service.accounts.current_user(credentials.credentials)

    User = Annotated[PublicUser, Depends(authenticated)]

    @router.get('/connection', response_model=Connection)
    def status(user: User):
        return service.status(user.id)

    @router.post('/connection', response_model=Connection)
    def connect(data: ConnectInput, user: User):
        return service.connect(user.id, data)

    @router.post('/sync', response_model=Connection)
    def sync(user: User):
        return service.sync(user.id)

    @router.delete('/connection', status_code=204)
    def disconnect(user: User):
        service.disconnect(user.id)

    return router
