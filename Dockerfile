FROM python:3.14-slim

WORKDIR /app

# System deps for onnxruntime, grpcio, chromadb
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY config.py ingest.py normalize.py query.py server.py ./

EXPOSE 8765

CMD ["python", "server.py"]
