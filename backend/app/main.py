#для запуска терминала: uv run uvicorn app.main:app --reload
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app.accounts import AccountError, AccountService, AuthSettings, create_router
from app.local_tasks import TaskService, create_task_router
from app.password_reset import PasswordResetService, create_reset_router
from app.orioks import OrioksService, create_orioks_router
from app.orioks_planner import OrioksPlanner, create_planner_router
import sqlite3


def create_app(settings: AuthSettings | None = None, *, mailer=None, orioks_client=None) -> FastAPI:
    settings = settings or AuthSettings()
    service = AccountService(settings)
    tasks = TaskService(service)
    resets = PasswordResetService(service, mailer)
    orioks = OrioksService(service, orioks_client)
    planner = OrioksPlanner(orioks)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        service.initialize()
        tasks.initialize()
        resets.initialize()
        orioks.initialize()
        planner.initialize()
        yield

    app = FastAPI(title='Adaptive AI Planner', version='0.5.0', lifespan=lifespan)
    app.state.accounts = service
    app.state.password_resets = resets
    app.state.orioks = orioks
    app.state.orioks_planner = planner

    @app.middleware('http')
    async def protect_browser_requests(request: Request, call_next):
        origin = request.headers.get('origin')
        if request.method not in {'GET', 'HEAD', 'OPTIONS'} and (
            (origin is not None and origin not in settings.allowed_origins)
            or request.headers.get('sec-fetch-site') == 'cross-site'
        ):
            return JSONResponse({'error': {'code': 'FORBIDDEN', 'message': 'Запрос с этого сайта запрещён.'}}, status_code=403)
        response = await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response

    @app.exception_handler(AccountError)
    async def account_error(request: Request, exc: AccountError):
        response = JSONResponse({'error': {'code': exc.code, 'message': exc.message}}, status_code=exc.status)
        if exc.code == 'UNAUTHORIZED' and request.url.path.endswith('/refresh'):
            response.delete_cookie('refresh_token', path='/api/v1/auth', httponly=True, samesite='strict', secure=settings.cookie_secure)
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        field = str(exc.errors()[0]['loc'][-1])
        if request.url.path.startswith('/api/v1/orioks/'):
            return JSONResponse({'error': {'code': 'VALIDATION_ERROR', 'message': ('Проверьте даты семестра и правила занятий.' if '/planning' in request.url.path else 'Проверьте логин и пароль ОРИОКС.'), 'field': field}}, status_code=422)
        if field in {'code', 'newPassword'}:
            message = 'Введите код из 6 цифр.' if field == 'code' else 'Новый пароль должен содержать от 8 до 128 символов.'
            return JSONResponse({'error': {'code': 'VALIDATION_ERROR', 'message': message, 'field': field}}, status_code=422)
        messages = {'email': 'Введите корректный email.', 'password': 'Пароль должен содержать от 8 до 128 символов.', 'firstName': 'Укажите имя (до 100 символов).', 'lastName': 'Укажите фамилию (до 100 символов).', 'timezone': 'Укажите существующий часовой пояс.', 'title': 'Укажите название задачи от 1 до 200 символов.', 'description': 'Описание должно содержать не более 10 000 символов.', 'deadline': 'Укажите корректный срок с часовым поясом.', 'plannedDate': 'Укажите корректную дату плана.', 'priority': 'Выберите допустимый приоритет.', 'status': 'Выберите допустимый статус.', 'category': 'Категория должна содержать от 1 до 100 символов.'}
        return JSONResponse({'error': {'code': 'VALIDATION_ERROR', 'message': messages.get(field, 'Проверьте заполненные поля.'), 'field': field}}, status_code=422)

    # Общий демонстрационный /tasks не подключается: у него нет владельцев записей.
    app.include_router(create_router(service))
    app.include_router(create_task_router(tasks))
    app.include_router(create_reset_router(resets))
    app.include_router(create_orioks_router(orioks))
    app.include_router(create_planner_router(planner))

    @app.exception_handler(sqlite3.OperationalError)
    async def database_error(request: Request, exc: sqlite3.OperationalError):
        return JSONResponse({'error': {'code': 'STORAGE_UNAVAILABLE', 'message': 'Не удалось обратиться к хранилищу. Повторите попытку.'}}, status_code=503)

    @app.get('/api/v1/health')
    def health():
        service.check_database()
        return {'status': 'ok', 'accountsStorage': 'local-sqlite'}

    return app


app = create_app()


