"""
TopCPToolkit GUI – Flask backend.

Endpoints
---------
GET  /api/schema           Full block tree with introspected options
POST /api/export-yaml      Write YAML config to a file path on disk
GET  /api/health           Liveness check; reports whether Athena is available
"""

import copy
import logging
import os

import yaml
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

from block_schema import BLOCK_TREE
from introspect import get_options

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")

STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
app = Flask(__name__, static_folder=STATIC_DIR if os.path.isdir(STATIC_DIR) else None)
CORS(app)

_schema_cache = None


def _build_schema():
    def enrich(block):
        b = copy.deepcopy(block)
        b["options"] = get_options(b["class_path"], b["is_function"])
        b["sub_blocks"] = [enrich(sb) for sb in b["sub_blocks"]]
        return b
    return [enrich(b) for b in BLOCK_TREE]


@app.before_request
def _warm_schema():
    global _schema_cache
    if _schema_cache is None:
        logger.info("Building schema (first request)…")
        _schema_cache = _build_schema()
        logger.info("Schema ready – %d top-level blocks", len(_schema_cache))


@app.route("/api/health")
def health():
    try:
        import AthenaCommon  # noqa: F401
        athena_ok = True
    except ImportError:
        athena_ok = False
    return jsonify({"status": "ok", "athena": athena_ok})


@app.route("/api/schema")
def schema():
    return jsonify(_schema_cache)


@app.route("/api/export-yaml", methods=["POST"])
def export_yaml():
    payload = request.get_json(force=True)
    config = payload.get("config", {})
    filepath = payload.get("filepath", "/tmp/analysis_config.yaml")
    os.makedirs(os.path.dirname(os.path.abspath(filepath)), exist_ok=True)
    with open(filepath, "w") as fh:
        yaml.dump(config, fh, default_flow_style=False, sort_keys=False, allow_unicode=True)
    logger.info("Exported YAML → %s", filepath)
    return jsonify({"success": True, "filepath": filepath})


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_frontend(path):
    if app.static_folder is None:
        return "Frontend not built – run `npm run build` inside frontend/", 404
    full = os.path.join(app.static_folder, path)
    if path and os.path.exists(full):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
