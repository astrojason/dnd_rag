# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Stack

Python + FastAPI + Ollama (local embeddings) + ChromaDB (vector store) + OpenAI (`gpt-4o-mini`). Optional Docker. Also contains a `tauri-app/` frontend.

## Commands

```bash
source venv/bin/activate

python ingest.py     # index the Obsidian vault into ChromaDB
python query.py      # run a one-off query from the command line
python server.py     # start the FastAPI server (port 8765)
```

```bash
docker compose up --build   # run via Docker
```

Work is not complete until the server starts cleanly and queries return grounded answers.

## Test-driven workflow

No automated tests exist yet. New features should add pytest tests before implementation.

## Error handling

Nothing is allowed to fail silently. FastAPI routes must return structured error responses with clear messages — no bare `except: pass`. CLI scripts must raise exceptions with descriptive messages when the Ollama server is unreachable, the index is missing, or API calls fail.

## TODO.md

Keep `TODO.md` up to date:

- Add an entry for every bug, feature, or enhancement before work begins.
- Remove items from TODO.md once the work has been committed — do not leave them checked off. The git log is the record.

## Versioning

Maintain a `VERSION` file at the project root (semver, e.g. `1.0.0`). The version must be displayed in the app UI.

- Any commit touching files other than `CLAUDE.md` must include a version bump — patch for fixes, minor for new features, major for breaking changes. CLAUDE.md-only commits may use `--no-verify` to skip the bump.
- The version displayed must be a clickable link to a `/changelog` view. The changelog renders the git log — each entry shows the short hash and commit message (`git log --pretty=format:"%h %s" -n 50`). Implement as a FastAPI route if not already present.
