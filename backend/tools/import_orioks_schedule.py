"""Load schedule cache for existing connections; print only non-personal counts."""
from app.accounts import AccountService, AuthSettings, AccountError
from app.orioks import OrioksService
from app.orioks_planner import OrioksPlanner
from app.local_tasks import TaskService

accounts = AccountService(AuthSettings())
TaskService(accounts).initialize()
orioks = OrioksService(accounts)
orioks.initialize()
planner = OrioksPlanner(orioks)
planner.initialize()
with accounts.transaction() as db:
    rows = db.execute('SELECT user_id FROM orioks_connections').fetchall()
for row in rows:
    try:
        state = planner.import_schedule(row['user_id'])
        schedule = state['schedule']
        print('Schedule imported; matched subjects:', len(schedule['matchedSubjectIds']), '; laboratory slots:', len(schedule['slots']), '; semester dates present:', bool(schedule['semesterStart']), bool(schedule['semesterEnd']))
    except AccountError as error:
        print('Schedule could not be imported:', error.code)
