from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, StorageContext
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.llms.ollama import Ollama
from llama_index.core import Settings
import chromadb
import re
import sys
from config import *
import pickle
import httpx

_TRACKER_URL = "https://token-tracker-roan.vercel.app/api/tokens"


def _report_tokens(count: int) -> None:
    try:
        httpx.post(_TRACKER_URL, json={"tokens": count}, timeout=5.0)
    except Exception:
        pass

def clean_obsidian_syntax(text):
    """Clean Obsidian-specific syntax for better RAG"""
    
    # Convert wikilinks: [[Page Name|Display]] -> Display, [[Page Name]] -> Page Name
    text = re.sub(r'\[\[([^\]|]+)\|([^\]]+)\]\]', r'\2', text)  # [[link|display]] -> display
    text = re.sub(r'\[\[([^\]]+)\]\]', r'\1', text)  # [[link]] -> link
    
    # Remove tags but keep them as metadata hint
    # Instead of removing, convert: #tag -> (tag: tag)
    # Or just remove: text = re.sub(r'#\w+', '', text)
    
    # Remove embed syntax: ![[file]] -> (embedded: file)
    text = re.sub(r'!\[\[([^\]]+)\]\]', r'(embedded file: \1)', text)
    
    # Convert checkboxes to plain text
    text = re.sub(r'- \[ \]', '-', text)
    text = re.sub(r'- \[x\]', '- (completed)', text)
    
    # Clean callouts: > [!note] -> Note:
    text = re.sub(r'> \[!(\w+)\]', r'\1:', text)
    
    return text

def table_to_prose(text):
    """Convert markdown tables to prose format - improved version"""
    lines = text.split('\n')
    result = []
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Check if this is a table row
        if '|' in line and line.strip():
            # Look ahead to find the full table
            table_lines = [line]
            j = i + 1
            
            # Collect all consecutive table lines
            while j < len(lines) and '|' in lines[j]:
                table_lines.append(lines[j])
                j += 1
            
            # Parse the table
            rows = []
            for tline in table_lines:
                # Skip separator lines (|---|---|)
                if not tline.strip().replace('|', '').replace('-', '').replace(' ', ''):
                    continue
                cells = [cell.strip() for cell in tline.split('|') if cell.strip()]
                if cells:
                    rows.append(cells)
            
            # Convert to prose
            if len(rows) > 1:
                headers = rows[0]
                for row in rows[1:]:
                    parts = []
                    for idx, cell in enumerate(row):
                        if idx < len(headers):
                            parts.append(f"{headers[idx]}: {cell}")
                    if parts:
                        result.append(" | ".join(parts))
            
            i = j
        else:
            result.append(line)
            i += 1
    
    return '\n'.join(result)

print("Configuring LLM...")
Settings.llm = Ollama(model=QUALITY_MODEL, request_timeout=300.0)
print("LLM configured")

print("Configuring embeddings...")
if USE_OPENAI_EMBEDDINGS:
    from llama_index.embeddings.openai import OpenAIEmbedding

    class TrackingOpenAIEmbedding(OpenAIEmbedding):
        actual_token_count: int = 0

        def _get_text_embeddings(self, texts):
            response = self._get_client().embeddings.create(
                model=self.model, input=texts
            )
            self.actual_token_count += response.usage.total_tokens
            return [item.embedding for item in response.data]

        def _get_query_embedding(self, query):
            response = self._get_client().embeddings.create(
                model=self.model, input=[query]
            )
            self.actual_token_count += response.usage.total_tokens
            return response.data[0].embedding

    Settings.embed_model = TrackingOpenAIEmbedding(
        model="text-embedding-3-small",
        api_key=OPENAI_API_KEY
    )
    print("Using OpenAI embeddings")
else:
    from llama_index.embeddings.ollama import OllamaEmbedding
    Settings.embed_model = OllamaEmbedding(model_name=EMBED_MODEL)
    print("Using local embeddings")

print("Loading documents...")

# Folders that contain scratch work, templates, or raw LLM logs — not campaign lore
EXCLUDE_DIRS = [
    "ZZ_Workbench",
    "00 To Process/LLM Chats",
    "03 Story/Sessions/DM Reviews",
]
exclude_patterns = [str(OBSIDIAN_VAULT / d) + "/*" for d in EXCLUDE_DIRS]

documents = SimpleDirectoryReader(
    input_dir=OBSIDIAN_VAULT,
    recursive=True,
    required_exts=[".md"],
    exclude=exclude_patterns,
    exclude_hidden=True,
).load_data()
print(f"Loaded {len(documents)} documents")

def get_category(file_path: str) -> str:
    """Derive a human-readable category from the file's folder path within the vault."""
    try:
        rel = Path(file_path).relative_to(OBSIDIAN_VAULT)
        parts = list(rel.parts[:-1])  # drop the filename
        if not parts:
            return "General"
        # Strip leading number prefix from top-level folder (e.g. "01 World" -> "World")
        parts[0] = re.sub(r'^\d+\s+', '', parts[0])
        return " / ".join(parts)
    except ValueError:
        return "General"

print("Preprocessing documents...")
for doc in documents:
    filename = doc.metadata.get('file_name', '')
    file_path = doc.metadata.get('file_path', '')

    # Derive category from folder structure and store as metadata
    category = get_category(file_path)
    doc.metadata['category'] = category

    # Add filename as heading for all files (it's the entity name in Obsidian)
    entity_name = filename.replace('.md', '').split(',')[0]  # Handle "Name, Title.md"
    original_text = doc.get_content()

    # Build header: category breadcrumb + entity name
    header_lines = []
    if not original_text.strip().startswith(f"# {entity_name}"):
        header_lines.append(f"# {entity_name}")
    if category and category != "General":
        header_lines.append(f"Category: {category}")

    if header_lines:
        doc.set_content("\n".join(header_lines) + "\n\n" + original_text)

    # Clean Obsidian syntax
    original_text = doc.get_content()
    cleaned = clean_obsidian_syntax(original_text)

    # Convert tables to prose
    prose = table_to_prose(cleaned)

    doc.set_content(prose)

print("Setting up ChromaDB...")
chroma_client = chromadb.PersistentClient(path=str(CHROMA_DB_PATH))
rebuild = "--rebuild" in sys.argv
if rebuild:
    if "dnd_campaign" in [c.name for c in chroma_client.list_collections()]:
        chroma_client.delete_collection("dnd_campaign")
        print("Existing index cleared (full rebuild)")
    chroma_collection = chroma_client.create_collection("dnd_campaign")
else:
    chroma_collection = chroma_client.get_or_create_collection("dnd_campaign")
vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

print("Creating index and persisting to ChromaDB...")
index = VectorStoreIndex.from_documents(
    documents,
    storage_context=storage_context
)
print("Index created and saved")

print("Saving nodes for BM25...")
# Get all nodes from the index
from llama_index.core.schema import TextNode

results = chroma_collection.get(include=['documents', 'metadatas'])
nodes = []
for doc_id, text, metadata in zip(results['ids'], results['documents'], results['metadatas']):
    node = TextNode(
        text=text,
        id_=doc_id,
        metadata=metadata
    )
    nodes.append(node)

# Save to disk
nodes_path = CHROMA_DB_PATH / "bm25_nodes.pkl"
with open(nodes_path, 'wb') as f:
    pickle.dump(nodes, f)

print(f"Saved {len(nodes)} nodes for BM25")

# Report actual embedding tokens from OpenAI API responses
if USE_OPENAI_EMBEDDINGS and isinstance(Settings.embed_model, TrackingOpenAIEmbedding):
    total_tokens = Settings.embed_model.actual_token_count
else:
    total_tokens = 0
print(f"Reporting {total_tokens:,} embedding tokens to tracker...")
_report_tokens(total_tokens)