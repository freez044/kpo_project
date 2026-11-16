from app.accounts import AccountService, AuthSettings
from app.orioks import OrioksService, Snapshot
from app.orioks_planner import normalized, group_aliases
import time

def shape(value, depth=0):
    if depth > 5:
        return type(value).__name__
    if isinstance(value, dict):
        return {str(key): shape(item, depth+1) for key,item in list(value.items())[:9]}
    if isinstance(value, list):
        return [shape(value[0],depth+1)] if value else []
    return type(value).__name__

accounts=AccountService(AuthSettings())
service=OrioksService(accounts)
service.initialize()
with accounts.transaction() as db:
    rows=db.execute('SELECT * FROM orioks_connections WHERE snapshot IS NOT NULL').fetchall()
for row in rows:
    token=service.decrypt(row['user_id'],row['token_encrypted'])
    get=lambda path: service.client.get(path,token=token,deadline=time.monotonic()+10)
    student=Snapshot.model_validate_json(row['snapshot']).student
    groups=get('/schedule/groups')
    matched=[group for group in groups if normalized(group['name'])==normalized(student.group)]
    if not matched:
        matched=[group for group in groups if group_aliases(group['name']) & group_aliases(student.group)]
    print('semester schema:',shape(get('/schedule')))
    print('timetable schema:',shape(get('/schedule/timetable')))
    if len(matched)==1:
        data=get('/schedule/groups/'+str(int(matched[0]['id']))); print('group schedule schema:',shape(data)); print('numeric schedule ranges:', {key: sorted({item[key] for item in data}) for key in ['day','class','week','week_recurrence']})


    import json; print('lesson types:', json.dumps(sorted({item['type'] for item in data}), ensure_ascii=True))


