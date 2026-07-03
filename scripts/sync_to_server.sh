#!/bin/bash
set -e
cd /Users/jasonsylvester/Projects/tools/dnd_rag
set -a && source .env && set +a

notify() {
    osascript -e "display notification \"$1\" with title \"DnD Oracle\" subtitle \"Nightly Ingest\""
}
trap 'notify "Ingest failed — check /tmp/com.dnd.ingest.err"' ERR

/Users/jasonsylvester/Projects/tools/dnd_rag/venv/bin/python ingest.py
rsync -az --delete data/chroma_db/ astrojason@astroserver.lan:~/dnd-rag-data/chroma_db/
curl -s -X POST http://astroserver.lan:8765/reload

notify "Ingest and sync complete"
