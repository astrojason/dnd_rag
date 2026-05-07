# DnD Oracle — TODO

## Decisions
- Sidebar always visible across all tabs
- Status transitions: from app (writes back to Obsidian) AND manual Obsidian edits both work
- MVP = simplest first, add complexity as used
- Plot threads stored as single `Plot Threads.md` file (one section per thread)
- Skip graph view for MVP — table only, graph added later
- PC×Thread matrix: two relationship types (involved / personal stake)
- RAG chat untouched throughout all phases

---

## Phase 0 — Navigation Shell ✓

> Goal: tab nav across the top of the main content area. Sidebar always visible on the right.

- [x] **`tauri-app/src/main.js`** — wrap existing chat area in a tab panel system. Three tabs: Oracle (current chat), Threads (placeholder), Session (placeholder). No logic changes to RAG chat.
- [x] **`tauri-app/src/style.css`** — `.tab-bar`, `.tab-panel` (show/hide), active tab indicator styled to D&D theme

---

## Phase 1 — Plot Thread Tracker MVP

### Data format — `03 Story/Plot Threads.md` in vault

YAML frontmatter = structured data for the app. Body = human-readable for Obsidian.

### Backend (`server.py`)

- [x] **`POST /threads/extract`** — accepts `{ player_recap, dm_recap }`, returns `{ proposed: [{title, description, pcs: [{name, role}]}] }`. Strict prompt (no invented content). Token-guarded. Uses `Settings.llm.complete()`. Guard if LLM not configured yet.
- [x] **`GET /threads`** — reads + parses `OBSIDIAN_VAULT/03 Story/Plot Threads.md` YAML frontmatter. Returns `{ threads: [] }` if file not found.
- [x] **`POST /threads/save`** — accepts `{ threads: [...] }`, returns `{ markdown: "..." }` (frontend writes to vault).
- [x] **`PATCH /threads/status`** — accepts `{ id, status }`, updates single thread status, returns `{ markdown: "..." }`.

### Frontend (`main.js`)

- [x] **`findLatestRecap(subfolder)`** shared helper — picks latest year folder under `03 Story/Sessions/{subfolder}`, returns last `.md` by filename. Shared with Phase 2.
- [x] **Threads tab panel** — PC×Thread matrix table (rows = threads, columns = active PCs, cells = Involved/Stake/empty), inline detail expander with status toggle that writes back to vault
- [x] **Approval modal** — loads latest recaps, calls `/threads/extract`, confirm/reject per proposed thread, merges confirmed threads into vault file

### Styling (`style.css`)

- [x] `.thread-matrix` table (sticky PC header row)
- [x] Status badges: `.badge-active` (gold), `.badge-dormant` (grey), `.badge-resolved` (green)
- [x] Cell relationship icons + thread detail expander

---

## Phase 2 — Session Planner

### Backend (`server.py`)

- [x] **`POST /session/next-steps`** SSE endpoint — accepts `{ player_recap, dm_recap }`. Strict extraction prompt, no invented content. Streams via `Settings.llm.stream_complete()`. Token-aware.

### Frontend (`main.js`)

- [x] **Session tab panel** — auto-discovers latest Player Recap + DM Element Tables recap via `findLatestRecap()`, collapsible raw panels, streams next steps, "Scan Threads from This Recap" bridges to Phase 1 approval modal

---

## Phase 3 — Encounter Builder *(future, unplanned)*

- XP budget + encounter multiplier math (DMG, shows working)
- Party-aware (reads PC notes for level/class)
- Monster seeds from faction/location notes
- Action economy analysis

---

## Relevant Files

| File | Changes |
|---|---|
| `server.py` | Phase 0.5: FS proxy. Phase 1: thread endpoints. Phase 2: `/session/next-steps` |
| `tauri-app/src/tauri-shim.js` | New — Tauri/browser invoke shim |
| `tauri-app/src/main.js` | Shim import, VITE_API_URL, tab system, threads panel + approval modal, session panel |
| `tauri-app/src/style.css` | Tab nav, matrix, badges, expander |
| `tauri-app/.env.development` | New — `VITE_API_URL=http://localhost:8765` |