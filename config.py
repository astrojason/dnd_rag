from pathlib import Path
import os
from dotenv import load_dotenv

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")  # set in your environment
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
USE_OPENAI_EMBEDDINGS = True

# Paths
OBSIDIAN_VAULT = Path(os.getenv("OBSIDIAN_VAULT", "/Users/jasonsylvester/Documents/Obsidian/Azorian's Bounty"))
PROJECT_ROOT = Path(__file__).parent
CHROMA_DB_PATH = PROJECT_ROOT / "data" / "chroma_db"

# Models
EMBED_MODEL = "nomic-embed-text"  # you'll need: ollama pull nomic-embed-text
FAST_MODEL = "llama3.2:3b"
QUALITY_MODEL = "llama3.1:8b"

# Index settings
CHUNK_SIZE = 512
CHUNK_OVERLAP = 50
