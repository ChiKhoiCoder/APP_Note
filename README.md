# Tasks Pro — Run & Deploy

This repository contains a FastAPI-based todo app with static frontend assets. Below are quick instructions to run locally and deploy.

Requirements
- Python 3.10+
- Docker (optional)

Local (dev)

1. Create a virtual env and install:
```bash
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

2. Run the app locally:
```bash
uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

Open http://127.0.0.1:8000

Production (Render / Heroku / Docker)

- Heroku or Render: set the start command or use the provided `Procfile`.
- Make sure to set an environment variable `TODO_SECRET` for session signing in production.

Render quick steps:
1. Create a new Web Service, connect your repo.
2. Set build command: `pip install -r requirements.txt`
3. Set start command: `gunicorn -k uvicorn.workers.UvicornWorker app:app --bind 0.0.0.0:$PORT`

Docker
```bash
docker build -t tasks-pro .
docker run -p 8000:8000 -e TODO_SECRET=your_secret tasks-pro
```

Notes
- The app uses SQLite (`data.db`) for persistence. Ensure writable disk on server.
- Static files are under `/static`. Chart.js is loaded from CDN.
