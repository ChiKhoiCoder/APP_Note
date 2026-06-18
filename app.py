from fastapi import FastAPI, Request, Response, HTTPException, status, Form
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from typing import Optional
import datetime, uuid, sqlite3, os, hashlib, hmac, binascii

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

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

@app.on_event('startup')
def startup_event():
    if not os.path.exists(DB_PATH):
        init_db()

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
def index(request: Request):
    session = request.cookies.get('session')
    if not session:
        return RedirectResponse('/login')
    username = _verify_session_cookie(session)
    if not username:
        return RedirectResponse('/login')
    return templates.TemplateResponse("index.html", {"request": request, "username": username})

@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})

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
def api_list_tasks(request: Request, q: Optional[str] = None, status: Optional[str] = None, priority: Optional[str] = None):
    username = request.cookies.get("session")
    if username:
        username = _verify_session_cookie(username)
    if not username:
        return JSONResponse({"tasks": []})
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM tasks WHERE username=?', (username,))
    rows = cur.fetchall()
    conn.close()
    tasks = []
    for r in rows:
        tasks.append({
            'id': r['id'], 'title': r['title'], 'completed': bool(r['completed']), 'created': r['created'],
            'deadline': r['deadline'], 'category': r['category'], 'priority': r['priority']
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

@app.post("/api/tasks")
def api_create_task(request: Request, title: str = Form(...), category: str = Form(""), deadline: str = Form(""), priority: str = Form("medium")):
    username = request.cookies.get('session')
    if username:
        username = _verify_session_cookie(username)
    if not username:
        raise HTTPException(status_code=401)
    tid = str(uuid.uuid4())
    conn = get_db()
    cur = conn.cursor()
    cur.execute('INSERT INTO tasks(id,username,title,completed,created,deadline,category,priority) VALUES(?,?,?,?,?,?,?,?)',
                (tid, username, title, 0, _now_iso(), deadline, category, priority))
    conn.commit()
    conn.close()
    task = {"id": tid, "title": title, "completed": False, "created": _now_iso(), "deadline": deadline, "category": category, "priority": priority}
    return JSONResponse({"task": task})

@app.put("/api/tasks/{task_id}")
def api_update_task(request: Request, task_id: str, title: Optional[str] = Form(None), deadline: Optional[str] = Form(None), category: Optional[str] = Form(None), priority: Optional[str] = Form(None)):
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
    if updates:
        params.extend([task_id, username])
        cur.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id=? AND username=?", params)
        conn.commit()
    cur.execute('SELECT * FROM tasks WHERE id=?', (task_id,))
    r = cur.fetchone(); conn.close()
    return JSONResponse({"task": {"id": r['id'], "title": r['title'], "completed": bool(r['completed']), "created": r['created'], "deadline": r['deadline'], "category": r['category'], "priority": r['priority']}})

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