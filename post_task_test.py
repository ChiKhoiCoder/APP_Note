import urllib.request, urllib.parse, http.cookiejar

cj = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
base = 'http://127.0.0.1:8001'

# register
data = urllib.parse.urlencode({'username':'tester2','password':'password'}).encode()
req = urllib.request.Request(base + '/api/register', data=data)
try:
    resp = opener.open(req)
    print('register status', resp.status)
    print(resp.read().decode())
except Exception as e:
    print('register error', e)

# create task
data = urllib.parse.urlencode({'title':'CI test task 2','category':'Work','deadline':'2026-06-20','priority':'high'}).encode()
req = urllib.request.Request(base + '/api/tasks', data=data)
try:
    resp = opener.open(req)
    print('create status', resp.status)
    print(resp.read().decode())
except urllib.error.HTTPError as e:
    print('HTTPError', e.code)
    print(e.read().decode())
except Exception as e:
    print('Error', e)
