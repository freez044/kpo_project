"""Проверить официальный endpoint без авторизации и вывода личных данных."""
import ssl
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

request = Request('https://orioks.miet.ru/api/v1/student', headers={'Accept': 'application/json', 'User-Agent': 'adaptive_planner/0.4 Windows'})
try:
    with urlopen(request, timeout=10, context=ssl.create_default_context()) as response:
        print('HTTP:', response.status)
        print('Content-Type:', response.headers.get('Content-Type'))
except HTTPError as error:
    print('HTTP:', error.code)
    print('Content-Type:', error.headers.get('Content-Type'))
except (URLError, OSError):
    print('API unavailable from this computer')
    raise SystemExit(1)
