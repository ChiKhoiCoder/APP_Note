import sqlite3
import os

db = os.path.join(os.path.dirname(__file__), 'data.db')
if not os.path.exists(db):
    print('DB not found:', db)
    raise SystemExit(1)
conn = sqlite3.connect(db)
print('Tables:')
for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'"):
    print('-', r[0])
print('\nPRAGMA table_info(tasks):')
for r in conn.execute("PRAGMA table_info(tasks)"):
    print(r)
print('\nPRAGMA table_info(assignees):')
for r in conn.execute("PRAGMA table_info(assignees)"):
    print(r)
print('\nPRAGMA table_info(chats):')
for r in conn.execute("PRAGMA table_info(chats)"):
    print(r)
conn.close()
