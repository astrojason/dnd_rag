# D&D RAG

A retrieval-augmented generation (RAG) tool for querying an Obsidian D&D campaign vault using natural language. Indexes your campaign notes and lets you ask questions answered by your own lore.

## How it works

1. **Ingest** — reads all `.md` files from your Obsidian vault, cleans Obsidian-specific syntax (wikilinks, callouts, embeds, tables), chunks the text, embeds it with OpenAI, and stores it in a local ChromaDB vector database. BM25 nodes are also saved to disk for hybrid search.
2. **Query** — loads the ChromaDB index and BM25 nodes, runs a hybrid retrieval (vector + BM25 with reciprocal rerank), then passes the top results to `gpt-4o-mini` to generate a grounded answer.

## Setup

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Set your API keys in the environment (or a `.env` file):

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...  # optional, not currently used in query
```

Update `config.py` to point `OBSIDIAN_VAULT` at your campaign vault directory.

## Usage

**Index your vault** (run once, or after major updates):

```bash
python ingest.py
```

**Ask a question:**

```bash
python query.py "Who is the captain of the ship?"
python query.py "What happened in the last session?"
python query.py "What do we know about the merchant guild?"
```

## Configuration

All settings are in [config.py](config.py):

| Setting | Default | Description |
|---|---|---|
| `OBSIDIAN_VAULT` | `~/Documents/Obsidian/Azorian's Bounty` | Path to your Obsidian vault |
| `CHROMA_DB_PATH` | `data/chroma_db` | Where the vector DB is stored |
| `USE_OPENAI_EMBEDDINGS` | `True` | Use OpenAI embeddings (vs local Ollama) |
| `EMBED_MODEL` | `nomic-embed-text` | Ollama model for embeddings (if not using OpenAI) |
| `CHUNK_SIZE` | `512` | Token chunk size for indexing |
| `CHUNK_OVERLAP` | `50` | Token overlap between chunks |

## Vault structure

Ingestion is recursive — all `.md` files in any subfolder are indexed automatically. The following folders are excluded (scratch/workbench content):

- `ZZ_Workbench/` — templates, prompts, assets, in-progress notes
- `00 To Process/LLM Chats/` — raw LLM chat logs

Each document is tagged with a `category` derived from its folder path (e.g. `World / Locations / Tyr'amryn / Stormharbor`) and that breadcrumb is prepended to the document text so the LLM has structural context during retrieval.

## Data

The `data/chroma_db/` directory is gitignored. Run `ingest.py` to rebuild it locally.
