"""
TopCPToolkit GUI – Flask backend.

Endpoints
---------
GET  /api/schema              Introspected block tree (+ TCT catalogue, examples)
GET  /api/health              Liveness check; reports Athena + version info
POST /api/introspect          Introspect one hand-entered AddConfigBlocks entry
GET  /api/examples            List the TopCPToolkit reference configs
GET  /api/examples/<path>     Content of one reference config
POST /api/generate-intnote    Runs generateConfigInformation.py on a JSON file,
                              compiles the resulting .tex to PDF, returns both

The schema is built once at startup by walking the live ConfigFactory
(see introspect.py).  Athena is required: the app only runs inside the
AnalysisBase image.
"""

import base64
import glob
import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile

from flask import Flask, Response, jsonify, request, send_from_directory
from flask_cors import CORS

import catalogue
import introspect

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app")

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APP_VERSION = open(os.path.join(REPO_ROOT, "VERSION")).read().strip()

STATIC_DIR = os.path.join(REPO_ROOT, "frontend", "dist")

# Path to the ConfigDocumentation script kept from the TCT source tree
_INTNOTE_SCRIPT = "/opt/TopCPToolkit/ConfigDocumentation/generateConfigInformation.py"

app = Flask(__name__, static_folder=STATIC_DIR if os.path.isdir(STATIC_DIR) else None)
CORS(app)


# ─────────────────────────────────────────────────────────────────────────────
# Version / environment probes
# ─────────────────────────────────────────────────────────────────────────────

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
    try:
        version = open("/opt/tct_version.txt").read().strip()
        return None if version == "none" else version
    except FileNotFoundError:
        return None


def _pdflatex_available():
    return shutil.which("pdflatex") is not None


def _versions():
    return {
        "app": APP_VERSION,
        "ab": _get_ab_version(),
        "tct": _get_tct_version(),
        "athena": introspect.athena_available(),
        "pdflatex": _pdflatex_available(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Schema construction + cache
# ─────────────────────────────────────────────────────────────────────────────

NO_ATHENA_MESSAGE = ("Athena (AnalysisAlgorithmsConfig) is not importable — "
                     "iTopCPToolkit must run inside the AnalysisBase image")


def build_full_schema():
    """
    Assemble everything the frontend needs in one document.

    Requires a live Athena environment; raises RuntimeError otherwise.
    """
    if not introspect.athena_available():
        raise RuntimeError(NO_ATHENA_MESSAGE)
    schema = introspect.build_schema()
    data_dir = catalogue.find_tct_data_dir()
    schema["catalogue"] = catalogue.build_catalogue(data_dir)
    schema["examples"] = catalogue.list_examples(data_dir)
    schema["tctDataDir"] = data_dir
    if data_dir:
        logger.info("TopCPToolkit data dir %s: %d reference configs, %d AddConfigBlocks entries",
                    data_dir, len(schema["examples"]), len(schema["catalogue"]))
    # Filled in once EventSelectionConfig exposes its keyword spec upstream
    schema["keywords"] = None
    schema["versions"] = _versions()
    return schema


_schema_cache = None
_schema_json = None
_schema_etag = None


def reset_schema_cache():
    global _schema_cache, _schema_json, _schema_etag
    _schema_cache = _schema_json = _schema_etag = None


def get_schema():
    """Return the cached schema, building it on first use.  Failures are not cached."""
    global _schema_cache, _schema_json, _schema_etag
    if _schema_cache is None:
        logger.info("Building schema…")
        schema = build_full_schema()          # raises RuntimeError without Athena
        schema_json = json.dumps(schema, ensure_ascii=False)
        _schema_cache = schema
        _schema_json = schema_json
        _schema_etag = '"' + hashlib.sha1(schema_json.encode("utf-8")).hexdigest() + '"'
        n_err = sum(1 for b in schema["blocks"] if b.get("error"))
        n_err += sum(1 for e in schema["catalogue"] if e.get("block", {}).get("error"))
        logger.info("Schema ready – %d blocks, %d catalogue entries, %d with errors",
                    len(schema["blocks"]), len(schema["catalogue"]), n_err)
    return _schema_cache


# ─────────────────────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    v = _versions()
    try:
        sch = get_schema()
    except Exception as exc:  # noqa: BLE001 — health must never fail
        logger.warning("Health: schema unavailable: %s", exc)
        sch = {}
    return jsonify({
        "status": "ok",
        "athena": v["athena"],
        "app_version": v["app"],
        "ab_version": v["ab"],
        "tct_version": v["tct"],
        "pdflatex": v["pdflatex"],
        "tct_data_dir": sch.get("tctDataDir"),
        "catalogue_size": len(sch.get("catalogue", [])),
    })


@app.route("/api/schema")
def schema():
    try:
        get_schema()
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 503
    if request.headers.get("If-None-Match") == _schema_etag:
        return Response(status=304, headers={"ETag": _schema_etag})
    return Response(_schema_json, mimetype="application/json",
                    headers={"ETag": _schema_etag, "Cache-Control": "no-cache"})


@app.route("/api/introspect", methods=["POST"])
def introspect_entry():
    """
    Introspect a user-supplied AddConfigBlocks entry
    ``{modulePath, functionName, algName, pos?, superBlocks?}`` and return its
    schema block.  Only modules already installed in the image can be imported —
    the same trust level as running the YAML itself.
    """
    if not introspect.athena_available():
        return jsonify({"error": "Athena not available — cannot introspect custom blocks"}), 503
    payload = request.get_json(force=True, silent=True) or {}
    missing = [k for k in catalogue.ENTRY_KEYS if not isinstance(payload.get(k), str) or not payload[k]]
    if missing:
        return jsonify({"error": f"Missing or invalid fields: {', '.join(missing)}"}), 400
    entry = {k: payload[k] for k in catalogue.ENTRY_KEYS}
    entry["pos"] = payload.get("pos")
    entry["superBlocks"] = payload.get("superBlocks")
    block = catalogue.introspect_entry(entry)
    if block.get("error"):
        return jsonify({"error": block["error"], "block": block}), 400
    return jsonify({"entry": entry, "block": block})


@app.route("/api/examples")
def examples():
    return jsonify([{"path": e["path"], "name": e["name"]} for e in get_schema()["examples"]])


@app.route("/api/examples/<path:rel_path>")
def example_content(rel_path):
    content = catalogue.read_example(catalogue.find_tct_data_dir(), rel_path)
    if content is None:
        return jsonify({"error": f"Unknown example '{rel_path}'"}), 404
    return Response(content, mimetype="application/x-yaml")


@app.route("/api/generate-intnote", methods=["POST"])
def generate_intnote():
    """
    Accept a TopCPToolkit JSON configuration file, run
    generateConfigInformation.py on it, compile the resulting .tex with
    pdflatex, and return the PDF (base64) + .tex source.

    Form fields:
        json      – the JSON file (required)
        sections  – comma-separated list of sections, e.g. "muon,jet,met"
                    (optional; omit to generate all sections)
    """
    if not os.path.isfile(_INTNOTE_SCRIPT):
        return jsonify({
            "error": "TopCPToolkit not available — generateConfigInformation.py not found. "
                     "Rebuild the image with TCT_VERSION set.",
        }), 400

    if not _pdflatex_available():
        return jsonify({"error": "pdflatex not found. Rebuild the image with texlive installed."}), 400

    json_file = request.files.get("json")
    if not json_file:
        return jsonify({"error": "No JSON file provided"}), 400

    sections = request.form.get("sections", "").strip()

    with tempfile.TemporaryDirectory() as tmpdir:
        json_path = os.path.join(tmpdir, "config.json")
        tex_path = os.path.join(tmpdir, "output.tex")
        json_file.save(json_path)

        cmd = ["python3", _INTNOTE_SCRIPT, json_path, "-o", tex_path]
        if sections:
            cmd += ["--sections", sections]

        logger.info("Running: %s", " ".join(cmd))
        try:
            script_result = subprocess.run(cmd, capture_output=True, text=True,
                                           timeout=120, cwd=tmpdir)
        except subprocess.TimeoutExpired:
            return jsonify({"error": "Script timed out after 120 s"}), 400

        script_stdout = script_result.stdout
        script_stderr = script_result.stderr

        if script_result.returncode != 0:
            return jsonify({
                "error": "generateConfigInformation.py exited with an error",
                "stdout": script_stdout, "stderr": script_stderr,
            }), 400

        if not os.path.exists(tex_path):
            return jsonify({
                "error": "Script succeeded but produced no output file",
                "stdout": script_stdout, "stderr": script_stderr,
            }), 400

        with open(tex_path, encoding="utf-8", errors="replace") as fh:
            tex_content = fh.read()

        logger.info("Compiling PDF with pdflatex…")
        try:
            pdf_env = os.environ.copy()
            pdf_env["HOME"] = tmpdir          # pdflatex writes format cache to $HOME/.texlive*
            pdf_env["TEXMFVAR"] = tmpdir      # explicit override for OpenShift non-root UIDs
            pdf_env["TEXMFCONFIG"] = tmpdir
            pdf_result = subprocess.run(
                ["pdflatex", "-interaction=nonstopmode", "-output-directory", tmpdir, tex_path],
                capture_output=True, text=True, timeout=120, cwd=tmpdir, env=pdf_env,
            )
        except subprocess.TimeoutExpired:
            return jsonify({
                "error": "pdflatex timed out after 120 s",
                "tex": tex_content, "stdout": script_stdout, "stderr": script_stderr,
            }), 400

        pdf_path = os.path.join(tmpdir, "output.pdf")
        if not os.path.exists(pdf_path):
            return jsonify({
                "error": "pdflatex failed to produce a PDF",
                "tex": tex_content, "stdout": script_stdout, "stderr": script_stderr,
                "pdf_log": pdf_result.stdout + "\n" + pdf_result.stderr,
            }), 400

        with open(pdf_path, "rb") as fh:
            pdf_bytes = fh.read()

        return jsonify({
            "pdf": base64.b64encode(pdf_bytes).decode(),
            "tex": tex_content, "stdout": script_stdout, "stderr": script_stderr,
        })


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
    try:
        # Build eagerly: the first request is fast, and a missing Athena is fatal here.
        get_schema()
    except RuntimeError as exc:
        logger.error("%s", exc)
        sys.exit(1)
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
