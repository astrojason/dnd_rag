"""
FastAPI server wrapping the D&D RAG query engine.
Runs on port 8765. Start with: python server.py
"""

import asyncio
import json
import os
import pickle
import re
import sys
import threading
from pathlib import Path
from typing import AsyncGenerator

import httpx
from urllib.parse import quote
from config import OBSIDIAN_VAULT
import tiktoken
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Token tracker
# ---------------------------------------------------------------------------

_TRACKER_URL = "https://token-tracker-roan.vercel.app/api/tokens"
_DAILY_LIMIT = 250_000
_enc = tiktoken.encoding_for_model("gpt-4o-mini")


def _get_tokens_used() -> int:
    try:
        res = httpx.get(_TRACKER_URL, timeout=5.0)
        return res.json().get("tokens", 0)
    except Exception:
        return 0  # fail open


def _report_tokens(count: int) -> None:
    try:
        httpx.post(_TRACKER_URL, json={"tokens": count}, timeout=5.0)
    except Exception:
        pass  # fail silently

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(title="DnD RAG Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------

_LAST_INGEST_PATH = Path(__file__).parent / "data" / "last_ingest.txt"


def _read_last_ingest() -> str | None:
    try:
        return _LAST_INGEST_PATH.read_text().strip() or None
    except FileNotFoundError:
        return None


def _write_last_ingest() -> None:
    from datetime import datetime, timezone
    _LAST_INGEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    _LAST_INGEST_PATH.write_text(datetime.now(timezone.utc).isoformat())


_state = {
    "loaded": False,
    "loading": False,
    "loading_step": None,
    "loading_started_at": None,
    "error": None,
    "doc_count": 0,
    "query_engine": None,
    "index": None,
    "nodes": None,
    "last_ingest": _read_last_ingest(),
}

_LOAD_TIMEOUT = 300  # seconds before declaring the reload hung

# ---------------------------------------------------------------------------
# Index loading (runs in background thread at startup)
# ---------------------------------------------------------------------------


def _step(msg: str) -> None:
    """Update the loading step visible via /status."""
    _state["loading_step"] = msg
    print(f"[server] {msg}")


def _load_index() -> None:
    """Load ChromaDB + BM25 index. Runs once in a background thread."""
    import time
    _state["loading"] = True
    _state["loading_step"] = "Starting..."
    _state["loading_started_at"] = time.monotonic()
    _state["error"] = None

    try:
        # Import here so we don't block the event loop at module load time
        from config import (
            CHROMA_DB_PATH,
            OPENAI_API_KEY,
            USE_OPENAI_EMBEDDINGS,
        )
        from llama_index.core import Settings, VectorStoreIndex
        from llama_index.core.prompts import PromptTemplate
        from llama_index.core.query_engine import RetrieverQueryEngine
        from llama_index.core.retrievers import QueryFusionRetriever
        from llama_index.llms.openai import OpenAI
        from llama_index.retrievers.bm25 import BM25Retriever
        from llama_index.vector_stores.chroma import ChromaVectorStore
        import chromadb

        _step("Configuring OpenAI LLM...")
        Settings.llm = OpenAI(model="gpt-4o-mini", api_key=OPENAI_API_KEY)

        if USE_OPENAI_EMBEDDINGS:
            from llama_index.embeddings.openai import OpenAIEmbedding
            _step("Configuring embeddings...")
            Settings.embed_model = OpenAIEmbedding(
                model="text-embedding-3-small", api_key=OPENAI_API_KEY
            )

        _step("Opening ChromaDB...")
        chroma_client = chromadb.PersistentClient(path=str(CHROMA_DB_PATH))
        chroma_collection = chroma_client.get_collection("dnd_campaign")

        nodes_path = Path(CHROMA_DB_PATH) / "bm25_nodes.pkl"
        if not nodes_path.exists():
            raise FileNotFoundError(
                f"BM25 nodes not found at {nodes_path}. Run ingest.py first."
            )

        _step("Loading BM25 nodes from cache...")
        with open(nodes_path, "rb") as f:
            nodes = pickle.load(f)

        _step(f"Building vector index ({len(nodes):,} chunks)...")
        vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
        index = VectorStoreIndex.from_vector_store(vector_store)

        _step("Setting up hybrid retriever...")
        vector_retriever = index.as_retriever(similarity_top_k=10)
        bm25_retriever = BM25Retriever.from_defaults(
            nodes=nodes, similarity_top_k=10
        )

        hybrid_retriever = QueryFusionRetriever(
            retrievers=[vector_retriever, bm25_retriever],
            similarity_top_k=15,
            num_queries=1,
            mode="reciprocal_rerank",
            use_async=False,
        )

        STRICT_QA_PROMPT = PromptTemplate(
            "You are an assistant for a D&D campaign. Answer ONLY using the campaign notes provided below.\n"
            "If the answer is not present in the notes, say exactly: "
            '"I don\'t have that information in my campaign notes."\n'
            "Do NOT use your general knowledge to fill in gaps or invent details.\n\n"
            "Campaign notes:\n"
            "---------------------\n"
            "{context_str}\n"
            "---------------------\n\n"
            "Question: {query_str}\n"
            "Answer: "
        )

        query_engine = RetrieverQueryEngine.from_args(
            retriever=hybrid_retriever,
            llm=Settings.llm,
            text_qa_template=STRICT_QA_PROMPT,
            streaming=True,
        )

        _state["index"] = index
        _state["query_engine"] = query_engine
        _state["nodes"] = nodes
        _state["doc_count"] = len(nodes)
        _state["loaded"] = True
        _state["loading"] = False
        _state["loading_step"] = None
        _state["loading_started_at"] = None
        print(f"[server] Index loaded. {len(nodes)} chunks ready.")

    except Exception as exc:
        _state["loading"] = False
        _state["loaded"] = False
        _state["loading_step"] = None
        _state["loading_started_at"] = None
        _state["error"] = str(exc)
        print(f"[server] ERROR loading index: {exc}", file=sys.stderr)


def _watchdog() -> None:
    """Background thread: marks the load as failed if it exceeds _LOAD_TIMEOUT."""
    import time
    while True:
        time.sleep(10)
        if _state["loading"] and _state["loading_started_at"] is not None:
            elapsed = time.monotonic() - _state["loading_started_at"]
            if elapsed > _LOAD_TIMEOUT:
                _state["loading"] = False
                _state["loading_step"] = None
                _state["loading_started_at"] = None
                _state["error"] = (
                    f"Index load timed out after {int(elapsed)}s on step: "
                    f"{_state.get('loading_step') or 'unknown'}. "
                    f"ChromaDB may be locked — restart the server to retry."
                )
                print(f"[server] WATCHDOG: {_state['error']}", file=sys.stderr)


@app.on_event("startup")
async def startup_event() -> None:
    threading.Thread(target=_watchdog, daemon=True).start()
    threading.Thread(target=_load_index, daemon=True).start()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


class QueryRequest(BaseModel):
    question: str


@app.get("/status")
async def get_status():
    return {
        "loaded": _state["loaded"],
        "loading": _state["loading"],
        "loading_step": _state["loading_step"],
        "loading_elapsed": (
            int(__import__("time").monotonic() - _state["loading_started_at"])
            if _state["loading"] and _state["loading_started_at"] is not None
            else None
        ),
        "error": _state["error"],
        "doc_count": _state["doc_count"],
        "last_ingest": _state["last_ingest"],
    }


@app.get("/tokens")
async def get_tokens():
    loop = asyncio.get_event_loop()
    used = await loop.run_in_executor(None, _get_tokens_used)
    return {"used": used, "limit": _DAILY_LIMIT}


# ---------------------------------------------------------------------------
# Tool helpers
# ---------------------------------------------------------------------------

_EXCLUDE_DIRS = {"ZZ_Workbench", "00 To Process"}


def _extract_section(content: str, section_name: str) -> str:
    """Return the text body of the first markdown heading matching section_name."""
    pattern = r'(?m)^#{1,4}\s+' + re.escape(section_name) + r'\s*\n(.*?)(?=\n#{1,4}\s|\Z)'
    m = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
    return m.group(1).strip() if m else ""


def _get_active_pc_info() -> str:
    """Read active PC files and return name + goals for shop weighting."""
    pc_dir = OBSIDIAN_VAULT / "02 Characters" / "PCs"
    if not pc_dir.exists():
        return ""
    summaries = []
    for pc_file in sorted(pc_dir.glob("*.md")):
        try:
            content = pc_file.read_text(errors="replace")
            if "#inactive" in content or "#deceased" in content:
                continue
            name = pc_file.stem
            goal = _extract_section(content, "Primary Goal") or _extract_section(content, "Goals")
            summaries.append(f"{name}: {goal[:200]}" if goal else f"{name}")
        except Exception:
            continue
    return "\n".join(summaries)


def _build_shop_prompt(location_name: str, location_notes: str, pc_info: str) -> str:
    pc_section = (
        f"\n\nActive party members and their goals (weight inventory to what they need):\n{pc_info}"
        if pc_info else ""
    )
    loc_section = f"\n\nLocation notes (use to inform the types of shops present):\n{location_notes[:800]}" if location_notes else ""
    return (
        f'Generate exactly 10 D&D shops for the location "{location_name}".\n\n'
        "REQUIRED — you MUST include exactly these three:\n"
        "1. A magic items shop\n"
        "2. A weapons shop\n"
        "3. An armor shop\n\n"
        "Fill the remaining 7 with shops appropriate for the location's character."
        + loc_section
        + pc_section + "\n\n"
        "For the magic items, weapons, and armor shops: list 5–8 specific items in stock "
        "with a general price range (e.g. '50–200 gp'). Weight inventory toward what the "
        "party actually needs based on their goals.\n"
        "For other shops: describe their general stock in one sentence.\n\n"
        "Each shop has 1–2 proprietors. Generate a full NPC block for each proprietor.\n"
        "Proprietor characteristics must be ACTIONABLE — things they DO, not just personality traits.\n\n"
        "Format each shop EXACTLY as shown below. Use --- on its own line to separate shops. "
        "No extra text before the first shop or after the last ---.\n\n"
        "**[Creative Shop Name]** ([Shop Type])\n"
        "- Description: [one sentence about atmosphere/specialty]\n"
        "- Inventory: [items with price ranges, or general stock description]\n\n"
        "Proprietors:\n"
        "**[Full Name]** ([PRONUNCIATION])\n"
        "- Race: [race] | Gender: [gender]\n"
        "- Appearance: [one sentence]\n"
        "- Characteristics: [habit 1], [habit 2], [habit 3]\n\n"
        "---\n\n"
        "Example:\n"
        "**The Ember Forge** (Weapons Shop)\n"
        "- Description: Soot-stained walls and the constant ring of hammer on steel.\n"
        "- Inventory: Longswords (15–50 gp), Daggers (2–10 gp), Warhammers (15 gp)\n\n"
        "Proprietors:\n"
        "**Borii Blackshield** (BORE-ee BLACK-sheeld)\n"
        "- Race: Goliath | Gender: Male\n"
        "- Appearance: Stone-grey skin etched with tribal tattoos, broad as a barrel.\n"
        "- Characteristics: Slaps backs hard in greeting, downs tankards in one go, never breaks eye contact\n\n"
        "---"
    )


def _build_npc_prompt(location_name: str, population: str, count: int) -> str:
    if population:
        seed = f'for the location "{location_name}" using these population demographics as a racial distribution guide:\n\n{population}'
    elif location_name:
        seed = f'for the location "{location_name}"'
    else:
        seed = "for a generic D&D settlement"
    return (
        f"Generate exactly {count} D&D NPCs {seed}\n\n"
        "Requirements:\n"
        "- Match racial proportions to the demographics\n"
        "- Randomly assign genders; include androgynous or non-binary for ~10–15% of NPCs\n"
        "- Characteristics must be ACTIONABLE — things they DO, not just personality traits\n"
        "- Appearance: one concise sentence\n\n"
        "Format each NPC exactly as follows (blank line between each NPC, no extra text):\n\n"
        "**[Full Name]** ([PRONUNCIATION])\n"
        "- Race: [race] | Gender: [gender]\n"
        "- Appearance: [one sentence]\n"
        "- Characteristics: [habit 1], [habit 2], [habit 3]\n\n"
        "Example:\n"
        "**Borii Blackshield** (BORE-ee BLACK-sheeld)\n"
        "- Race: Goliath | Gender: Male\n"
        "- Appearance: Stone-grey skin etched with tribal tattoos, broad as a barrel.\n"
        "- Characteristics: Slaps backs hard in greeting, downs tankards in one go, "
        "never breaks eye contact"
    )


# ---------------------------------------------------------------------------
# Tool endpoints
# ---------------------------------------------------------------------------


@app.get("/locations")
async def locations_endpoint():
    """Return location folders that have an overview or same-name md file."""
    locations = []
    seen: set = set()
    try:
        for md_file in sorted(OBSIDIAN_VAULT.rglob("*.md")):
            rel = md_file.relative_to(OBSIDIAN_VAULT)
            if any(str(rel).startswith(ex) for ex in _EXCLUDE_DIRS):
                continue
            if md_file.name.startswith("."):
                continue
            folder = md_file.parent
            if folder in seen or folder == OBSIDIAN_VAULT:
                continue
            folder_name = folder.name
            # Prefer [folder_name].md, then overview.md (case-insensitive match)
            preferred: Path | None = None
            for candidate_name in [f"{folder_name}.md", "overview.md", "Overview.md"]:
                candidate = folder / candidate_name
                if candidate.exists():
                    preferred = candidate
                    break
            if preferred:
                seen.add(folder)
                locations.append({"name": folder_name, "path": str(preferred)})
    except Exception as exc:
        print(f"[server] /locations error: {exc}", file=sys.stderr)
    return {"locations": locations}


class NpcRequest(BaseModel):
    location_name: str
    location_path: str
    count: int = 10


@app.post("/generate/npcs")
async def generate_npcs_endpoint(req: NpcRequest):
    """SSE streaming endpoint: streams LLM-generated NPCs for a location."""

    async def generate() -> AsyncGenerator[str, None]:
        if not _state["loaded"]:
            yield f"data: {json.dumps({'error': 'Index not loaded yet.'})}\n\n"
            return

        try:
            from llama_index.core import Settings
            import queue as _queue

            population = ""
            if req.location_path:
                file_path = Path(req.location_path)
                if file_path.exists():
                    content = file_path.read_text(errors="replace")
                    population = _extract_section(content, "Population")

            prompt = _build_npc_prompt(req.location_name, population, req.count)
            q: _queue.Queue = _queue.Queue()

            def stream_thread() -> None:
                try:
                    for chunk in Settings.llm.stream_complete(prompt):
                        if chunk.delta:
                            q.put(("token", chunk.delta))
                    q.put(("done", None))
                except Exception as e:
                    q.put(("error", str(e)))

            threading.Thread(target=stream_thread, daemon=True).start()

            loop = asyncio.get_event_loop()
            while True:
                kind, value = await loop.run_in_executor(None, q.get)
                if kind == "token":
                    yield f"data: {json.dumps({'token': value})}\n\n"
                elif kind == "done":
                    yield 'data: {"done": true}\n\n'
                    break
                else:
                    yield f"data: {json.dumps({'error': value})}\n\n"
                    break

        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


class ShopRequest(BaseModel):
    location_name: str
    location_path: str


@app.post("/generate/shops")
async def generate_shops_endpoint(req: ShopRequest):
    """SSE streaming endpoint: streams LLM-generated shops for a location."""

    async def generate() -> AsyncGenerator[str, None]:
        if not _state["loaded"]:
            yield f"data: {json.dumps({'error': 'Index not loaded yet.'})}\n\n"
            return

        try:
            from llama_index.core import Settings
            import queue as _queue

            file_path = Path(req.location_path)
            location_notes = ""
            if file_path.exists():
                content = file_path.read_text(errors="replace")
                # Use description / overview section if present, else first 800 chars
                location_notes = (
                    _extract_section(content, "Description")
                    or _extract_section(content, "Overview")
                    or content[:800]
                )

            pc_info = _get_active_pc_info()
            prompt = _build_shop_prompt(req.location_name, location_notes, pc_info)
            q: _queue.Queue = _queue.Queue()

            def stream_thread() -> None:
                try:
                    for chunk in Settings.llm.stream_complete(prompt):
                        if chunk.delta:
                            q.put(("token", chunk.delta))
                    q.put(("done", None))
                except Exception as e:
                    q.put(("error", str(e)))

            threading.Thread(target=stream_thread, daemon=True).start()

            loop = asyncio.get_event_loop()
            while True:
                kind, value = await loop.run_in_executor(None, q.get)
                if kind == "token":
                    yield f"data: {json.dumps({'token': value})}\n\n"
                elif kind == "done":
                    yield 'data: {"done": true}\n\n'
                    break
                else:
                    yield f"data: {json.dumps({'error': value})}\n\n"
                    break

        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/suggest")
async def suggest_endpoint():
    """Generate 5 relevant questions based on a sample of indexed content."""
    if not _state["loaded"] or not _state.get("nodes"):
        return {"questions": []}

    import random
    from llama_index.core import Settings

    nodes = _state["nodes"]
    sampled = random.sample(nodes, min(20, len(nodes)))
    context = "\n\n---\n\n".join(n.get_content()[:400] for n in sampled)

    prompt = (
        "Based on these D&D campaign notes, generate exactly 5 short, specific questions "
        "a player or DM might want to ask. Make them concrete — reference actual names, "
        "places, or events from the notes. Each question should be under 10 words.\n"
        "Respond with ONLY a JSON array of 5 strings, no other text.\n\n"
        f"Campaign notes:\n{context}\n\nJSON array:"
    )

    loop = asyncio.get_event_loop()
    try:
        response = await loop.run_in_executor(None, lambda: Settings.llm.complete(prompt))
        text = response.text.strip()
        start = text.find('[')
        end = text.rfind(']') + 1
        if start >= 0 and end > start:
            questions = json.loads(text[start:end])
            if isinstance(questions, list):
                return {"questions": [str(q) for q in questions[:5]]}
    except Exception as exc:
        print(f"[server] /suggest failed: {exc}", file=sys.stderr)

    return {"questions": []}


@app.post("/query")
async def query_endpoint(req: QueryRequest):
    """SSE streaming endpoint: yields tokens then a sources payload."""

    async def generate() -> AsyncGenerator[str, None]:
        if not _state["loaded"]:
            payload = json.dumps({"error": "Index not loaded yet. Please wait."})
            yield f"data: {payload}\n\n"
            return

        question = req.question.strip()
        if not question:
            payload = json.dumps({"error": "Empty question."})
            yield f"data: {payload}\n\n"
            return

        try:
            # ── Pre-flight: check daily token limit ──────────────────────
            loop = asyncio.get_event_loop()
            used = await loop.run_in_executor(None, _get_tokens_used)
            if used >= _DAILY_LIMIT:
                payload = json.dumps({
                    "limit_exceeded": True,
                    "used": used,
                    "limit": _DAILY_LIMIT,
                })
                yield f"data: {payload}\n\n"
                return

            query_engine = _state["query_engine"]

            # Run the (blocking) query in a thread pool so we don't block the event loop
            response = await loop.run_in_executor(
                None, lambda: query_engine.query(question)
            )

            # Stream tokens, accumulating for token counting
            full_response = ""
            for token in response.response_gen:
                full_response += token
                payload = json.dumps({"token": token})
                yield f"data: {payload}\n\n"

            # ── Count tokens (tiktoken approximation) ────────────────────
            output_tokens = len(_enc.encode(full_response))
            context_text = " ".join(
                n.node.get_content()
                for n in (response.source_nodes or [])
            )
            input_tokens = (
                len(_enc.encode(context_text))
                + len(_enc.encode(question))
                + 200  # prompt template overhead
            )
            total_tokens = input_tokens + output_tokens

            # Report in background (non-blocking)
            loop.run_in_executor(None, _report_tokens, total_tokens)

            # Build sources list
            sources = []
            if hasattr(response, "source_nodes") and response.source_nodes:
                for node in response.source_nodes:
                    meta = node.node.metadata or {}
                    file_path = meta.get("file_path", "")
                    file_name = Path(file_path).name if file_path else meta.get("file_name", "Unknown")
                    obsidian_url = None
                    try:
                        rel = Path(file_path).relative_to(OBSIDIAN_VAULT)
                        note = str(rel.with_suffix(""))
                        obsidian_url = f"obsidian://open?vault={quote(OBSIDIAN_VAULT.name)}&file={quote(note)}"
                    except (ValueError, Exception):
                        pass
                    sources.append(
                        {
                            "file": file_name,
                            "file_path": file_path,
                            "obsidian_url": obsidian_url,
                            "category": meta.get("category", ""),
                            "text": node.node.get_content()[:300],
                            "score": round(float(node.score or 0), 4),
                        }
                    )

            payload = json.dumps({"sources": sources})
            yield f"data: {payload}\n\n"

            payload = json.dumps({"tokens_used": total_tokens, "tokens_total": used + total_tokens})
            yield f"data: {payload}\n\n"

            yield 'data: {"done": true}\n\n'

        except Exception as exc:
            payload = json.dumps({"error": str(exc)})
            yield f"data: {payload}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


class IngestRequest(BaseModel):
    rebuild: bool = False


@app.post("/ingest")
async def ingest_endpoint(req: IngestRequest = IngestRequest()):
    """SSE streaming endpoint: runs ingest.py as a subprocess and streams its stdout."""

    async def generate() -> AsyncGenerator[str, None]:
        # Locate the project root (same directory as this file)
        project_root = Path(__file__).parent.resolve()
        ingest_script = project_root / "ingest.py"

        # Prefer the venv python
        venv_python = project_root / "venv" / "bin" / "python3"
        python_exe = str(venv_python) if venv_python.exists() else sys.executable

        try:
            cmd = [python_exe, str(ingest_script)]
            if req.rebuild:
                cmd.append("--rebuild")
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(project_root),
            )

            # Stream stdout line by line
            assert proc.stdout is not None
            async for raw_line in proc.stdout:
                line = raw_line.decode("utf-8", errors="replace").rstrip()
                if line:
                    payload = json.dumps({"progress": line})
                    yield f"data: {payload}\n\n"

            await proc.wait()

            if proc.returncode == 0:
                _write_last_ingest()
                _state["last_ingest"] = _read_last_ingest()

                payload = json.dumps(
                    {"progress": "Indexing complete. Reloading index...", "done": False}
                )
                yield f"data: {payload}\n\n"

                # Reload the index in background
                _state["loaded"] = False
                _state["loading"] = True
                threading.Thread(target=_load_index, daemon=True).start()

                payload = json.dumps(
                    {"progress": "Index reload started.", "done": True}
                )
                yield f"data: {payload}\n\n"
            else:
                payload = json.dumps(
                    {
                        "error": f"ingest.py exited with code {proc.returncode}",
                        "done": True,
                    }
                )
                yield f"data: {payload}\n\n"

        except Exception as exc:
            payload = json.dumps({"error": str(exc), "done": True})
            yield f"data: {payload}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Save-to-vault endpoints
# ---------------------------------------------------------------------------

_NPC_TYPES = {"Major", "Minor", "Villains"}


class SaveNpcRequest(BaseModel):
    name: str
    pronunciation: str
    race: str
    gender: str
    appearance: str
    characteristics: str
    location_name: str = ""
    npc_type: str = "Minor"


@app.post("/save/npc")
async def save_npc_endpoint(req: SaveNpcRequest):
    from datetime import date
    today = date.today().isoformat()
    npc_type = req.npc_type if req.npc_type in _NPC_TYPES else "Minor"
    safe_name = re.sub(r'[^\w\s\'\-]', '', req.name).strip()
    save_dir = OBSIDIAN_VAULT / "02 Characters" / "NPCs" / npc_type
    save_dir.mkdir(parents=True, exist_ok=True)
    file_path = save_dir / f"{safe_name}.md"
    loc_line = f"\nLocation: [[{req.location_name}]]" if req.location_name else ""
    content = (
        f"# {req.name}\n\n"
        f"Category: Characters / NPCs / {npc_type}{loc_line}\n\n"
        f"#npc #{npc_type.lower()} #generated #date/{today}\n\n"
        f"- Race: {req.race} | Gender: {req.gender}\n"
        f"- Pronunciation: {req.pronunciation}\n\n"
        f"## Appearance\n{req.appearance}\n\n"
        f"## Characteristics\n{req.characteristics}\n"
    )
    try:
        file_path.write_text(content)
        return {"success": True, "path": str(file_path)}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


def _parse_proprietor_names(text: str) -> list:
    """Extract individual NPC names from 'Name1 and Name2 — description' format."""
    names_part = re.split(r'\s*[—–-]{1,2}\s*', text, maxsplit=1)[0].strip()
    names = re.split(r'\s+and\s+', names_part, flags=re.IGNORECASE)
    return [n.strip() for n in names if n.strip()]


def _collect_world_locations(root: Path, current: Path, results: list, rel_parts: list) -> None:
    try:
        entries = sorted(current.iterdir(), key=lambda p: p.name)
    except PermissionError:
        return
    for entry in entries:
        if entry.name.startswith('.'):
            continue
        if entry.is_dir():
            crumb = " > ".join(rel_parts + [entry.name])
            main_note = entry / f"{entry.name}.md"
            results.append({
                "name": entry.name,
                "display_name": crumb,
                "folder_path": str(entry),
                "note_path": str(main_note) if main_note.exists() else None,
            })
            _collect_world_locations(root, entry, results, rel_parts + [entry.name])


@app.get("/locations/world")
async def world_locations_endpoint():
    """Return all location folders under 01 World/Locations with breadcrumb display names."""
    locations_root = OBSIDIAN_VAULT / "01 World" / "Locations"
    results: list = []
    if locations_root.exists():
        _collect_world_locations(locations_root, locations_root, results, [])
    return {"locations": results}


class NpcData(BaseModel):
    name: str
    pronunciation: str = ""
    race: str = ""
    gender: str = ""
    appearance: str = ""
    characteristics: str = ""


class SaveShopRequest(BaseModel):
    name: str
    shop_type: str = ""
    description: str = ""
    inventory: str = ""
    location_name: str = ""
    location_folder_path: str = ""
    npcs: list[NpcData] = []


@app.post("/save/shop")
async def save_shop_endpoint(req: SaveShopRequest):
    from datetime import date
    today = date.today().isoformat()
    safe_name = re.sub(r'[^\w\s\'\-]', '', req.name).strip()

    # Shop file lives inside the chosen location folder's Shops/ subfolder
    if req.location_folder_path:
        shops_dir = Path(req.location_folder_path) / "Shops"
    else:
        shops_dir = OBSIDIAN_VAULT / "01 World" / "Shops"
    shops_dir.mkdir(parents=True, exist_ok=True)
    file_path = shops_dir / f"{safe_name}.md"

    # Build proprietor wiki-links from NPC data
    prop_links = ", ".join(f"[[{npc.name}]]" for npc in req.npcs) if req.npcs else ""

    loc_line  = f"\nLocation: [[{req.location_name}]]" if req.location_name else ""
    type_line = f"\n- Type: {req.shop_type}" if req.shop_type else ""
    content = (
        f"# {req.name}\n\n"
        f"Category: Shops{loc_line}\n\n"
        f"#shop #generated #date/{today}{type_line}\n\n"
        f"## Proprietors\n{prop_links}\n\n"
        f"## Description\n{req.description}\n\n"
        f"## Inventory\n{req.inventory}\n"
    )
    try:
        file_path.write_text(content)
    except Exception as exc:
        return {"success": False, "error": str(exc)}

    # Create Minor NPC files for each proprietor (skip if file already exists)
    npc_dir = OBSIDIAN_VAULT / "02 Characters" / "NPCs" / "Minor"
    npc_dir.mkdir(parents=True, exist_ok=True)
    npc_paths = []
    for npc in req.npcs:
        safe_prop = re.sub(r'[^\w\s\'\-]', '', npc.name).strip()
        npc_path = npc_dir / f"{safe_prop}.md"
        if not npc_path.exists():
            loc_npc_line = f"\nLocation: [[{req.location_name}]]" if req.location_name else ""
            pron_line = f"- Pronunciation: {npc.pronunciation}\n" if npc.pronunciation else ""
            appearance_section = f"## Appearance\n{npc.appearance}\n\n" if npc.appearance else ""
            characteristics_section = f"## Characteristics\n{npc.characteristics}\n\n" if npc.characteristics else ""
            npc_content = (
                f"# {npc.name}\n\n"
                f"Category: Characters / NPCs / Minor{loc_npc_line}\n\n"
                f"#npc #minor #proprietor #generated #date/{today}\n\n"
                f"- Race: {npc.race} | Gender: {npc.gender}\n"
                f"{pron_line}"
                f"- Proprietor of: [[{req.name}]]\n\n"
                f"{appearance_section}"
                f"{characteristics_section}"
            )
            try:
                npc_path.write_text(npc_content)
                npc_paths.append(str(npc_path))
            except Exception:
                pass

    return {"success": True, "path": str(file_path), "npc_paths": npc_paths}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
