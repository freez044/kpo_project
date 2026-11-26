from datetime import date, datetime, timezone, timedelta
import json
import sqlite3
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.orioks_planner import OrioksPlanner, PlannerSettings, Rule, MOSCOW
from test_accounts import settings, register, bearer
from test_orioks import FakeOrioks, connect


class ScheduleAPI(FakeOrioks):
    def get(self, path, **kwargs):
        if path == '/schedule':
            return {'semester_start': '2026-09-07', 'session_start': '2027-01-01'}
        if path == '/schedule/groups':
            return [{'id': 1, 'name': 'ПИН-31 (ИПОВС-31)'}]
        if path == '/schedule/timetable':
            return {'1': ['09:00', '10:30'], '2': ['10:40', '12:10'], '3': ['12:20', '13:50'], '4': ['14:30', '16:00']}
        if path == '/schedule/groups/1':
            return [{'name': 'Базы данных', 'type': 'Лаб', 'day': 2, 'class': pair, 'week': 1, 'week_recurrence': 2, 'location': '101', 'teacher': 'Преподаватель'} for pair in (1,2)]
        result = super().get(path, **kwargs)
        if path.endswith('/events'):
            result[1]['alias'] = 'ЛР.2'
        return result


@pytest.fixture
def planning(settings):
    upstream = ScheduleAPI()
    with TestClient(create_app(settings, orioks_client=upstream)) as client:
        auth = register(client).json()
        client.headers.update(bearer(auth['accessToken']))
        assert connect(client).status_code == 200
        yield client, upstream, auth['user']['id']


def setup(client, **rule):
    response = client.post('/api/v1/orioks/planning/schedule', json={})
    assert response.status_code == 200, response.text
    response = client.put('/api/v1/orioks/planning', json={'semesterStart': '2026-09-07', 'semesterEnd': '2026-12-31', 'rules': [{'disciplineId': 42, **rule}]})
    assert response.status_code == 200, response.text
    return client.post('/api/v1/orioks/planning/preview', json={})


def apply(client, preview, keys=None, overrides=None):
    return client.post('/api/v1/orioks/planning/apply', json={'previewId': preview['previewId'], 'eventKeys': keys or [preview['items'][0]['eventKey']], 'overrides': overrides or []})


def test_real_flat_schedule_two_pairs_one_lab_next_session_deadline(planning):
    client, _, _ = planning
    preview = setup(client).json()
    item = preview['items'][0]
    assert item['plannedDate'] == '2026-09-16'
    assert datetime.fromisoformat(item['plannedDueAt']) == datetime(2026, 9, 16, 12, 10, tzinfo=MOSCOW)
    assert datetime.fromisoformat(item['deadline']) == datetime(2026, 9, 30, 12, 10, tzinfo=MOSCOW)
    assert item['deadlineSource'] == 'SCHEDULE_RULE'
    result = apply(client, preview)
    assert result.status_code == 200 and result.json()['createdCount'] == 1
    task = client.get('/api/v1/tasks').json()[0]
    assert task['source'] == 'ORIOKS' and task['category'] == 'Учёба'
    assert task['orioks']['plannedDueAt'] == item['plannedDueAt']
    assert datetime.fromisoformat(task['deadline']) == datetime.fromisoformat(item['deadline'])


def test_reimport_never_duplicates_or_overwrites_personal_edits(planning):
    client, _, _ = planning
    preview = setup(client).json()
    first = apply(client, preview).json()
    task_id = first['taskIds'][0]
    client.patch('/api/v1/tasks/' + task_id, json={'title': 'Моё название', 'description': 'Мои заметки', 'status': 'DONE'})
    second = apply(client, preview).json()
    assert second['createdCount'] == 0 and second['skippedCount'] == 1
    fresh = client.post('/api/v1/orioks/planning/preview', json={}).json()
    assert fresh['items'][0]['existingTaskId'] == task_id
    task = client.get('/api/v1/tasks/' + task_id).json()
    assert task['title'] == 'Моё название' and task['description'] == 'Мои заметки' and task['status'] == 'DONE'


def test_excluded_session_moves_deadline_to_next_actual_session(planning):
    client, _, _ = planning
    item = setup(client, excludedDates=['2026-09-30']).json()['items'][0]
    assert datetime.fromisoformat(item['deadline']).date() == date(2026, 10, 14)


def test_manual_schedule_and_zero_grace(planning):
    client, _, _ = planning
    item = setup(client, mode='manual', firstLabDate='2026-09-16', startTime='09:00', endTime='12:10', intervalWeeks=2, graceSessions=0).json()['items'][0]
    assert item['deadlineSource'] == 'MANUAL_RULE'
    assert item['deadline'] == item['plannedDueAt']


def test_missing_next_session_does_not_invent_date(planning):
    client, _, _ = planning
    setup(client)
    client.put('/api/v1/orioks/planning', json={'semesterStart': '2026-09-07', 'semesterEnd': '2026-09-20', 'rules': [{'disciplineId': 42}]})
    item = client.post('/api/v1/orioks/planning/preview', json={}).json()['items'][0]
    assert item['plannedDate'] == '2026-09-16' and item['deadline'] is None and item['reason']


def test_ambiguous_block_and_single_pair_not_guessed():
    settings = PlannerSettings(semesterStart='2026-09-07', semesterEnd='2026-10-31')
    rule = Rule(disciplineId=42)
    slot = {'disciplineId': 42, 'weekType': 1, 'weekday': 2, 'pair': 1, 'start': '09:00', 'end': '10:30', 'teacher': 'T', 'classroom': 'R'}
    schedule = {'semesterStart': '2026-09-07', 'slots': [slot]}
    assert OrioksPlanner.blocks(settings, rule, schedule) == []
    slots = [dict(slot, pair=n, start=start, end=end) for n,start,end in [(1,'09:00','10:30'),(2,'10:40','12:10'),(3,'12:20','13:50'),(4,'14:30','16:00')]]
    schedule['slots'] = slots
    blocks = OrioksPlanner.blocks(settings, rule, schedule)
    assert len([block for block in blocks if block[0] == date(2026,9,16)]) == 2


def test_changed_rules_or_snapshot_invalidates_preview(planning):
    client, _, user_id = planning
    preview = setup(client).json()
    client.put('/api/v1/orioks/planning', json={'semesterStart': '2026-09-07', 'semesterEnd': '2026-12-31', 'rules': [{'disciplineId': 42, 'graceSessions': 0}]})
    assert apply(client, preview).status_code == 409
    preview = client.post('/api/v1/orioks/planning/preview', json={}).json()
    with client.app.state.accounts.transaction() as db:
        raw = json.loads(db.execute('SELECT snapshot FROM orioks_connections WHERE user_id=?', (user_id,)).fetchone()[0])
        raw['syncedAt'] = datetime.now(timezone.utc).isoformat()
        db.execute('UPDATE orioks_connections SET snapshot=? WHERE user_id=?', (json.dumps(raw), user_id))
    assert apply(client, preview).status_code == 409
    assert client.get('/api/v1/tasks').json() == []


def test_partial_batch_rolls_back_all_tasks(planning):
    client, _, _ = planning
    preview = setup(client).json()
    first, second = preview['items'][:2]
    response = apply(client, preview, keys=[first['eventKey'], second['eventKey']], overrides=[{'eventKey': second['eventKey'], 'deadlineDate': '2026-09-01'}])
    assert response.status_code == 422
    assert client.get('/api/v1/tasks').json() == []


def test_manual_deadline_is_labelled_and_edit_preserves_provenance(planning):
    client, _, _ = planning
    preview = setup(client).json()
    task_id = apply(client, preview, overrides=[{'eventKey': preview['items'][0]['eventKey'], 'deadlineDate': '2026-10-01'}]).json()['taskIds'][0]
    task = client.get('/api/v1/tasks/' + task_id).json()
    assert task['orioks']['deadlineSource'] == 'MANUAL'
    assert datetime.fromisoformat(task['deadline']).astimezone(MOSCOW).hour == 23
    changed = client.patch('/api/v1/tasks/' + task_id, json={'deadline': '2026-10-02T20:00:00+03:00'}).json()
    assert datetime.fromisoformat(changed['orioks']['noPenaltyUntil']) == datetime.fromisoformat(changed['deadline'])


def test_owner_scope_and_unknown_selected_event(planning, settings):
    client, api, _ = planning
    preview = setup(client).json()
    with TestClient(create_app(settings, orioks_client=api)) as other:
        auth = register(other, email='other@example.com').json()
        other.headers.update(bearer(auth['accessToken']))
        assert other.get('/api/v1/orioks/planning').json()['settings'] is None
        assert apply(other, preview).status_code == 409
    assert apply(client, preview, keys=['not-a-real-key']).status_code == 422
    assert client.get('/api/v1/tasks').json() == []


def test_schedule_name_mapping_and_legacy_format(planning):
    client, api, _ = planning
    original_get = api.get
    def get(path, **kwargs):
        if path == '/schedule/groups/1':
            return {'1': {'wednesday': {'1': {'name':'БД','type':'Лабораторная работа','teacher':'T','classroom':'R'}, '2': {'name':'БД','type':'Лабораторная работа','teacher':'T','classroom':'R'}}}, '3': {'wednesday': {'1': {'name':'БД','type':'Лабораторная работа','teacher':'T','classroom':'R'}, '2': {'name':'БД','type':'Лабораторная работа','teacher':'T','classroom':'R'}}}}
        return original_get(path, **kwargs)
    api.get = get
    item = setup(client, scheduleName='БД').json()['items'][0]
    assert item['deadline'] and item['deadlineSource'] == 'SCHEDULE_RULE'


def test_duplicate_aliases_are_not_importable(planning):
    client, _, user_id = planning
    setup(client)
    with client.app.state.accounts.transaction() as db:
        raw = json.loads(db.execute('SELECT snapshot FROM orioks_connections WHERE user_id=?', (user_id,)).fetchone()[0])
        raw['disciplines'][0]['events'][1]['alias'] = 'ЛР.1'
        db.execute('UPDATE orioks_connections SET snapshot=? WHERE user_id=?', (json.dumps(raw),user_id))
    preview = client.post('/api/v1/orioks/planning/preview', json={}).json()
    assert preview['items'][0]['eventKey'] is None and preview['items'][1]['eventKey'] is None


def test_task_stage_uses_both_deadlines(planning):
    client, _, _ = planning
    preview = setup(client).json()
    task_id = apply(client, preview).json()['taskIds'][0]
    now = datetime.now(timezone.utc)
    with client.app.state.accounts.transaction() as db:
        row = db.execute('SELECT orioks_metadata FROM tasks WHERE id=?', (task_id,)).fetchone()
        metadata = json.loads(row[0])
        metadata['plannedDueAt'] = (now - timedelta(days=1)).isoformat()
        db.execute('UPDATE tasks SET deadline=?,orioks_metadata=? WHERE id=?', ((now + timedelta(days=1)).isoformat(), json.dumps(metadata), task_id))
    assert client.get('/api/v1/tasks/' + task_id).json()['orioks']['stage'] == 'GRACE'
    with client.app.state.accounts.transaction() as db:
        db.execute('UPDATE tasks SET deadline=? WHERE id=?', ((now - timedelta(minutes=1)).isoformat(), task_id))
    task = client.get('/api/v1/tasks/' + task_id).json()
    assert task['orioks']['stage'] == 'PENALTY' and task['isOverdue']


def test_all_planning_routes_require_login(settings):
    with TestClient(create_app(settings)) as client:
        assert client.get('/api/v1/orioks/planning').status_code == 401
        assert client.post('/api/v1/orioks/planning/preview', json={}).status_code == 401
        assert client.post('/api/v1/orioks/planning/schedule', json={}).status_code == 401
