"""Локальный адаптер аккаунтов. PostgreSQL-модели и миграции не меняются."""
import hashlib
import os
from pathlib import Path
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import APIRouter, Depends, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, EmailStr, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DATA_DIR = Path(__file__).resolve().parents[1] / 'data'
ACCESS_SECONDS = 900
REFRESH_SECONDS = 30 * 24 * 60 * 60


class AuthSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[2] / '.env', env_prefix='AUTH_', extra='ignore')
    database_path: Path = DATA_DIR / 'accounts.sqlite3'
    secret_path: Path = DATA_DIR / 'jwt.key'
    cookie_secure: bool = False  # Только для локального HTTP; для HTTPS включить.
    allowed_origins: list[str] = ['http://127.0.0.1:5173', 'http://localhost:5173']
    smtp_host: str = ''
    smtp_port: int = Field(default=465, ge=1, le=65535)
    smtp_username: str = ''
    smtp_password: SecretStr = SecretStr('')
    smtp_from: EmailStr | None = None
    smtp_starttls: bool = False  # False: implicit TLS; True: STARTTLS, usually port 587.
    orioks_key_path: Path | None = None  # Defaults next to the account database.


class AccountError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def unauthorized():
    return AccountError(401, 'UNAUTHORIZED', 'Войдите в аккаунт, чтобы продолжить.')


class Credentials(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: EmailStr = Field(max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator('email', mode='before')
    @classmethod
    def normalize_email(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class Registration(Credentials):
    firstName: str = Field(min_length=1, max_length=100)
    lastName: str = Field(min_length=1, max_length=100)
    studyGroup: str | None = Field(default=None, max_length=50)
    timezone: str = Field(default='Europe/Moscow', max_length=64)

    @field_validator('firstName', 'lastName', 'studyGroup', mode='before')
    @classmethod
    def trim_name(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                raise ValueError('Пустое поле')
        return value

    @field_validator('timezone')
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError('Неизвестный часовой пояс')
        return value


class PublicUser(BaseModel):
    id: str
    email: str
    firstName: str
    lastName: str
    studyGroup: str | None
    timezone: str


class AuthResult(BaseModel):
    accessToken: str
    expiresIn: int
    user: PublicUser


class AccountService:
    def __init__(self, settings: AuthSettings):
        self.settings = settings
        self.hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4)
        self.secret = ''
        self.dummy_hash = ''

    def initialize(self):
        self.settings.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings.secret_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            descriptor = os.open(self.settings.secret_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, 'w') as f:
                f.write(secrets.token_urlsafe(48))
        self.secret = self.settings.secret_path.read_text().strip()
        if len(self.secret) < 32:
            raise RuntimeError('Некорректный ключ подписи аккаунтов')
        self.dummy_hash = self.hasher.hash(secrets.token_urlsafe(32))
        with self.transaction() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    password_hash TEXT NOT NULL, first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL, study_group TEXT, timezone TEXT NOT NULL,
                    failed_login_count INTEGER NOT NULL DEFAULT 0,
                    locked_until REAL, created_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    refresh_token_hash TEXT NOT NULL UNIQUE, created_at REAL NOT NULL,
                    expires_at REAL NOT NULL, revoked_at REAL
                );
                CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
            ''')

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.settings.database_path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            # Сериализация ротации токенов и счётчиков между потоками/процессами.
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def check_database(self):
        with self.transaction() as db:
            db.execute('SELECT 1 FROM users LIMIT 1')

    @staticmethod
    def public(user):
        return PublicUser(id=user['id'], email=user['email'], firstName=user['first_name'], lastName=user['last_name'], studyGroup=user['study_group'], timezone=user['timezone'])

    @staticmethod
    def digest(token):
        return hashlib.sha256(token.encode()).hexdigest()

    def issue(self, db, user, session_id=None):
        now = time.time()
        refresh = secrets.token_urlsafe(48)
        if session_id is None:
            session_id = str(uuid.uuid4())
            db.execute('DELETE FROM sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL', (now,))
            db.execute('INSERT INTO sessions (id, user_id, refresh_token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', (session_id, user['id'], self.digest(refresh), now, now + REFRESH_SECONDS))
        else:
            db.execute('UPDATE sessions SET refresh_token_hash=? WHERE id=?', (self.digest(refresh), session_id))
        access = jwt.encode({'sub': user['id'], 'sid': session_id, 'iat': int(now), 'exp': int(now) + ACCESS_SECONDS, 'iss': 'adaptive-planner', 'aud': 'planner-web'}, self.secret, algorithm='HS256')
        return AuthResult(accessToken=access, expiresIn=ACCESS_SECONDS, user=self.public(user)), refresh

    def register(self, data: Registration):
        password_hash = self.hasher.hash(data.password)
        try:
            with self.transaction() as db:
                user_id = str(uuid.uuid4())
                db.execute('INSERT INTO users (id,email,password_hash,first_name,last_name,study_group,timezone,created_at) VALUES (?,?,?,?,?,?,?,?)', (user_id, str(data.email), password_hash, data.firstName, data.lastName, data.studyGroup, data.timezone, time.time()))
                user = db.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone()
                result = self.issue(db, user)
            return result
        except sqlite3.IntegrityError:
            raise AccountError(409, 'EMAIL_TAKEN', 'Этот email уже зарегистрирован. Попробуйте войти.')

    def login(self, data: Credentials):
        error = AccountError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль.')
        result = None
        with self.transaction() as db:
            user = db.execute('SELECT * FROM users WHERE email=?', (str(data.email),)).fetchone()
            now = time.time()
            if user and user['locked_until'] and user['locked_until'] > now:
                error = AccountError(429, 'TOO_MANY_ATTEMPTS', 'Слишком много попыток. Повторите вход через 15 минут.')
            else:
                try:
                    valid = self.hasher.verify(user['password_hash'] if user else self.dummy_hash, data.password)
                except VerificationError:
                    valid = False
                if user and valid:
                    db.execute('UPDATE users SET failed_login_count=0,locked_until=NULL WHERE id=?', (user['id'],))
                    if self.hasher.check_needs_rehash(user['password_hash']):
                        db.execute('UPDATE users SET password_hash=? WHERE id=?', (self.hasher.hash(data.password), user['id']))
                    result = self.issue(db, user)
                elif user:
                    failures = (0 if user['locked_until'] else user['failed_login_count']) + 1
                    locked_until = now + 900 if failures >= 5 else None
                    db.execute('UPDATE users SET failed_login_count=?,locked_until=? WHERE id=?', (failures, locked_until, user['id']))
                    if locked_until:
                        error = AccountError(429, 'TOO_MANY_ATTEMPTS', 'Слишком много попыток. Повторите вход через 15 минут.')
        # Ошибка выбрасывается после commit: счётчик не должен откатиться.
        if result is None:
            raise error
        return result

    def refresh(self, token: str | None):
        if not token:
            raise unauthorized()
        with self.transaction() as db:
            session = db.execute('SELECT * FROM sessions WHERE refresh_token_hash=? AND revoked_at IS NULL AND expires_at>?', (self.digest(token), time.time())).fetchone()
            if session is None:
                raise unauthorized()
            user = db.execute('SELECT * FROM users WHERE id=?', (session['user_id'],)).fetchone()
            result = self.issue(db, user, session['id'])
        return result

    def current_user(self, token):
        try:
            payload = jwt.decode(token, self.secret, algorithms=['HS256'], issuer='adaptive-planner', audience='planner-web', options={'require': ['sub', 'sid', 'iat', 'exp']})
        except jwt.InvalidTokenError:
            raise unauthorized()
        with self.transaction() as db:
            user = db.execute('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND s.id=? AND s.revoked_at IS NULL AND s.expires_at>?', (payload['sub'], payload['sid'], time.time())).fetchone()
            if user is None:
                raise unauthorized()
        return self.public(user)

    def logout(self, token):
        if token:
            with self.transaction() as db:
                db.execute('UPDATE sessions SET revoked_at=? WHERE refresh_token_hash=? AND revoked_at IS NULL', (time.time(), self.digest(token)))


def create_router(service: AccountService):
    router = APIRouter(prefix='/api/v1', tags=['Аккаунты'])
    bearer = HTTPBearer(auto_error=False)

    def authenticated(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
        if not credentials:
            raise unauthorized()
        return service.current_user(credentials.credentials)

    def response_with_cookie(response, result):
        body, refresh = result
        response.set_cookie('refresh_token', refresh, max_age=REFRESH_SECONDS, httponly=True, secure=service.settings.cookie_secure, samesite='strict', path='/api/v1/auth')
        return body

    @router.post('/auth/register', response_model=AuthResult, status_code=201)
    def register(data: Registration, response: Response):
        return response_with_cookie(response, service.register(data))

    @router.post('/auth/login', response_model=AuthResult)
    def login(data: Credentials, response: Response):
        return response_with_cookie(response, service.login(data))

    @router.post('/auth/refresh', response_model=AuthResult)
    def refresh(request: Request, response: Response):
        return response_with_cookie(response, service.refresh(request.cookies.get('refresh_token')))

    @router.post('/auth/logout', status_code=204)
    def logout(request: Request, response: Response):
        service.logout(request.cookies.get('refresh_token'))
        response.delete_cookie('refresh_token', path='/api/v1/auth', httponly=True, secure=service.settings.cookie_secure, samesite='strict')

    @router.get('/me', response_model=PublicUser)
    def me(user: Annotated[PublicUser, Depends(authenticated)]):
        return user

    return router
