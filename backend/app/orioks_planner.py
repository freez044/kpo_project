"""Детерминированный расчёт лабораторных сроков и подтверждённый импорт задач."""
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
import hashlib
import json
import re
import uuid
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from fastapi.security import HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.accounts import AccountError, PublicUser, unauthorized
from app.orioks import Snapshot

MOSCOW = ZoneInfo('Europe/Moscow')
WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']


def normalized(value):
    return re.sub(r'\s+', ' ', value.casefold().replace('ё', 'е').replace('–', '-').replace('—', '-')).strip()


def group_aliases(value):
    return set(re.findall(r'[a-zа-я]+-\d+[a-zа-я\d]*', normalized(value)))


class Rule(BaseModel):
    model_config = ConfigDict(extra='forbid')
    disciplineId: int = Field(gt=0)
    mode: str = Field(default='schedule', pattern='^(schedule|manual)$')
    graceSessions: int = Field(default=1, ge=0, le=3)
    firstLabDate: date | None = None
    intervalWeeks: int = Field(default=2, ge=1, le=4)
    startTime: time | None = None
    endTime: time | None = None
    excludedDates: list[date] = Field(default=[], max_length=100)
    scheduleName: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def manual_valid(self):
        if self.mode == 'manual' and (not self.firstLabDate or not self.startTime or not self.endTime or self.endTime <= self.startTime):
            raise ValueError('Для ручного расписания укажите дату и время начала и конца двух пар')
        return self


class PlannerSettings(BaseModel):
    model_config = ConfigDict(extra='forbid')
    semesterStart: date
    semesterEnd: date
    rules: list[Rule] = Field(default=[], max_length=150)

    @model_validator(mode='after')
    def valid_dates(self):
        if not 0 < (self.semesterEnd - self.semesterStart).days <= 250:
            raise ValueError('Проверьте границы учебного семестра')
        if len({rule.disciplineId for rule in self.rules}) != len(self.rules):
            raise ValueError('Повторяющиеся правила предмета')
        if any(rule.mode == 'manual' and not self.semesterStart <= rule.firstLabDate <= self.semesterEnd for rule in self.rules):
            raise ValueError('Первое занятие должно находиться в выбранном семестре')
        return self


class ImportOverride(BaseModel):
    model_config = ConfigDict(extra='forbid')
    eventKey: str
    plannedDate: date | None = None
    deadlineDate: date | None = None


class ApplyInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    previewId: uuid.UUID
    eventKeys: list[str] = Field(min_length=1, max_length=2000)
    overrides: list[ImportOverride] = Field(default=[], max_length=2000)


class OrioksPlanner:
    def __init__(self, orioks):
        self.orioks = orioks
        self.accounts = orioks.accounts

    def initialize(self):
        with self.accounts.transaction() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS orioks_planning (
                    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                    settings TEXT, schedule TEXT
                );
                CREATE TABLE IF NOT EXISTS orioks_previews (
                    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    fingerprint TEXT NOT NULL, items TEXT NOT NULL, expires_at REAL NOT NULL
                );
            ''')

    def state(self, user_id):
        with self.accounts.transaction() as db:
            row = db.execute('SELECT * FROM orioks_planning WHERE user_id=?', (user_id,)).fetchone()
        return {'settings': json.loads(row['settings']) if row and row['settings'] else None, 'schedule': json.loads(row['schedule']) if row and row['schedule'] else None}

    def snapshot(self, user_id, db=None):
        if db is not None:
            row = db.execute('SELECT snapshot FROM orioks_connections WHERE user_id=?', (user_id,)).fetchone()
        else:
            row = self.orioks.connection(user_id)
        if not row or not row['snapshot']:
            raise AccountError(409, 'ORIOKS_NOT_READY', 'Сначала подключите ОРИОКС и обновите учебные данные.')
        return Snapshot.model_validate_json(row['snapshot'])

    def save_settings(self, user_id, settings):
        snapshot = self.snapshot(user_id)
        available = {subject.id for subject in snapshot.disciplines}
        if any(rule.disciplineId not in available for rule in settings.rules):
            raise AccountError(422, 'VALIDATION_ERROR', 'Правило содержит предмет, которого нет в ваших данных ОРИОКС.')
        cache = self.state(user_id)['schedule']
        names = set(cache.get('scheduleNames', [])) if cache else set()
        if any(rule.mode == 'schedule' and rule.scheduleName and rule.scheduleName not in names for rule in settings.rules):
            raise AccountError(422, 'VALIDATION_ERROR', 'Название предмета не найдено в загруженном расписании. Обновите расписание или выберите ручной источник.')
        with self.accounts.transaction() as db:
            db.execute('INSERT INTO orioks_planning (user_id,settings) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET settings=excluded.settings', (user_id, settings.model_dump_json()))
        return self.state(user_id)

    def import_schedule(self, user_id):
        snapshot = self.snapshot(user_id)
        with self.orioks.operation(user_id) as deadline:
            row = self.orioks.connection(user_id)
            token = self.orioks.decrypt(user_id, row['token_encrypted'])
            get = lambda path: self.orioks.client.get(path, token=token, deadline=deadline)
            try:
                semester = get('/schedule')
                start = date.fromisoformat(semester['semester_start'])
                end = date.fromisoformat(semester['session_start']) - timedelta(days=1) if semester.get('session_start') else None
                groups = get('/schedule/groups')
                matches = [group for group in groups if normalized(str(group['name'])) == normalized(snapshot.student.group)]
                if not matches:
                    aliases = group_aliases(snapshot.student.group)
                    matches = [group for group in groups if aliases & group_aliases(str(group['name']))]
                if len(matches) != 1:
                    raise AccountError(409, 'ORIOKS_GROUP_AMBIGUOUS', 'Не удалось однозначно найти расписание вашей группы. Используйте ручные правила занятий.')
                group_id = int(matches[0]['id'])
                if group_id < 1:
                    raise ValueError('invalid group')
                timetable = get('/schedule/timetable')
                raw = get(f'/schedule/groups/{group_id}')
                lookup = defaultdict(list)
                for subject in snapshot.disciplines:
                    lookup[normalized(subject.name)].append(subject.id)
                slots = []
                unmatched = set()
                schedule_names = set()
                records = []
                missing_times = 0
                if isinstance(raw, list):
                    for lesson in raw:
                        recurrence, first_week = int(lesson['week_recurrence']), int(lesson['week'])
                        weekday, pair = int(lesson['day']), int(lesson['class'])
                        if recurrence not in (1, 2, 4) or not 0 <= first_week < 4 or not 0 <= weekday < 7:
                            raise ValueError('unsupported recurrence')
                        for week_type in range(4):
                            if (week_type - first_week) % recurrence == 0:
                                records.append((week_type, weekday, pair, lesson))
                elif isinstance(raw, dict):
                    for week_type in range(4):
                        for weekday, day_name in enumerate(WEEKDAYS):
                            for pair, lesson in raw.get(str(week_type), {}).get(day_name, {}).items():
                                records.append((week_type, weekday, int(pair), lesson))
                else:
                    raise ValueError('unexpected schedule format')
                for week_type, weekday, number, lesson in records:
                    if not re.search(r'лаборатор|^лаб(?:[.\s]|$)|^лр$|laboratory|^lab$', str(lesson.get('type', '')), re.I):
                        continue
                    schedule_names.add(lesson['name'])
                    ids = lookup.get(normalized(lesson['name']), [])
                    if len(ids) != 1:
                        unmatched.add(lesson['name'])
                    if str(number) not in timetable:
                        missing_times += 1
                        continue
                    begin, finish = [time.fromisoformat(value) for value in timetable[str(number)]]
                    if finish <= begin:
                        raise ValueError('invalid lesson duration')
                    slots.append({'disciplineId': ids[0] if len(ids) == 1 else None, 'scheduleName': lesson['name'], 'weekType': week_type, 'weekday': weekday, 'pair': number, 'start': begin.isoformat(), 'end': finish.isoformat(), 'teacher': str(lesson.get('teacher', '')), 'classroom': str(lesson.get('classroom', lesson.get('location', '')))})
                schedule = {'semesterStart': start.isoformat(), 'semesterEnd': end.isoformat() if end and end > start else None, 'slots': slots, 'scheduleNames': sorted(schedule_names), 'matchedSubjectIds': sorted({slot['disciplineId'] for slot in slots if slot['disciplineId'] is not None}), 'unmatchedCount': len(unmatched), 'missingTimeCount': missing_times, 'updatedAt': datetime.now(timezone.utc).isoformat()}
            except (ValueError, TypeError, KeyError, AttributeError):
                raise AccountError(502, 'ORIOKS_SCHEDULE_INVALID', 'Формат расписания отличается от ожидаемого. Старая копия сохранена; можно задать занятия вручную.') from None
            with self.accounts.transaction() as db:
                db.execute('INSERT INTO orioks_planning (user_id,schedule) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET schedule=excluded.schedule', (user_id, json.dumps(schedule)))
        return self.state(user_id)

    @staticmethod
    def blocks(settings, rule, schedule):
        excluded = set(rule.excludedDates)
        blocks = []
        if rule.mode == 'manual':
            current = rule.firstLabDate
            while current <= settings.semesterEnd:
                if current >= settings.semesterStart and current not in excluded:
                    blocks.append((current, datetime.combine(current, rule.endTime, MOSCOW)))
                current += timedelta(weeks=rule.intervalWeeks)
            return blocks
        if not schedule or schedule['semesterStart'] != settings.semesterStart.isoformat():
            return []
        groups = defaultdict(list)
        for slot in schedule['slots']:
            if (rule.scheduleName and normalized(slot.get('scheduleName', '')) == normalized(rule.scheduleName)) or (not rule.scheduleName and slot['disciplineId'] == rule.disciplineId):
                groups[(slot['weekType'], slot['weekday'], slot['teacher'], slot['classroom'])].append(slot)
        # Consecutive pair numbers, same subject/teacher/room. Four pairs form TWO blocks.
        for (week_type, weekday, _, _), slots in groups.items():
            ordered = sorted(slots, key=lambda slot: slot['pair'])
            i = 0
            while i + 1 < len(ordered):
                first, second = ordered[i:i + 2]
                if second['pair'] != first['pair'] + 1 or time.fromisoformat(second['start']) < time.fromisoformat(first['end']):
                    i += 1
                    continue
                for week in range(0, 37):
                    if week % 4 != week_type:
                        continue
                    anchor = settings.semesterStart + timedelta(weeks=week)
                    current = anchor + timedelta(days=(weekday - anchor.weekday()) % 7)
                    if current > settings.semesterEnd or current in excluded:
                        continue
                    blocks.append((current, datetime.combine(current, time.fromisoformat(second['end']), MOSCOW)))
                i += 2
        return sorted(set(blocks), key=lambda item: item[1])

    @staticmethod
    def fingerprint(snapshot, state):
        return hashlib.sha256(json.dumps({'snapshot': snapshot.model_dump(mode='json'), 'state': state}, sort_keys=True, ensure_ascii=False).encode()).hexdigest()

    def preview(self, user_id):
        snapshot = self.snapshot(user_id)
        state = self.state(user_id)
        if not state['settings']:
            raise AccountError(409, 'ORIOKS_SETTINGS_REQUIRED', 'Сначала сохраните границы семестра и правила предметов.')
        settings = PlannerSettings.model_validate(state['settings'])
        rules = {rule.disciplineId: rule for rule in settings.rules}
        with self.accounts.transaction() as db:
            existing = {row['source_key']: row['id'] for row in db.execute('SELECT id,source_key FROM tasks WHERE user_id=? AND source_key IS NOT NULL', (user_id,))}
        items = []
        namespace = f'{snapshot.student.year}:{snapshot.student.semester}' if snapshot.student.year and snapshot.student.semester else settings.semesterStart.isoformat()
        for subject in snapshot.disciplines:
            identities = []
            for event in subject.events:
                identity = 'alias:' + normalized(event.alias) if event.alias else 'name:' + normalized(event.name) + ':' + normalized(event.type) if event.name else None
                identities.append(identity)
            counts = Counter(identities)
            rule = rules.get(subject.id)
            blocks = self.blocks(settings, rule, state['schedule']) if rule else []
            for index, event in enumerate(subject.events):
                identity = identities[index]
                key = hashlib.sha256(f'{namespace}:{subject.id}:{identity}'.encode()).hexdigest() if identity and counts[identity] == 1 else None
                lab = bool(re.search('лаборатор', event.type, re.I))
                reason = None
                planned_due = None
                deadline = None
                source = 'UNKNOWN'
                if lab and rule:
                    candidates = [(day, finish) for day, finish in blocks if (day - settings.semesterStart).days // 7 + 1 == event.week]
                    if len(candidates) == 1:
                        day, planned_due = candidates[0]
                        position = blocks.index(candidates[0]) + rule.graceSessions
                        if position < len(blocks):
                            deadline = blocks[position][1]
                            source = 'SCHEDULE_RULE' if rule.mode == 'schedule' else 'MANUAL_RULE'
                        else:
                            reason = 'В расписании нет следующего занятия для срока без снижения.'
                    else:
                        reason = 'На этой учебной неделе нет однозначного лабораторного блока из двух пар.'
                else:
                    reason = 'Для предмета нет правила лабораторных.' if lab else 'Для этого типа мероприятия срок нужно уточнить вручную.'
                if key is None:
                    reason = 'В ОРИОКС нет уникального названия или обозначения мероприятия. Автоматический импорт небезопасен.'
                items.append({'eventKey': key, 'disciplineId': subject.id, 'discipline': subject.name, 'title': f'{subject.name} — {event.alias or event.name or event.type}'[:200], 'name': event.name, 'type': event.type, 'week': event.week, 'grade': event.current_grade, 'plannedDate': planned_due.date().isoformat() if planned_due else None, 'plannedDueAt': planned_due.isoformat() if planned_due else None, 'deadline': deadline.isoformat() if deadline else None, 'deadlineSource': source, 'reason': reason, 'existingTaskId': existing.get(key), 'selectedByDefault': bool(key and key not in existing and deadline and event.current_grade in (None, -1, 0)), 'graceSessions': rule.graceSessions if rule else None})
        preview_id = str(uuid.uuid4())
        with self.accounts.transaction() as db:
            db.execute('DELETE FROM orioks_previews WHERE user_id=?', (user_id,))
            db.execute('INSERT INTO orioks_previews VALUES (?,?,?,?,?)', (preview_id, user_id, self.fingerprint(snapshot, state), json.dumps(items, ensure_ascii=False), datetime.now().timestamp() + 900))
        return {'previewId': preview_id, 'items': items, 'snapshotAt': snapshot.syncedAt, 'expiresIn': 900}

    def apply(self, user_id, data):
        # All tasks are created in one transaction; unique owner/source index makes retries safe.
        with self.accounts.transaction() as db:
            preview = db.execute('SELECT * FROM orioks_previews WHERE id=? AND user_id=?', (str(data.previewId), user_id)).fetchone()
            if not preview or preview['expires_at'] < datetime.now().timestamp():
                raise AccountError(409, 'PREVIEW_EXPIRED', 'Предпросмотр устарел. Рассчитайте сроки заново.')
            raw = db.execute('SELECT * FROM orioks_planning WHERE user_id=?', (user_id,)).fetchone()
            state = {'settings': json.loads(raw['settings']) if raw['settings'] else None, 'schedule': json.loads(raw['schedule']) if raw['schedule'] else None}
            snapshot = self.snapshot(user_id, db)
            if preview['fingerprint'] != self.fingerprint(snapshot, state):
                raise AccountError(409, 'PREVIEW_CHANGED', 'Учебные данные или правила изменились. Рассчитайте сроки заново.')
            items = {item['eventKey']: item for item in json.loads(preview['items']) if item['eventKey']}
            keys = list(dict.fromkeys(data.eventKeys))
            if any(key not in items for key in keys):
                raise AccountError(422, 'VALIDATION_ERROR', 'Выбрано неизвестное мероприятие.')
            overrides = {item.eventKey: item for item in data.overrides}
            if len(overrides) != len(data.overrides) or any(key not in keys for key in overrides):
                raise AccountError(422, 'VALIDATION_ERROR', 'Проверьте ручные сроки выбранных мероприятий.')
            created, skipped = [], 0
            for key in keys:
                item = items[key]
                if db.execute('SELECT id FROM tasks WHERE user_id=? AND source_key=?', (user_id, key)).fetchone():
                    skipped += 1
                    continue
                planned_date, deadline = item['plannedDate'], item['deadline']
                source = item['deadlineSource']
                planned_due = item['plannedDueAt']
                override = overrides.get(key)
                if override:
                    if 'plannedDate' in override.model_fields_set:
                        planned_date = override.plannedDate.isoformat() if override.plannedDate else None
                        planned_due = datetime.combine(override.plannedDate, time(23, 59, 59), MOSCOW).isoformat() if override.plannedDate else None
                        source = 'MANUAL'
                    if 'deadlineDate' in override.model_fields_set:
                        deadline = datetime.combine(override.deadlineDate, time(23, 59, 59), MOSCOW).isoformat() if override.deadlineDate else None
                        source = 'MANUAL'
                if deadline and planned_due and datetime.fromisoformat(deadline) < datetime.fromisoformat(planned_due):
                    raise AccountError(422, 'VALIDATION_ERROR', 'Срок без снижения не может быть раньше плановой сдачи.')
                metadata = {'discipline': item['discipline'], 'week': item['week'], 'plannedDueAt': planned_due, 'noPenaltyUntil': deadline, 'deadlineSource': source, 'graceSessions': item['graceSessions'], 'snapshotAt': snapshot.syncedAt}
                task_id = str(uuid.uuid4())
                now = datetime.now(timezone.utc).isoformat()
                description = f"Импортировано из ОРИОКС. {item['type']}, учебная неделя {item['week']}." + (f"\n{item['name']}" if item['name'] else '')
                if item['reason']:
                    description += '\nСрок требует проверки: ' + item['reason']
                db.execute('INSERT INTO tasks (id,user_id,title,description,deadline,planned_date,category,priority,status,created_at,updated_at,source,source_key,orioks_metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (task_id, user_id, item['title'], description, datetime.fromisoformat(deadline).astimezone(timezone.utc).isoformat() if deadline else None, planned_date, 'Учёба', 'MEDIUM', 'PLANNED' if planned_date else 'BACKLOG', now, now, 'ORIOKS', key, json.dumps(metadata, ensure_ascii=False)))
                created.append(task_id)
        return {'createdCount': len(created), 'skippedCount': skipped, 'taskIds': created}


def create_planner_router(service):
    router = APIRouter(prefix='/api/v1/orioks/planning', tags=['Планирование ОРИОКС'])
    bearer = HTTPBearer(auto_error=False)
    def authenticated(credentials=Depends(bearer)):
        if not credentials:
            raise unauthorized()
        return service.accounts.current_user(credentials.credentials)
    @router.get('')
    def state(user=Depends(authenticated)):
        return service.state(user.id)
    @router.put('')
    def save(data: PlannerSettings, user=Depends(authenticated)):
        return service.save_settings(user.id, data)
    @router.post('/schedule')
    def schedule(user=Depends(authenticated)):
        return service.import_schedule(user.id)
    @router.post('/preview')
    def preview(user=Depends(authenticated)):
        return service.preview(user.id)
    @router.post('/apply')
    def apply(data: ApplyInput, user=Depends(authenticated)):
        return service.apply(user.id, data)
    return router

