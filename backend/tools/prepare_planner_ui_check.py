"""Изолированные локальные данные UI-проверки, только для созданного нами test account."""
import json
import sys
from datetime import datetime, timezone
from app.accounts import AccountService, AuthSettings
from app.local_tasks import TaskService
from app.orioks import OrioksService, Snapshot
from app.orioks_planner import OrioksPlanner, PlannerSettings

accounts = AccountService(AuthSettings())
TaskService(accounts).initialize()
orioks = OrioksService(accounts)
orioks.initialize()
planner = OrioksPlanner(orioks)
planner.initialize()
with accounts.transaction() as db:
    user = db.execute('SELECT id FROM users WHERE email=?', ('ui-check-1711@example.com',)).fetchone()
    if not user:
        raise SystemExit('Test account is missing')
    user_id = user['id']
    existing = db.execute('SELECT snapshot FROM orioks_connections WHERE user_id=?', (user_id,)).fetchone()
    if existing and (not existing['snapshot'] or json.loads(existing['snapshot'])['student']['group'] != 'ТЕСТ'):
        raise SystemExit('Refusing to replace a non-test connection')
    if '--cleanup' in sys.argv:
        if not existing:
            raise SystemExit('No test connection to clean')
        db.execute("DELETE FROM tasks WHERE user_id=? AND source='ORIOKS' AND json_extract(orioks_metadata,'$.discipline')=?", (user_id, 'Тест расчёта сроков'))
        for table in ('orioks_connections', 'orioks_planning', 'orioks_previews'):
            db.execute(f'DELETE FROM {table} WHERE user_id=?', (user_id,))
        db.commit()
        print('Isolated UI test data removed')
        raise SystemExit(0)
    snapshot = Snapshot.model_validate({'student': {'full_name': 'Тестовый студент', 'group': 'ТЕСТ', 'year': '2026-2027', 'semester': 1}, 'disciplines': [{'id': 424242, 'name': 'Тест расчёта сроков', 'max_grade': 100, 'events': [{'alias': 'ЛР.1', 'name': 'Проверка двух лабораторных пар', 'type': 'Лабораторная работа', 'week': 2, 'max_grade': 10}]}], 'syncedAt': datetime.now(timezone.utc).isoformat()})
    db.execute('INSERT OR REPLACE INTO orioks_connections (user_id,token_encrypted,snapshot) VALUES (?,?,?)', (user_id, orioks.encrypt(user_id, '0'*32), snapshot.model_dump_json()))
    slots = [{'disciplineId': 424242, 'scheduleName': 'Тест расчёта сроков', 'weekType': week, 'weekday': 2, 'pair': pair, 'start': start, 'end': end, 'teacher': 'Тест', 'classroom': 'Тест'} for week in (1,3) for pair,start,end in [(1,'09:00','10:30'),(2,'10:40','12:10')]]
    schedule = {'semesterStart': '2026-09-07', 'semesterEnd': '2026-12-31', 'slots': slots, 'scheduleNames': ['Тест расчёта сроков'], 'matchedSubjectIds': [424242], 'unmatchedCount': 0, 'missingTimeCount': 0, 'updatedAt': snapshot.syncedAt}
    settings = PlannerSettings.model_validate({'semesterStart':'2026-09-07','semesterEnd':'2026-12-31','rules':[{'disciplineId':424242}]})
    db.execute('INSERT OR REPLACE INTO orioks_planning (user_id,settings,schedule) VALUES (?,?,?)', (user_id, settings.model_dump_json(), json.dumps(schedule)))
print('Isolated UI test data prepared; no real ORIOKS requests')
