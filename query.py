from llama_index.core import VectorStoreIndex, QueryBundle
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.llms.openai import OpenAI
from llama_index.core import Settings
from llama_index.retrievers.bm25 import BM25Retriever
from llama_index.core.retrievers import QueryFusionRetriever
from llama_index.core.prompts import PromptTemplate
from llama_index.core.query_engine import RetrieverQueryEngine
import chromadb
import sys
from config import *

# Configure LLM
print("Configuring OpenAI...")
Settings.llm = OpenAI(
    model="gpt-4o-mini",
    api_key=OPENAI_API_KEY
)

# Configure embeddings
if USE_OPENAI_EMBEDDINGS:
    from llama_index.embeddings.openai import OpenAIEmbedding
    Settings.embed_model = OpenAIEmbedding(
        model="text-embedding-3-small",
        api_key=OPENAI_API_KEY
    )

# Load index from ChromaDB
print("Loading index from ChromaDB...")
chroma_client = chromadb.PersistentClient(path=str(CHROMA_DB_PATH))
chroma_collection = chroma_client.get_collection("dnd_campaign")

# Get all documents from ChromaDB to build BM25 index
print("Loading BM25 nodes from cache...")
import pickle
from llama_index.core.schema import TextNode

nodes_path = CHROMA_DB_PATH / "bm25_nodes.pkl"

if nodes_path.exists():
    with open(nodes_path, 'rb') as f:
        nodes = pickle.load(f)
    print(f"Loaded {len(nodes)} cached nodes")
else:
    print("No cached nodes found - run ingest.py first")
    sys.exit(1)

# Create vector store index
vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
index = VectorStoreIndex.from_vector_store(vector_store)

# Create retrievers
vector_retriever = index.as_retriever(similarity_top_k=10)
bm25_retriever = BM25Retriever.from_defaults(
    nodes=nodes,
    similarity_top_k=10
)

# Hybrid retriever
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
    "\"I don't have that information in my campaign notes.\"\n"
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
)

# Get query
if len(sys.argv) < 2:
    print("Usage: python query.py \"your question here\"")
    sys.exit(1)

query = " ".join(sys.argv[1:])
print(f"\nQuery: {query}\n")

response = query_engine.query(query)
print(f"Response: {response}\n")