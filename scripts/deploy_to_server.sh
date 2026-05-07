#!/bin/bash
set -e
cd /Users/jasonsylvester/Projects/tools/dnd_rag

cleanup() {
    rm -f dnd-rag.tar
    ssh astrojason@astroserver 'rm -f /tmp/dnd-rag.tar' 2>/dev/null || true
}
trap cleanup EXIT

docker build --platform linux/amd64 -t dnd-rag:latest .
docker save -o dnd-rag.tar dnd-rag:latest
scp dnd-rag.tar astrojason@astroserver:/tmp/
scp .env astrojason@astroserver:/home/astrojason/dnd-rag.env
ssh astrojason@astroserver 'docker stop dnd-rag 2>/dev/null; docker rm -f dnd-rag 2>/dev/null; docker load -i /tmp/dnd-rag.tar && docker run -d --name dnd-rag --restart unless-stopped --user 1000:1000 -p 8765:8765 -v /home/astrojason/dnd-rag-data:/app/data --env-file /home/astrojason/dnd-rag.env dnd-rag:latest'
