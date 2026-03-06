"""
TopCPToolkit GUI – Flask backend.

Endpoints
---------
GET  /api/schema           Full block tree with introspected options
GET  /api/health           Liveness check; reports Athena + version info
POST /api/export-yaml      Returns YAML content as a downloadable response
"""

import copy
import glob
import logging
import os

import yaml
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS

from block_schema import BLOCK_TREE
from introspect import get_options

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")

_version_file = os.path.join(os.path.dirname(__file__), "..", "VERSION")
APP_VERSION = open(_version_file).read().strip()

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


def _get_ab_version():
    """Try to determine the AnalysisBase release version."""
    for var in ("AnalysisBase_VERSION", "ANALYSISBASE_VERSION", "AtlasVersion"):
        v = os.environ.get(var)
        if v:
            return v
    paths = glob.glob("/usr/AnalysisBase/*/InstallArea")
    if paths:
        return paths[0].split("/")[3]
    return None


def _get_tct_version():
    """Read the TopCPToolkit version written by the Dockerfile build step."""
    marker = "/opt/tct_version.txt"
    try:
        version = open(marker).read().strip()
        return None if version == "none" else version
    except FileNotFoundError:
        return None


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
    return jsonify({
        "status": "ok",
        "athena": athena_ok,
        "app_version": APP_VERSION,
        "ab_version": _get_ab_version(),
        "tct_version": _get_tct_version(),
    })


@app.route("/api/schema")
def schema():
    return jsonify(_schema_cache)


@app.route("/api/export-yaml", methods=["POST"])
def export_yaml():
    """Return the YAML as a file download — no server-side writing needed."""
    payload = request.get_json(force=True)
    config = payload.get("config", {})
    filename = payload.get("filename", "analysis_config.yaml")

    content = yaml.dump(config, default_flow_style=False, sort_keys=False,
                        allow_unicode=True)

    return Response(
        content,
        mimetype="application/x-yaml",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Content-Type": "application/x-yaml",
        },
    )


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
