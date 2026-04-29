#!/bin/bash
set -e
cd /Users/jasonsylvester/Projects/tools/dnd_rag
set -a && source .env && set +a
/Users/jasonsylvester/Projects/tools/dnd_rag/venv/bin/python ingest.py
rsync -az --delete data/chroma_db/ astrojason@astroserver:~/dnd-rag-data/
curl -s -X POST http://astroserver:8765/reload
