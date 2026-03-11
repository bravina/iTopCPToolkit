import json
import logging
import os
import re
import math
from typing import List, Dict, Any

logger = logging.getLogger("rag")

_INDEX: List[Dict[str, Any]] = []
_IDF: Dict[str, float] = {}
_LOADED = False

def _load_index():
    global _INDEX, _IDF, _LOADED
    if _LOADED: return
    index_path = os.path.join(os.path.dirname(__file__), "docs_index.json")
    if os.path.exists(index_path):
        with open(index_path, "r") as f:
            _INDEX = json.load(f)
        
        # Calculate IDF weights
        total_docs = len(_INDEX)
        doc_counts = {}
        for chunk in _INDEX:
            for kw in set(chunk.get('keywords', [])):
                doc_counts[kw] = doc_counts.get(kw, 0) + 1
        
        for kw, count in doc_counts.items():
            _IDF[kw] = math.log(total_docs / (1 + count))
        
        logger.info(f"RAG: Indexed {total_docs} chunks with {len(_IDF)} terms.")
    _LOADED = True

def search(query: str, max_results: int = 5, max_chars: int = 5000) -> List[Dict[str, Any]]:
    _load_index()
    if not _INDEX: return []

    query_terms = re.findall(r'[a-zA-Z_][a-zA-Z0-9_]*', query.lower())
    if not query_terms: return []

    scored = []
    for chunk in _INDEX:
        chunk_kw = chunk.get('keywords', [])
        score = 0
        for term in set(query_terms):
            if term in chunk_kw:
                # TF (count in doc) * IDF (rarity in entire library)
                score += chunk_kw.count(term) * _IDF.get(term, 1.0)
        
        # Huge bonus for matches in titles/headings
        header_context = (chunk.get('title', '') + ' ' + chunk.get('section', '')).lower()
        for term in query_terms:
            if term in header_context:
                score += 10.0 

        if score > 0:
            scored.append((score, chunk))

    scored.sort(key=lambda x: -x[0])

    results = []
    current_chars = 0
    for score, chunk in scored[:max_results]:
        if current_chars + len(chunk['text']) > max_chars: break
        results.append({
            'title': chunk['title'],
            'section': chunk['section'],
            'url_path': chunk['url_path'],
            'text': chunk['text'],
            'score': round(score, 2)
        })
        current_chars += len(chunk['text'])
    return results

def get_context_text(query: str, max_results: int = 5, max_chars: int = 5000) -> str:
    results = search(query, max_results, max_chars)
    if not results: return ""

    parts = ["### TopCPToolkit Documentation Reference\n"]
    for i, r in enumerate(results, 1):
        parts.append(f"--- DOCUMENT {i}: {r['title']} > {r['section']} ---")
        # Wrap in a generic block to help the AI isolate content
        parts.append(f"CONTENT:\n{r['text']}\n")
    return "\n".join(parts)

def get_stats():
    _load_index()
    return {"total_chunks": len(_INDEX), "loaded": _LOADED}
