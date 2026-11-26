"""Одноразовые коды восстановления и SMTP с обязательным TLS."""
import hashlib
import hmac
import logging
import secrets
import smtplib
import ssl
import time
import uuid
from email.message import EmailMessage

from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from app.accounts import AccountError, AccountService, AuthSettings, Credentials

CODE_LIFETIME = 600
GENERIC_MESSAGE = 'Если аккаунт с таким email существует, письмо с кодом будет отправлено. Код действует 10 минут.'
INVALID_CODE = 'Неверный или истёкший код. Проверьте его или запросите новый.'
logger = logging.getLogger(__name__)


class ResetEmail(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: EmailStr = Field(max_length=254)
    normalize_email = field_validator('email', mode='before')(Credentials.normalize_email.__func__)


class ResetConfirm(ResetEmail):
    code: str = Field(pattern=r'^[0-9]{6}$')
    newPassword: str = Field(min_length=8, max_length=128)


class ResetMessage(BaseModel):
    message: str
    retryAfter: int = 60


class SMTPMailer:
    def __init__(self, settings: AuthSettings):
        self.settings = settings

    @property
    def configured(self):
        s = self.settings
        return bool(s.smtp_host and s.smtp_from and s.smtp_username and s.smtp_password.get_secret_value())

    def send_code(self, email: str, code: str):
        s = self.settings
        message = EmailMessage()
        message['Subject'] = 'Код для восстановления пароля · Adaptive AI Planner'
        message['From'] = str(s.smtp_from)
        message['To'] = email
        message.set_content(f'Ваш код восстановления пароля: {code}\n\nКод действует 10 минут и может быть использован один раз.\nНикому не сообщайте этот код.\n\nЕсли вы не запрашивали сброс пароля, проигнорируйте письмо: ваш пароль не изменился.\n\nAdaptive AI Planner')
        context = ssl.create_default_context()
        client_type = smtplib.SMTP if s.smtp_starttls else smtplib.SMTP_SSL
        options = {} if s.smtp_starttls else {'context': context}
        with client_type(s.smtp_host, s.smtp_port, timeout=10, **options) as client:
            if s.smtp_starttls:
                client.ehlo()
                client.starttls(context=context)
                client.ehlo()
            client.login(s.smtp_username, s.smtp_password.get_secret_value())
            refused = client.send_message(message)
            if refused:
                raise smtplib.SMTPException('Recipient refused')


class PasswordResetService:
    def __init__(self, accounts: AccountService, mailer=None):
        self.accounts = accounts
        self.mailer = mailer if mailer is not None else SMTPMailer(accounts.settings)

    def initialize(self):
        with self.accounts.transaction() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS password_resets (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
                    code_hash TEXT NOT NULL, created_at REAL NOT NULL, expires_at REAL NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0, delivered INTEGER NOT NULL DEFAULT 0,
                    used_at REAL
                );
                CREATE TABLE IF NOT EXISTS password_reset_limits (
                    key TEXT PRIMARY KEY, window_start REAL NOT NULL,
                    count INTEGER NOT NULL, next_allowed REAL NOT NULL
                );
            ''')

    def digest(self, value):
        return hmac.new(self.accounts.secret.encode(), value.encode(), hashlib.sha256).hexdigest()

    def rate_limit(self, db, email, ip, kind):
        now = time.time()
        specs = [(f'{kind}:email:{email}', 3 if kind == 'request' else 20, 60 if kind == 'request' else 0), (f'{kind}:ip:{ip}', 20 if kind == 'request' else 100, 0)]
        rows = []
        for raw_key, maximum, cooldown in specs:
            key = self.digest(raw_key)
            row = db.execute('SELECT * FROM password_reset_limits WHERE key=?', (key,)).fetchone()
            if row and row['window_start'] > now - 3600 and (row['count'] >= maximum or row['next_allowed'] > now):
                raise AccountError(429, 'TOO_MANY_ATTEMPTS', 'Слишком много запросов. Подождите и попробуйте позже.')
            rows.append((key, row, cooldown))
        db.execute('DELETE FROM password_reset_limits WHERE window_start < ?', (now - 3600,))
        for key, row, cooldown in rows:
            count = row['count'] + 1 if row and row['window_start'] > now - 3600 else 1
            start = row['window_start'] if count > 1 else now
            db.execute('INSERT OR REPLACE INTO password_reset_limits (key,window_start,count,next_allowed) VALUES (?,?,?,?)', (key, start, count, now + cooldown))

    def prepare(self, email, ip):
        if not self.mailer.configured:
            raise AccountError(503, 'MAIL_UNAVAILABLE', 'Восстановление пароля пока недоступно: отправка писем не настроена.')
        code = f'{secrets.randbelow(1000000):06d}'
        challenge_id = str(uuid.uuid4())
        now = time.time()
        with self.accounts.transaction() as db:
            self.rate_limit(db, email, ip, 'request')
            user = db.execute('SELECT id FROM users WHERE email=?', (email,)).fetchone()
            if user is None:
                return None
            db.execute('DELETE FROM password_resets WHERE user_id=?', (user['id'],))
            db.execute('INSERT INTO password_resets (id,user_id,code_hash,created_at,expires_at) VALUES (?,?,?,?,?)', (challenge_id, user['id'], self.digest(challenge_id + ':' + code), now, now + CODE_LIFETIME))
        return challenge_id, email, code

    def deliver(self, challenge_id, email, code):
        try:
            self.mailer.send_code(email, code)
        except Exception:
            # Never log SMTP exception text: it may contain credentials/recipients.
            logger.error('Password reset email could not be delivered')
            with self.accounts.transaction() as db:
                db.execute('UPDATE password_resets SET used_at=? WHERE id=?', (time.time(), challenge_id))
        else:
            with self.accounts.transaction() as db:
                db.execute('UPDATE password_resets SET delivered=1 WHERE id=? AND used_at IS NULL', (challenge_id,))

    def confirm(self, data: ResetConfirm, ip):
        valid = False
        # Hash on both success/failure so response timing does not reveal existence.
        password_hash = self.accounts.hasher.hash(data.newPassword)
        with self.accounts.transaction() as db:
            self.rate_limit(db, str(data.email), ip, 'confirm')
            row = db.execute('SELECT r.* FROM password_resets r JOIN users u ON u.id=r.user_id WHERE u.email=?', (str(data.email),)).fetchone()
            now = time.time()
            usable = bool(row and row['delivered'] and row['used_at'] is None and row['expires_at'] > now and row['attempts'] < 5)
            expected = row['code_hash'] if row else self.digest('dummy')
            candidate = self.digest((row['id'] if row else '') + ':' + data.code)
            matches = hmac.compare_digest(expected, candidate)
            if usable and matches:
                db.execute('UPDATE users SET password_hash=?,failed_login_count=0,locked_until=NULL WHERE id=?', (password_hash, row['user_id']))
                db.execute('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', (now, row['user_id']))
                db.execute('UPDATE password_resets SET used_at=? WHERE id=?', (now, row['id']))
                valid = True
            elif usable:
                db.execute('UPDATE password_resets SET attempts=attempts+1 WHERE id=?', (row['id'],))
        if not valid:
            raise AccountError(400, 'INVALID_RESET_CODE', INVALID_CODE)


def create_reset_router(service: PasswordResetService):
    router = APIRouter(prefix='/api/v1/auth', tags=['Восстановление пароля'])

    @router.post('/password/request', response_model=ResetMessage, status_code=202)
    def request_code(data: ResetEmail, request: Request, background: BackgroundTasks):
        prepared = service.prepare(str(data.email), request.client.host if request.client else 'unknown')
        if prepared:
            background.add_task(service.deliver, *prepared)
        return ResetMessage(message=GENERIC_MESSAGE)

    @router.post('/password/reset', status_code=204)
    def reset(data: ResetConfirm, request: Request, response: Response):
        service.confirm(data, request.client.host if request.client else 'unknown')
        response.delete_cookie('refresh_token', path='/api/v1/auth', httponly=True, secure=service.accounts.settings.cookie_secure, samesite='strict')

    return router
