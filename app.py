from fastapi import FastAPI, Request, Response, HTTPException, status, Form, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from typing import Optional
import datetime, uuid, sqlite3, os, hashlib, hmac, binascii, sys
import os as _os
import json
import httpx

# Ensure python uses UTF-8 mode to avoid console encoding errors on Windows
try:
    os.environ.setdefault('PYTHONUTF8', '1')
except Exception:
    pass

app = FastAPI()
# Mount static using absolute path relative to this file so uvicorn can start from workspace root
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), 'static')), name="static")
templates = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), 'templates'))

DB_PATH = os.path.join(os.path.dirname(__file__), 'data.db')

def _now_iso():
    return datetime.datetime.utcnow().isoformat()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute('''
    CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password TEXT NOT NULL
    )''')
    cur.execute('''
    CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        title TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        created TEXT,
        deadline TEXT,
        category TEXT,
        priority TEXT,
        FOREIGN KEY(username) REFERENCES users(username)
    )''')
    conn.commit()
    conn.close()
    # ensure chats table exists
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute('''
        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT,
            role TEXT,
            content TEXT,
            created TEXT
        )''')
        conn.commit(); conn.close()
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
    # ensure position column exists for drag-and-drop ordering
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("ALTER TABLE tasks ADD COLUMN position INTEGER DEFAULT 0")
        conn.commit(); conn.close()
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
    # ensure tags column exists
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("ALTER TABLE tasks ADD COLUMN tags TEXT DEFAULT ''")
        conn.commit(); conn.close()
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
    # ensure status and assignee columns exist
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute("ALTER TABLE tasks ADD COLUMN status TEXT DEFAULT 'todo'")
        cur.execute("ALTER TABLE tasks ADD COLUMN assignee TEXT DEFAULT ''")
        conn.commit(); conn.close()
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
    # ensure assignees table exists (map assignee name -> avatar path)
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute('CREATE TABLE IF NOT EXISTS assignees (name TEXT PRIMARY KEY, avatar TEXT)')
        conn.commit(); conn.close()
    except Exception:
        try:
            conn.close()
        except Exception:
            pass

@app.on_event('startup')
def startup_event():
    # Ensure DB exists
    # Run migrations / ensure schema is up-to-date on every startup
    try:
        init_db()
    except Exception:
        pass
    # Try to force stdout/stderr to utf-8 to avoid UnicodeEncodeError in Windows console logging
    try:
        if hasattr(sys.stdout, 'reconfigure'):
            sys.stdout.reconfigure(encoding='utf-8')
        if hasattr(sys.stderr, 'reconfigure'):
            sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        try:
            import importlib
            importlib.reload(sys)
        except Exception:
            pass

def require_user(request: Request):
    # Verify signed session cookie
    session = request.cookies.get('session')
    if not session:
        raise HTTPException(status_code=401, detail='Not authenticated')
    username = _verify_session_cookie(session)
    if not username:
        raise HTTPException(status_code=401, detail='Not authenticated')
    # verify exists in DB
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT username FROM users WHERE username=?', (username,))
    row = cur.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail='Not authenticated')
    return username


# --- simple password hashing & session signing ---
SECRET_KEY = os.environ.get('TODO_SECRET') or 'change-me-please'

def _hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
    return binascii.hexlify(salt).decode() + '$' + binascii.hexlify(dk).decode()

def _verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, dk_hex = stored.split('$')
        salt = binascii.unhexlify(salt_hex)
        dk = binascii.unhexlify(dk_hex)
        new = hashlib.pbkdf2_hmac('sha256', password.encode(), salt, 100000)
        return hmac.compare_digest(new, dk)
    except Exception:
        return False

def _make_session_cookie(username: str) -> str:
    sig = hmac.new(SECRET_KEY.encode(), username.encode(), hashlib.sha256).hexdigest()
    return f"{username}|{sig}"

def _verify_session_cookie(cookie: str) -> Optional[str]:
    try:
        username, sig = cookie.split('|')
        expect = hmac.new(SECRET_KEY.encode(), username.encode(), hashlib.sha256).hexdigest()
        if hmac.compare_digest(expect, sig):
            return username
    except Exception:
        return None
    return None


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, task: str = None, delete: str = None):
    session = request.cookies.get('session')
    if not session:
        return RedirectResponse('/login')
    username = _verify_session_cookie(session)
    if not username:
        return RedirectResponse('/login')

    # build todo_list for template context
    todo_list = []
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute('SELECT * FROM tasks WHERE username=?', (username,))
        rows = cur.fetchall()
        for r in rows:
            todo_list.append({
                'id': r['id'], 'title': r['title'], 'completed': bool(r['completed']), 'created': r['created'],
                'deadline': r['deadline'], 'category': r['category'], 'priority': r['priority']
            })
        conn.close()
    except Exception:
        todo_list = []

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={"todos": todo_list, "username": username}
    )

@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
       return templates.TemplateResponse(request=request, name="login.html", context={})


# serve favicon if present to avoid 500s on clients requesting /favicon.ico
@app.get('/favicon.ico')
def favicon():
    p = os.path.join(os.path.dirname(__file__), 'static', 'favicon.ico')
    if os.path.exists(p):
        from fastapi.responses import FileResponse
        return FileResponse(p)
    return Response(status_code=204)

@app.get("/register", response_class=HTMLResponse)
def register_page(request: Request):
    return templates.TemplateResponse("register.html", {"request": request})

# --- Auth API (very simple demo) ---
@app.post("/api/register")
def api_register(response: Response, username: str = Form(...), password: str = Form(...)):
    conn = get_db()
    cur = conn.cursor()
    try:
        hashed = _hash_password(password)
        cur.execute('INSERT INTO users(username,password) VALUES(?,?)', (username, hashed))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return JSONResponse({"error": "User exists"}, status_code=400)
    conn.close()
    resp = JSONResponse({"ok": True})
    resp.set_cookie("session", _make_session_cookie(username), httponly=True)
    return resp

@app.post("/api/login")
def api_login(response: Response, username: str = Form(...), password: str = Form(...)):
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT password FROM users WHERE username=?', (username,))
    row = cur.fetchone()
    if not row:
        conn.close(); return JSONResponse({"error": "Invalid"}, status_code=401)
    stored = row['password']
    # Support legacy plain-text passwords: if verify fails but plain matches, re-hash
    if _verify_password(password, stored):
        conn.close()
        resp = JSONResponse({"ok": True})
        resp.set_cookie("session", _make_session_cookie(username), httponly=True)
        return resp
    else:
        # fallback: plain equality
        if password == stored:
            # re-hash and update
            newh = _hash_password(password)
            cur.execute('UPDATE users SET password=? WHERE username=?', (newh, username))
            conn.commit(); conn.close()
            resp = JSONResponse({"ok": True})
            resp.set_cookie("session", _make_session_cookie(username), httponly=True)
            return resp
        conn.close()
        return JSONResponse({"error": "Invalid"}, status_code=401)

@app.post("/api/logout")
def api_logout(response: Response):
    response = JSONResponse({"ok": True})
    response.delete_cookie("session")
    return response


# --- Task APIs ---
@app.get("/api/tasks")
def api_list_tasks(request: Request, q: Optional[str] = None, status: Optional[str] = None, priority: Optional[str] = None, tag: Optional[str] = None):
    username = request.cookies.get("session")
    if username:
        username = _verify_session_cookie(username)
    if not username:
        return JSONResponse({"tasks": []})
    conn = get_db()
    cur = conn.cursor()
    # include assignee avatar if available via subquery
    if tag:
        cur.execute("SELECT tasks.*, (SELECT avatar FROM assignees WHERE name=tasks.assignee) AS assignee_avatar FROM tasks WHERE username=? AND tags LIKE ? ORDER BY position ASC", (username, f'%{tag}%'))
    else:
        cur.execute("SELECT tasks.*, (SELECT avatar FROM assignees WHERE name=tasks.assignee) AS assignee_avatar FROM tasks WHERE username=? ORDER BY position ASC", (username,))
    rows = cur.fetchall()
    conn.close()
    tasks = []
    for r in rows:
        tasks.append({
            'id': r['id'], 'title': r['title'], 'completed': bool(r['completed']), 'created': r['created'],
            'deadline': r['deadline'], 'category': r['category'], 'priority': r['priority'], 'tags': r['tags'] if 'tags' in r.keys() else '', 'status': r['status'] if 'status' in r.keys() else 'todo', 'assignee': r['assignee'] if 'assignee' in r.keys() else '', 'assignee_avatar': r['assignee_avatar'] if 'assignee_avatar' in r.keys() else None
        })
    res = tasks
    if q:
        res = [t for t in res if q.lower() in t['title'].lower()]
    if status == 'done':
        res = [t for t in res if t['completed']]
    if status == 'todo':
        res = [t for t in res if not t['completed']]
    if priority:
        res = [t for t in res if t.get('priority') == priority]
    return JSONResponse({"tasks": res})


@app.get('/api/stats/full')
def api_stats_full(request: Request, days: int = 14):
    # returns overall counts plus a simple time-series for the last `days`
    session = request.cookies.get('session')
    if session:
        username = _verify_session_cookie(session)
    else:
        username = None
    if not username:
        return JSONResponse({'total': 0, 'completed': 0, 'percent': 0, 'trend': []})
    conn = get_db(); cur = conn.cursor()
    cur.execute('SELECT COUNT(*) as c, SUM(completed) as s FROM tasks WHERE username=?', (username,))
    row = cur.fetchone()
    total = row['c'] or 0
    completed = row['s'] or 0
    percent = int((completed/total*100) if total else 0)

    # build daily trend (created count per day)
    trend = []
    now = datetime.datetime.utcnow()
    for i in range(days-1, -1, -1):
        d = (now - datetime.timedelta(days=i)).date().isoformat()
        cur.execute("SELECT COUNT(*) as c, SUM(completed) as s FROM tasks WHERE username=? AND date(created)=?", (username, d))
        r = cur.fetchone()
        trend.append({'date': d, 'created': r['c'] or 0, 'completed': r['s'] or 0})
    conn.close()
    return JSONResponse({'total': total, 'completed': completed, 'percent': percent, 'trend': trend})


@app.get('/api/tasks/export')
def api_tasks_export(request: Request):
    session = request.cookies.get('session')
    if session:
        username = _verify_session_cookie(session)
    else:
        username = None
    if not username:
        raise HTTPException(status_code=401)
    conn = get_db(); cur = conn.cursor()
    cur.execute('SELECT id,title,completed,created,deadline,category,priority,tags FROM tasks WHERE username=? ORDER BY position ASC', (username,))
    rows = cur.fetchall(); conn.close()
    # build CSV
    import io, csv
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(['id','title','completed','created','deadline','category','priority','tags'])
    for r in rows:
        writer.writerow([r['id'], r['title'], int(r['completed']), r['created'] or '', r['deadline'] or '', r['category'] or '', r['priority'] or '', r['tags'] or ''])
    csv_data = out.getvalue(); out.close()
    return Response(content=csv_data, media_type='text/csv')


@app.get('/api/reminders')
def api_reminders(request: Request, within_days: int = 1):
    session = request.cookies.get('session')
    if session:
        username = _verify_session_cookie(session)
    else:
        username = None
    if not username:
        return JSONResponse({'reminders': []})
    conn = get_db(); cur = conn.cursor()
    cur.execute('SELECT * FROM tasks WHERE username=? AND completed=0', (username,))
    rows = cur.fetchall(); conn.close()
    now = datetime.datetime.utcnow()
    reminders = []
    for r in rows:
        if r['deadline']:
            try:
                d = datetime.datetime.fromisoformat(r['deadline'])
            except Exception:
                continue
            delta = (d - now).total_seconds() / (60*60*24)
            if delta <= within_days:
                reminders.append({
                    'id': r['id'], 'title': r['title'], 'deadline': r['deadline']
                })
    return JSONResponse({'reminders': reminders})


# Simple rule-based chat endpoint for assistant/help
@app.post('/api/chat')
async def api_chat(request: Request):
    # read JSON body safely
    data = {}
    try:
        data = await request.json()
    except Exception:
        try:
            form = await request.form()
            data = dict(form)
        except Exception:
            data = {}
    msg = data.get('message') if isinstance(data, dict) else None
    if not msg:
        msg = request.query_params.get('message')
    if not msg:
        return JSONResponse({'error': 'no message'}, status_code=400)
    m = msg.lower()
    # If OPENAI_API_KEY is configured, proxy to OpenAI ChatCompletion
    OPENAI_KEY = _os.environ.get('OPENAI_API_KEY')
    if OPENAI_KEY:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                payload = {
                    'model': 'gpt-3.5-turbo',
                    'messages': [
                        {'role': 'system', 'content': 'You are a helpful assistant for a todo web app named Tasks Pro.'},
                        {'role': 'user', 'content': msg}
                    ],
                    'max_tokens': 300
                }
                headers = {'Authorization': f'Bearer {OPENAI_KEY}'}
                r = await client.post('https://api.openai.com/v1/chat/completions', json=payload, headers=headers)
                jr = r.json()
                if r.status_code == 200 and 'choices' in jr and jr['choices']:
                    reply = jr['choices'][0]['message']['content']
                    return JSONResponse({'reply': reply})
        except Exception:
            pass

    # very small rule-based replies
    if 'hello' in m or 'xin chào' in m or 'hi' in m:
        reply = 'Xin chào! Tôi là trợ lý Tasks Pro — tôi có thể giúp bạn với nhắc việc, tìm hiểu tính năng hoặc hướng dẫn deploy.'
    elif 'nhắc' in m or 'remind' in m:
        reply = 'Bạn có thể bật nhắc bằng checkbox ở góc phải bên dưới; để gửi email/SMS, cấu hình SMTP/Twilio trong cài đặt server.'
    elif 'deploy' in m or 'render' in m or 'heroku' in m:
        reply = 'Để deploy, dùng Docker hoặc Render/Heroku. Tôi đã thêm Dockerfile & Procfile; bạn cần đặt TODO_SECRET và đảm bảo data.db có quyền ghi.'
    elif 'thống kê' in m or 'chart' in m:
        reply = 'Thống kê hiển thị tổng, hoàn thành và tỷ lệ — biểu đồ dùng Chart.js.'
    else:
        reply = "Xin lỗi, tôi chưa hiểu. Hỏi về 'nhắc', 'deploy', 'thống kê' hoặc 'help' nhé."
    # persist chat history if user logged in
    session = request.cookies.get('session')
    username = None
    if session:
        username = _verify_session_cookie(session)
    try:
        if username:
            conn = get_db(); cur = conn.cursor()
            cur.execute('INSERT INTO chats(username, role, content, created) VALUES(?,?,?,?)', (username, 'user', msg, _now_iso()))
            cur.execute('INSERT INTO chats(username, role, content, created) VALUES(?,?,?,?)', (username, 'assistant', reply, _now_iso()))
            conn.commit(); conn.close()
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
    return JSONResponse({'reply': reply})


@app.post('/api/assignees/avatar')
async def api_upload_assignee_avatar(request: Request, name: str = Form(...), file: UploadFile = File(...)):
    # only allow logged-in users to upload
    session = request.cookies.get('session')
    if session:
        username = _verify_session_cookie(session)
    else:
        username = None
    if not username:
        raise HTTPException(status_code=401)
    # ensure avatars dir
    avatars_dir = os.path.join(os.path.dirname(__file__), 'static', 'avatars')
    os.makedirs(avatars_dir, exist_ok=True)
    import re
    safe = re.sub(r'[^a-z0-9_-]', '_', name.lower())[:64]
    ext = os.path.splitext(file.filename)[1] or '.png'
    fname = f"{safe}{ext}"
    out_path = os.path.join(avatars_dir, fname)
    contents = await file.read()
    with open(out_path, 'wb') as fh:
        fh.write(contents)
    url = f"/static/avatars/{fname}"
    # persist mapping
    try:
        conn = get_db(); cur = conn.cursor()
        cur.execute('CREATE TABLE IF NOT EXISTS assignees (name TEXT PRIMARY KEY, avatar TEXT)')
        cur.execute('INSERT OR REPLACE INTO assignees(name, avatar) VALUES(?,?)', (name, url))
        conn.commit(); conn.close()
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
    return JSONResponse({'ok': True, 'url': url})


@app.get('/api/chat/history')
def api_chat_history(request: Request, limit: int = 50):
    session = request.cookies.get('session')
    if not session:
        return JSONResponse({'messages': []})
    username = _verify_session_cookie(session)
    if not username:
        return JSONResponse({'messages': []})
    conn = get_db(); cur = conn.cursor()
    cur.execute('SELECT role, content, created FROM chats WHERE username=? ORDER BY id DESC LIMIT ?', (username, limit))
    rows = cur.fetchall(); conn.close()
    msgs = []
    for r in reversed(rows):
        msgs.append({'role': r['role'], 'content': r['content'], 'created': r['created']})
    return JSONResponse({'messages': msgs})

@app.post("/api/tasks")
def api_create_task(request: Request, title: str = Form(...), category: str = Form(""), deadline: str = Form(""), priority: str = Form("medium"), tags: str = Form(""), status: str = Form("todo"), assignee: str = Form("")):
    username = request.cookies.get('session')
    if username:
        username = _verify_session_cookie(username)
    if not username:
        raise HTTPException(status_code=401)
    tid = str(uuid.uuid4())
    conn = get_db()
    cur = conn.cursor()
    # decide position = max(position)+1
    try:
        cur.execute('SELECT MAX(position) as mx FROM tasks WHERE username=?', (username,))
        mx = cur.fetchone()['mx'] or 0
        pos = int(mx) + 1
    except Exception:
        pos = 0
    cur.execute('INSERT INTO tasks(id,username,title,completed,created,deadline,category,priority,position,tags,status,assignee) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                (tid, username, title, 0, _now_iso(), deadline, category, priority, pos, tags, status, assignee))
    conn.commit()
    conn.close()
    task = {"id": tid, "title": title, "completed": False, "created": _now_iso(), "deadline": deadline, "category": category, "priority": priority, 'tags': tags, 'status': status, 'assignee': assignee}
    return JSONResponse({"task": task})

@app.put("/api/tasks/{task_id}")
def api_update_task(request: Request, task_id: str, title: Optional[str] = Form(None), deadline: Optional[str] = Form(None), category: Optional[str] = Form(None), priority: Optional[str] = Form(None), tags: Optional[str] = Form(None), status: Optional[str] = Form(None), assignee: Optional[str] = Form(None)):
    username = request.cookies.get('session')
    if username:
        username = _verify_session_cookie(username)
    if not username:
        raise HTTPException(status_code=401)
    conn = get_db(); cur = conn.cursor()
    cur.execute('SELECT * FROM tasks WHERE id=? AND username=?', (task_id, username))
    row = cur.fetchone()
    if not row:
        conn.close(); raise HTTPException(status_code=404)
    updates = []
    params = []
    if title is not None:
        updates.append('title=?'); params.append(title)
    if deadline is not None:
        updates.append('deadline=?'); params.append(deadline)
    if category is not None:
        updates.append('category=?'); params.append(category)
    if priority is not None:
        updates.append('priority=?'); params.append(priority)
    if tags is not None:
        updates.append('tags=?'); params.append(tags)
    if status is not None:
        updates.append('status=?'); params.append(status)
    if assignee is not None:
        updates.append('assignee=?'); params.append(assignee)
    if updates:
        params.extend([task_id, username])
        cur.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id=? AND username=?", params)
        conn.commit()
    cur.execute('SELECT * FROM tasks WHERE id=?', (task_id,))
    r = cur.fetchone(); conn.close()
    return JSONResponse({"task": {"id": r['id'], "title": r['title'], "completed": bool(r['completed']), "created": r['created'], "deadline": r['deadline'], "category": r['category'], "priority": r['priority'], "tags": (r['tags'] if 'tags' in r.keys() else ''), "status": (r['status'] if 'status' in r.keys() else 'todo'), "assignee": (r['assignee'] if 'assignee' in r.keys() else '')}})

@app.post("/api/tasks/{task_id}/toggle")
def api_toggle_task(task_id: str, request: Request):
    username = request.cookies.get('session')
    if username:
        username = _verify_session_cookie(username)
    if not username:
        raise HTTPException(status_code=401)
    conn = get_db(); cur = conn.cursor()
    cur.execute('SELECT completed FROM tasks WHERE id=? AND username=?', (task_id, username))
    row = cur.fetchone()
    if not row:
        conn.close(); raise HTTPException(status_code=404)
    new = 0 if row['completed'] else 1
    cur.execute('UPDATE tasks SET completed=? WHERE id=? AND username=?', (new, task_id, username))
    # if marked completed, set status to done; if unchecked, set to todo
    try:
        if new:
            cur.execute('UPDATE tasks SET status=? WHERE id=? AND username=?', ('done', task_id, username))
        else:
            cur.execute('UPDATE tasks SET status=? WHERE id=? AND username=?', ('todo', task_id, username))
    except Exception:
        pass
    conn.commit()
    cur.execute('SELECT * FROM tasks WHERE id=?', (task_id,))
    r = cur.fetchone(); conn.close()
    return JSONResponse({"task": {"id": r['id'], "title": r['title'], "completed": bool(r['completed']), "created": r['created'], "deadline": r['deadline'], "category": r['category'], "priority": r['priority']}})

@app.delete("/api/tasks/{task_id}")
def api_delete_task(task_id: str, request: Request):
    username = request.cookies.get('session')
    if username:
        username = _verify_session_cookie(username)
    if not username:
        raise HTTPException(status_code=401)
    conn = get_db(); cur = conn.cursor()
    cur.execute('DELETE FROM tasks WHERE id=? AND username=?', (task_id, username))
    if cur.rowcount == 0:
        conn.close(); raise HTTPException(status_code=404)
    conn.commit(); conn.close()
    return JSONResponse({"ok": True})


@app.post('/api/tasks/reorder')
def api_reorder(request: Request):
    # body: {order: [id1, id2, ...]}
    try:
        payload = request.json()
    except Exception:
        payload = {}
    order = payload.get('order') if isinstance(payload, dict) else None
    session = request.cookies.get('session')
    if session:
        username = _verify_session_cookie(session)
    else:
        username = None
    if not username:
        raise HTTPException(status_code=401)
    if not order or not isinstance(order, list):
        return JSONResponse({'error': 'invalid order'}, status_code=400)
    conn = get_db(); cur = conn.cursor()
    try:
        for idx, tid in enumerate(order):
            cur.execute('UPDATE tasks SET position=? WHERE id=? AND username=?', (idx, tid, username))
        conn.commit()
    finally:
        conn.close()
    return JSONResponse({'ok': True})

@app.get("/api/stats")
def api_stats(request: Request):
    username = request.cookies.get('session')
    if username:
        username = _verify_session_cookie(username)
    if not username:
        return JSONResponse({"total": 0, "completed": 0, "percent": 0})
    conn = get_db(); cur = conn.cursor()
    cur.execute('SELECT COUNT(*) as total FROM tasks WHERE username=?', (username,))
    total = cur.fetchone()['total']
    cur.execute('SELECT COUNT(*) as done FROM tasks WHERE username=? AND completed=1', (username,))
    done = cur.fetchone()['done']
    conn.close()
    percent = int((done / total) * 100) if total else 0
    return JSONResponse({"total": total, "completed": done, "percent": percent})