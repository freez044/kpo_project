# API-слой фронтенда

Весь обмен с сервером идёт через `client.ts`. Страницы и компоненты `fetch` не вызывают, только
функции из `auth.ts` и `tasks.ts` (и новые файлы рядом с ними). Пути, поля и коды ошибок
соответствуют `docs/contracts.md`; база — `/api/v1`.

## Режимы (`VITE_API_MODE`, см. `frontend/.env.example`)

| Режим | Что происходит |
|---|---|
| `mock` (по умолчанию) | Ответы даёт `mock/server.ts` в памяти страницы: сервер не нужен, данные пропадают при перезагрузке. Вход: `demo@example.com` / `demo12345` |
| `real` | Запросы уходят на настоящий бэкенд через прокси Vite (`/api` → `127.0.0.1:8000`) |

Подключение бэкенда: запустить сервер и поставить `VITE_API_MODE=real` в `frontend/.env.local`.
Код страниц менять не нужно.

## Какие запросы использует фронтенд

| Функция | Запрос |
|---|---|
| `register(input)` | `POST /auth/register` |
| `login(email, password)` | `POST /auth/login` |
| `logout()` | `POST /auth/logout` |
| `refreshSession()` (при старте и при 401) | `POST /auth/refresh` |
| `updateProfile(patch)` | `PATCH /me` |
| `listTasks()` | `GET /tasks` |
| `createTask(input)` | `POST /tasks` |
| `updateTask(id, patch)` | `PATCH /tasks/{id}` |
| `deleteTask(id)` | `DELETE /tasks/{id}` |

## Как устроена авторизация

- Access-токен хранится только в памяти (`client.ts`), в `Authorization: Bearer`.
- Refresh-токен сервер кладёт в HttpOnly-cookie (`credentials: 'same-origin'`). После перезагрузки
  страницы `AuthProvider` вызывает `refreshSession()` и восстанавливает вход.
- Ответ `401 UNAUTHORIZED` → один вызов `/auth/refresh` и повтор запроса; если refresh отклонён,
  пользователь возвращается на `/login`. Параллельные обновления объединяются в один запрос.
- Ошибки приходят как `{ error: { code, message, field? } }` и превращаются в `ApiError`.

## Поля, которых пока нет в `docs/contracts.md`

Фронтенд и мок уже используют их, бэкенд нужно с ними согласовать:

| Поле / параметр | Где | Значения |
|---|---|---|
| `section` | `Task` в ответах, тело `POST /tasks` и `PATCH /tasks/{id}`, фильтр `GET /tasks?section=` | `STUDY` (учебная), `PERSONAL` (моя, не связана с учёбой). Если не передано — `STUDY` |

Общий список задач для страниц лежит в `src/tasks/TasksContext.tsx`: Главная и «Задачи» читают одно
состояние, поэтому созданная задача видна везде сразу. Все запросы к серверу по-прежнему идут через `api/tasks.ts`.
