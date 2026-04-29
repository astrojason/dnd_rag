#!/bin/bash
set -e
cd /Users/jasonsylvester/Projects/tools/dnd_rag
docker build --platform linux/amd64 -t dnd-rag:latest .
docker save -o dnd-rag.tar dnd-rag:latest
scp dnd-rag.tar astrojason@astroserver:/tmp/
scp .env astrojason@astroserver:/home/astrojason/dnd-rag.env
ssh astrojason@astroserver 'docker stop dnd-rag 2>/dev/null; docker rm -f dnd-rag 2>/dev/null; docker load -i /tmp/dnd-rag.tar && docker run -d --name dnd-rag --restart unless-stopped --user 1000:1000 -p 8765:8765 -v /home/astrojason/dnd-rag-data:/app/data --env-file /home/astrojason/dnd-rag.env dnd-rag:latest && rm /tmp/dnd-rag.tar'
rm dnd-rag.tar
