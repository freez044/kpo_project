"""Read-only probe using an already saved token. Never print credentials or profile."""
from app.accounts import AccountService, AuthSettings, AccountError
from app.orioks import OrioksService
import json
import time

accounts = AccountService(AuthSettings())
service = OrioksService(accounts)
service.initialize()
with accounts.transaction() as db:
    rows = db.execute('SELECT user_id,token_encrypted FROM orioks_connections').fetchall()
if not rows:
    print('No existing connections')
for row in rows:
    token = service.decrypt(row['user_id'], row['token_encrypted'])
    for path in ['/schedule', '/schedule/groups', '/schedule/timetable']:
        try:
            result = service.client.get(path, token=token, deadline=time.monotonic() + 10)
            print(path, 'available', 'list' if isinstance(result, list) else 'object', 'count', len(result))
        except AccountError as error:
            print(path, 'unavailable', error.code)
