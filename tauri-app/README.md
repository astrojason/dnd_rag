# Azorian's Bounty Oracle — Tauri Desktop App

A dark-themed D&D campaign knowledge oracle built with Tauri 2.x (Rust) and a FastAPI Python backend.

---

## Prerequisites

| Tool | Notes |
|------|-------|
| **Rust** (stable) | Install via `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Node.js 18+** | `brew install node` or https://nodejs.org |
| **Python 3.10+** | Must match the project venv |
| **Project venv active** | `cd .. && source venv/bin/activate` |

The Python dependencies must already be installed in the project's venv:

```bash
cd /Users/jasonsylvester/Projects/tools/dnd_rag
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

You also need the ChromaDB index built before launching:

```bash
python ingest.py
```

---

## Development

```bash
cd tauri-app
npm install
npm run tauri dev
```

This will:
1. Start the Vite dev server on `http://localhost:1420`
2. Compile and launch the Tauri window
3. The Tauri app automatically spawns `server.py` (using `venv/bin/python3` if available, otherwise `python3`) on port `8765`

---

## Production Build

```bash
npm run tauri build
```

The distributable bundle (`.app` on macOS, `.exe` / `.msi` on Windows, `.deb` / `.AppImage` on Linux) will be placed in `src-tauri/target/release/bundle/`.

> **Note:** The bundled app still needs the Python server and venv present at the project root. The server is *not* embedded in the bundle — it is spawned from the project directory at runtime.

---

## Running the Server Manually

If you want to use the web UI without Tauri:

```bash
cd /Users/jasonsylvester/Projects/tools/dnd_rag
source venv/bin/activate
python server.py
# Then open http://127.0.0.1:8765 or point a browser at the Vite dev server
```

---

## Architecture

```
tauri-app/
  src/
    main.js        Vanilla JS chat UI — SSE streaming, status polling
    style.css      Dark D&D theme (Cinzel font, gold accents)
  src-tauri/
    src/
      main.rs      Tauri entry point
      lib.rs       Spawns server.py on startup, kills it on exit
    tauri.conf.json
    Cargo.toml
  index.html
  vite.config.js
  package.json

server.py          FastAPI server — /status, /query (SSE), /ingest (SSE)
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/status` | `{ loaded, loading, error, doc_count }` |
| `POST` | `/query`  | Body `{ question }`, SSE stream of `{ token }` then `{ sources }` |
| `POST` | `/ingest` | SSE stream of `{ progress }` lines from `ingest.py` subprocess |
