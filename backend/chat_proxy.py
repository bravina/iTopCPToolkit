"""
Chat proxy endpoint for the AI assistant.

Why a backend proxy?
  - OpenAI & Anthropic block browser-origin (CORS) requests
  - We inject RAG context server-side so the docs index stays internal
  - The user's API key is sent per-request and never stored

POST /api/chat
Body: {
    "provider": "openai" | "anthropic" | "google" | "xai",
    "model": "gpt-4o" | "claude-sonnet-4-20250514" | ...,
    "api_key": "sk-...",
    "messages": [ { "role": "user"|"assistant", "content": "..." } ],
    "schema_context": "..." (optional: current YAML or block info)
}

Returns: { "reply": "...", "rag_sources": [...] }
"""

import json
import logging
import urllib.request
import urllib.error
from flask import Blueprint, request, jsonify

from rag import get_context_text, search

logger = logging.getLogger("chat")

chat_bp = Blueprint("chat", __name__)

SYSTEM_PROMPT_BASE = SYSTEM_PROMPT_BASE = """ROLE: You are a strict technical validator for the TopCPToolkit framework.

CONSTRAINTS (MANDATORY):
1. ONLY use information provided in the "### TopCPToolkit Documentation Reference" section below.
2. If the answer is not contained within the provided documentation, you MUST say: "I'm sorry, but the current documentation index does not contain information on that specific topic."
3. DO NOT use your general training data to guess YAML keys or C++ method names.
4. If a user asks for a feature not in the docs, do not assume it exists.
5. Every YAML example you provide must be strictly based on the syntax shown in the retrieved sources.

OUTPUT STYLE:
- Be clinical, technical, and concise.
- If you cite a source, mention the source title.
"""


def _build_system_prompt(user_message, schema_context=None):
    parts = [SYSTEM_PROMPT_BASE]
    
    rag_context = get_context_text(user_message, max_results=5)
    if not rag_context:
        parts.append("\nCRITICAL: No documentation was found for this query. Inform the user you cannot answer.")
    else:
        parts.append("\n" + rag_context)
        parts.append("\nVERIFICATION: You must cite the DOCUMENT number for every claim you make.")

    return "\n".join(parts)


def _call_openai(api_key, model, system_prompt, messages):
    """Call OpenAI-compatible API (works for OpenAI and xAI/Grok)."""
    # Determine base URL
    if "grok" in model.lower() or model.startswith("grok"):
        url = "https://api.x.ai/v1/chat/completions"
    else:
        url = "https://api.openai.com/v1/chat/completions"

    api_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        api_messages.append({"role": msg["role"], "content": msg["content"]})

    payload = json.dumps({
        "model": model,
        "messages": api_messages,
        "max_tokens": 2000,
        "temperature": 0.3,
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )

    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    return data["choices"][0]["message"]["content"]


def _call_anthropic(api_key, model, system_prompt, messages):
    """Call Anthropic Claude API."""
    url = "https://api.anthropic.com/v1/messages"

    api_messages = []
    for msg in messages:
        api_messages.append({"role": msg["role"], "content": msg["content"]})

    payload = json.dumps({
        "model": model,
        "system": system_prompt,
        "messages": api_messages,
        "max_tokens": 2000,
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )

    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    # Anthropic returns content as a list of blocks
    text_parts = [b["text"] for b in data["content"] if b["type"] == "text"]
    return "\n".join(text_parts)


def _call_google(api_key, model, system_prompt, messages):
    """Call Google Gemini API."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

    # Build contents array
    contents = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": msg["content"]}]})

    payload = json.dumps({
        "contents": contents,
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "generationConfig": {
            "maxOutputTokens": 2000,
            "temperature": 0.3,
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    candidates = data.get("candidates", [])
    if candidates:
        parts = candidates[0].get("content", {}).get("parts", [])
        return "\n".join(p.get("text", "") for p in parts)
    return "No response from Gemini."


def _call_ollama(model, system_prompt, messages):
    """Call local Ollama API via host.docker.internal."""
    # This URL allows Docker containers to talk to the host machine
    url = "http://host.docker.internal:11434/api/chat"

    api_messages = [{"role": "system", "content": system_prompt}]
    for msg in messages:
        api_messages.append({"role": msg["role"], "content": msg["content"]})

    payload = json.dumps({
        "model": model,
        "messages": api_messages,
        "stream": False,
        "options": {
            "temperature": 0,    # Forces the model to be literal
            "num_predict": 1000, # Limit response length
            "top_p": 0.1
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    # Note: Ollama can be slow on CPU, so we use a longer timeout
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    return data["message"]["content"]


@chat_bp.route("/api/chat", methods=["POST"])
def chat():
    """Proxy chat request to the selected AI provider."""
    body = request.get_json(force=True)
    provider = body.get("provider", "openai")
    model = body.get("model", "")
    api_key = body.get("api_key", "")
    messages = body.get("messages", [])
    schema_context = body.get("schema_context", "")

    if provider != "ollama" and not api_key:
        return jsonify({"error": "API key is required"}), 400
    if not messages:
        return jsonify({"error": "No messages provided"}), 400

    # Get the latest user message for RAG search
    last_user_msg = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            last_user_msg = msg["content"]
            break

    system_prompt = _build_system_prompt(last_user_msg, schema_context)

    # Get RAG sources for the frontend to display
    rag_results = search(last_user_msg, max_results=4, max_chars=2000)
    rag_sources = [
        {"title": r["title"], "section": r["section"], "url_path": r["url_path"]}
        for r in rag_results
    ]

    try:
        if provider == "openai" or provider == "xai":
            reply = _call_openai(api_key, model, system_prompt, messages)
        elif provider == "anthropic":
            reply = _call_anthropic(api_key, model, system_prompt, messages)
        elif provider == "google":
            reply = _call_google(api_key, model, system_prompt, messages)
        elif provider == "ollama":
            reply = _call_ollama(model, system_prompt, messages)
        else:
            return jsonify({"error": f"Unknown provider: {provider}"}), 400

        return jsonify({"reply": reply, "rag_sources": rag_sources})

    except urllib.error.HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8", errors="replace")[:500]
        except Exception:
            pass
        logger.error("AI API error %s: %s", e.code, error_body)
        return jsonify({
            "error": f"AI API returned {e.code}",
            "detail": error_body,
        }), 502

    except urllib.error.URLError as e:
        logger.error("AI API connection error: %s", e.reason)
        return jsonify({"error": f"Connection error: {e.reason}"}), 502

    except Exception as e:
        logger.exception("Unexpected chat error")
        return jsonify({"error": str(e)}), 500


@chat_bp.route("/api/rag-stats")
def rag_stats():
    """Return RAG index statistics."""
    from rag import get_stats
    return jsonify(get_stats())
