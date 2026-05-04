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
_enc = tiktoken.encoding_for_model("gpt-4o-mini")  # pre-flight estimates only

# Per-request token counter (reset before each LLM call, read after)
_token_counter = None
_token_counter_lock = threading.Lock()


def _reset_token_counter() -> None:
    if _token_counter is not None:
        with _token_counter_lock:
            _token_counter.reset_counts()


def _read_token_count() -> int:
    if _token_counter is None:
        return 0
    with _token_counter_lock:
        return (
            _token_counter.total_llm_token_count
            + _token_counter.total_embedding_token_count
        )


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
        from llama_index.core.callbacks import CallbackManager, TokenCountingHandler
        from llama_index.core.prompts import PromptTemplate
        from llama_index.core.query_engine import RetrieverQueryEngine
        from llama_index.core.retrievers import QueryFusionRetriever
        from llama_index.llms.openai import OpenAI
        from llama_index.retrievers.bm25 import BM25Retriever
        from llama_index.vector_stores.chroma import ChromaVectorStore
        import chromadb

        _step("Configuring OpenAI LLM...")
        global _token_counter
        _token_counter = TokenCountingHandler(
            tokenizer=tiktoken.encoding_for_model("gpt-4o-mini").encode
        )
        Settings.callback_manager = CallbackManager([_token_counter])
        Settings.llm = OpenAI(model="gpt-4o-mini", api_key=OPENAI_API_KEY)

        if USE_OPENAI_EMBEDDINGS:
            from llama_index.embeddings.openai import OpenAIEmbedding
            _step("Configuring embeddings...")
            Settings.embed_model = OpenAIEmbedding(
                model="text-embedding-3-small", api_key=OPENAI_API_KEY
            )

        _step("Opening ChromaDB...")
        chroma_client = chromadb.PersistentClient(path=str(CHROMA_DB_PATH))
        existing = [c.name for c in chroma_client.list_collections()]
        if "dnd_campaign" not in existing:
            _state["loading"] = False
            _state["loaded"] = False
            _state["loading_step"] = None
            _state["loading_started_at"] = None
            _state["error"] = "Not yet indexed. Run sync_to_server.sh on the Mac to build the index."
            print(f"[server] {_state['error']}", file=sys.stderr)
            return
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
    loop = asyncio.get_running_loop()
    used = await loop.run_in_executor(None, _get_tokens_used)
    return {"used": used, "limit": _DAILY_LIMIT}


# ---------------------------------------------------------------------------
# Tool helpers
# ---------------------------------------------------------------------------

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


class NpcRequest(BaseModel):
    location_name: str
    population: str = ""
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

            prompt = _build_npc_prompt(req.location_name, req.population, req.count)
            full_text = ""
            q: _queue.Queue = _queue.Queue()
            _reset_token_counter()

            def stream_thread() -> None:
                try:
                    for chunk in Settings.llm.stream_complete(prompt):
                        if chunk.delta:
                            q.put(("token", chunk.delta))
                    q.put(("done", None))
                except Exception as e:
                    q.put(("error", str(e)))

            threading.Thread(target=stream_thread, daemon=True).start()

            loop = asyncio.get_running_loop()
            while True:
                kind, value = await loop.run_in_executor(None, q.get)
                if kind == "token":
                    full_text += value
                    yield f"data: {json.dumps({'token': value})}\n\n"
                elif kind == "done":
                    yield 'data: {"done": true}\n\n'
                    loop.run_in_executor(None, _report_tokens, _read_token_count())
                    break
                else:
                    yield f"data: {json.dumps({'error': value})}\n\n"
                    break

        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class ShopRequest(BaseModel):
    location_name: str
    location_content: str = ""
    pc_info: str = ""


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

            prompt = _build_shop_prompt(req.location_name, req.location_content, req.pc_info)
            full_text = ""
            q: _queue.Queue = _queue.Queue()
            _reset_token_counter()

            def stream_thread() -> None:
                try:
                    for chunk in Settings.llm.stream_complete(prompt):
                        if chunk.delta:
                            q.put(("token", chunk.delta))
                    q.put(("done", None))
                except Exception as e:
                    q.put(("error", str(e)))

            threading.Thread(target=stream_thread, daemon=True).start()

            loop = asyncio.get_running_loop()
            while True:
                kind, value = await loop.run_in_executor(None, q.get)
                if kind == "token":
                    full_text += value
                    yield f"data: {json.dumps({'token': value})}\n\n"
                elif kind == "done":
                    yield 'data: {"done": true}\n\n'
                    loop.run_in_executor(None, _report_tokens, _read_token_count())
                    break
                else:
                    yield f"data: {json.dumps({'error': value})}\n\n"
                    break

        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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

    loop = asyncio.get_running_loop()
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
            import queue as _queue
            # ── Pre-flight: check daily token limit ──────────────────────
            loop = asyncio.get_running_loop()
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
            q: _queue.Queue = _queue.Queue()
            _reset_token_counter()

            def query_thread() -> None:
                try:
                    response = query_engine.query(question)
                    for token in response.response_gen:
                        q.put(("token", token, None))
                    q.put(("done", None, response))
                except Exception as e:
                    q.put(("error", str(e), None))

            threading.Thread(target=query_thread, daemon=True).start()

            full_response = ""
            final_response = None
            while True:
                kind, value, extra = await loop.run_in_executor(None, q.get)
                if kind == "token":
                    full_response += value
                    payload = json.dumps({"token": value})
                    yield f"data: {payload}\n\n"
                elif kind == "done":
                    final_response = extra
                    break
                else:
                    payload = json.dumps({"error": value})
                    yield f"data: {payload}\n\n"
                    return

            # Report actual API usage via TokenCountingHandler
            total_tokens = _read_token_count()

            # Report in background (non-blocking)
            loop.run_in_executor(None, _report_tokens, total_tokens)

            # Build sources list
            sources = []
            if final_response and hasattr(final_response, "source_nodes") and final_response.source_nodes:
                for node in final_response.source_nodes:
                    meta = node.node.metadata or {}
                    file_path = meta.get("file_path", "")
                    file_name = Path(file_path).name if file_path else meta.get("file_name", "Unknown")
                    obsidian_url = None
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

    return StreamingResponse(generate(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/reload")
async def reload_endpoint():
    """Trigger a background reload of the ChromaDB index."""
    if _state["loading"]:
        return {"status": "already_loading", "step": _state["loading_step"]}
    _state["loaded"] = False
    _state["loading"] = True
    threading.Thread(target=_load_index, daemon=True).start()
    return {"status": "reload_started"}


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
    loc_line = f"\nLocation: [[{req.location_name}]]" if req.location_name else ""
    markdown = (
        f"# {req.name}\n\n"
        f"Category: Characters / NPCs / {npc_type}{loc_line}\n\n"
        f"#npc #{npc_type.lower()} #generated #date/{today}\n\n"
        f"- Race: {req.race} | Gender: {req.gender}\n"
        f"- Pronunciation: {req.pronunciation}\n\n"
        f"## Appearance\n{req.appearance}\n\n"
        f"## Characteristics\n{req.characteristics}\n"
    )
    return {"markdown": markdown}


def _parse_proprietor_names(text: str) -> list:
    """Extract individual NPC names from 'Name1 and Name2 — description' format."""
    names_part = re.split(r'\s*[—–-]{1,2}\s*', text, maxsplit=1)[0].strip()
    names = re.split(r'\s+and\s+', names_part, flags=re.IGNORECASE)
    return [n.strip() for n in names if n.strip()]


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

    # Build proprietor wiki-links from NPC data
    prop_links = ", ".join(f"[[{npc.name}]]" for npc in req.npcs) if req.npcs else ""

    loc_line  = f"\nLocation: [[{req.location_name}]]" if req.location_name else ""
    type_line = f"\n- Type: {req.shop_type}" if req.shop_type else ""
    shop_markdown = (
        f"# {req.name}\n\n"
        f"Category: Shops{loc_line}\n\n"
        f"#shop #generated #date/{today}{type_line}\n\n"
        f"## Proprietors\n{prop_links}\n\n"
        f"## Description\n{req.description}\n\n"
        f"## Inventory\n{req.inventory}\n"
    )

    # Build NPC markdown for each proprietor
    npc_markdowns: dict[str, str] = {}
    for npc in req.npcs:
        loc_npc_line = f"\nLocation: [[{req.location_name}]]" if req.location_name else ""
        pron_line = f"- Pronunciation: {npc.pronunciation}\n" if npc.pronunciation else ""
        appearance_section = f"## Appearance\n{npc.appearance}\n\n" if npc.appearance else ""
        characteristics_section = f"## Characteristics\n{npc.characteristics}\n\n" if npc.characteristics else ""
        npc_markdown = (
            f"# {npc.name}\n\n"
            f"Category: Characters / NPCs / Minor{loc_npc_line}\n\n"
            f"#npc #minor #proprietor #generated #date/{today}\n\n"
            f"- Race: {npc.race} | Gender: {npc.gender}\n"
            f"{pron_line}"
            f"- Proprietor of: [[{req.name}]]\n\n"
            f"{appearance_section}"
            f"{characteristics_section}"
        )
        npc_markdowns[npc.name] = npc_markdown

    return {"shop_markdown": shop_markdown, "npc_markdowns": npc_markdowns}


# ---------------------------------------------------------------------------
# Thread tracker helpers
# ---------------------------------------------------------------------------


def _parse_threads_file(content: str) -> list:
    """Parse YAML frontmatter from a Plot Threads.md file."""
    import yaml
    if not content.startswith("---"):
        return []
    end = content.find("\n---", 3)
    if end < 0:
        return []
    front = content[3:end].strip()
    try:
        data = yaml.safe_load(front)
        if isinstance(data, dict) and isinstance(data.get("threads"), list):
            return data["threads"]
    except Exception:
        pass
    return []


def _build_threads_markdown(threads: list) -> str:
    """Build the full Plot Threads.md content from a list of thread dicts."""
    import yaml
    data = {"threads": threads}
    front = yaml.dump(data, allow_unicode=True, sort_keys=False, default_flow_style=False)
    status_labels = {"active": "Active", "dormant": "Dormant", "resolved": "Resolved"}
    lines = ["---", front.strip(), "---", "", "# Plot Threads", ""]
    for t in threads:
        status = t.get("status", "active")
        label = status_labels.get(status, status.title())
        lines.append(f"## {t.get('title', 'Untitled')} ({label})")
        if t.get("description"):
            lines.extend(["", t["description"]])
        pcs = t.get("pcs", [])
        if pcs:
            lines.extend(["", "**PCs:**"])
            for pc in pcs:
                lines.append(f"- {pc.get('name', '?')} ({pc.get('role', 'involved')})")
        lines.append("")
    return "\n".join(lines)


def _thread_slug(title: str) -> str:
    slug = re.sub(r"[^\w]+", "-", title.lower()).strip("-")
    return f"thread-{slug[:40]}"


# ---------------------------------------------------------------------------
# Thread tracker endpoints
# ---------------------------------------------------------------------------


class ThreadsSaveRequest(BaseModel):
    threads: list[dict]


class ThreadStatusRequest(BaseModel):
    id: str
    status: str


class ThreadsExtractRequest(BaseModel):
    player_recap: str
    dm_recap: str = ""


@app.get("/threads")
async def get_threads():
    """Read and parse Plot Threads.md from the vault."""
    from config import OBSIDIAN_VAULT
    threads_path = Path(OBSIDIAN_VAULT) / "03 Story" / "Plot Threads.md"
    if not threads_path.exists():
        return {"threads": []}
    try:
        content = threads_path.read_text(encoding="utf-8")
        return {"threads": _parse_threads_file(content)}
    except Exception as exc:
        return {"threads": [], "error": str(exc)}


@app.post("/threads/save")
async def save_threads(req: ThreadsSaveRequest):
    """Generate Plot Threads.md markdown. Frontend writes the file to vault."""
    existing_ids: set = set()
    threads_out = []
    for t in req.threads:
        t = dict(t)
        if not t.get("id"):
            base = _thread_slug(t.get("title", "untitled"))
            uid = base
            counter = 2
            while uid in existing_ids:
                uid = f"{base}-{counter}"
                counter += 1
            t["id"] = uid
        existing_ids.add(t.get("id", ""))
        if "status" not in t:
            t["status"] = "active"
        threads_out.append(t)
    return {"markdown": _build_threads_markdown(threads_out), "threads": threads_out}


@app.patch("/threads/status")
async def patch_thread_status(req: ThreadStatusRequest):
    """Update a single thread's status. Returns updated markdown for frontend to write."""
    from fastapi import HTTPException
    valid_statuses = {"active", "dormant", "resolved"}
    if req.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status: {req.status}")
    from config import OBSIDIAN_VAULT
    threads_path = Path(OBSIDIAN_VAULT) / "03 Story" / "Plot Threads.md"
    threads: list = []
    if threads_path.exists():
        threads = _parse_threads_file(threads_path.read_text(encoding="utf-8"))
    updated = False
    for t in threads:
        if t.get("id") == req.id:
            t["status"] = req.status
            updated = True
            break
    if not updated:
        raise HTTPException(status_code=404, detail=f"Thread not found: {req.id}")
    markdown = _build_threads_markdown(threads)
    return {"markdown": markdown}


@app.post("/threads/extract")
async def extract_threads(req: ThreadsExtractRequest):
    """Extract proposed plot threads from session recaps using LLM."""
    from fastapi import HTTPException
    if not _state["loaded"]:
        raise HTTPException(status_code=503, detail="LLM not loaded yet.")
    from llama_index.core import Settings
    context = f"Player recap:\n{req.player_recap.strip()}"
    if req.dm_recap.strip():
        context += f"\n\nDM notes:\n{req.dm_recap.strip()}"
    prompt = (
        "You are a D&D campaign assistant. Extract active plot threads from the session recap below.\n"
        "Rules:\n"
        "- Only extract plot threads EXPLICITLY mentioned in the text. Do not invent details.\n"
        "- A plot thread is an ongoing story arc, quest, conflict, or mystery.\n"
        "- For each thread, identify which PC names are mentioned in relation to it.\n"
        "- role = 'involved' if the PC actively engaged with this thread this session.\n"
        "- role = 'stake' if the PC has a personal interest or connection to this thread.\n"
        "- Respond ONLY with valid JSON: {\"proposed\": [{\"title\": ..., \"description\": ..., \"pcs\": [{\"name\": ..., \"role\": ...}]}]}.\n"
        "- If no clear threads can be extracted, return {\"proposed\": []}.\n\n"
        f"{context}\n\n"
        "JSON:"
    )
    loop = asyncio.get_running_loop()
    try:
        _reset_token_counter()
        response = await loop.run_in_executor(None, lambda: Settings.llm.complete(prompt))
        text = response.text.strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(text[start:end])
            proposed = data.get("proposed", [])
            if isinstance(proposed, list):
                loop.run_in_executor(None, _report_tokens, _read_token_count())
                return {"proposed": proposed}
    except Exception as exc:
        print(f"[server] /threads/extract failed: {exc}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=str(exc))
    return {"proposed": []}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="info")
