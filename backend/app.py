"""
TopCPToolkit GUI – Flask backend.

Endpoints
---------
GET  /api/schema              Full block tree with introspected options
GET  /api/health              Liveness check; reports Athena + version info
POST /api/export-yaml         Returns YAML content as a downloadable response
POST /api/generate-intnote    Runs generateConfigInformation.py on a JSON file,
                              compiles the resulting .tex to PDF, returns both
"""

import base64
import copy
import glob
import logging
import os
import shutil
import subprocess
import tempfile

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

# Path to the ConfigDocumentation script kept from the TCT source tree
_INTNOTE_SCRIPT = "/opt/TopCPToolkit/ConfigDocumentation/generateConfigInformation.py"


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


def _pdflatex_available():
    """Return True if pdflatex is on PATH."""
    return shutil.which("pdflatex") is not None


def _intnote_available():
    """Return True if both the TCT script and pdflatex are present."""
    return os.path.isfile(_INTNOTE_SCRIPT) and _pdflatex_available()


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
        "pdflatex": _pdflatex_available(),
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
    # ── Availability checks ──────────────────────────────────────────────────
    if not os.path.isfile(_INTNOTE_SCRIPT):
        return jsonify({
            "error": "TopCPToolkit not available — generateConfigInformation.py not found. "
                     "Rebuild the image with TCT_VERSION set.",
        }), 400

    if not _pdflatex_available():
        return jsonify({
            "error": "pdflatex not found. Rebuild the image with texlive installed.",
        }), 400

    # ── Input validation ─────────────────────────────────────────────────────
    json_file = request.files.get("json")
    if not json_file:
        return jsonify({"error": "No JSON file provided"}), 400

    sections = request.form.get("sections", "").strip()

    # ── Run in a temp directory ──────────────────────────────────────────────
    with tempfile.TemporaryDirectory() as tmpdir:
        json_path = os.path.join(tmpdir, "config.json")
        tex_path  = os.path.join(tmpdir, "output.tex")
        json_file.save(json_path)

        # 1. Run the TopCPToolkit script
        cmd = ["python3", _INTNOTE_SCRIPT, json_path, "-o", tex_path]
        if sections:
            cmd += ["--sections", sections]

        logger.info("Running: %s", " ".join(cmd))
        try:
            script_result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,
                cwd=tmpdir,
            )
        except subprocess.TimeoutExpired:
            return jsonify({"error": "Script timed out after 120 s"}), 400

        script_stdout = script_result.stdout
        script_stderr = script_result.stderr

        if script_result.returncode != 0:
            return jsonify({
                "error": "generateConfigInformation.py exited with an error",
                "stdout": script_stdout,
                "stderr": script_stderr,
            }), 400

        if not os.path.exists(tex_path):
            return jsonify({
                "error": "Script succeeded but produced no output file",
                "stdout": script_stdout,
                "stderr": script_stderr,
            }), 400

        with open(tex_path, encoding="utf-8", errors="replace") as fh:
            tex_content = fh.read()

        # 2. Compile to PDF with pdflatex
        logger.info("Compiling PDF with pdflatex…")
        try:
            pdf_env = os.environ.copy()
            pdf_env["HOME"]        = tmpdir  # pdflatex writes format cache to $HOME/.texlive*
            pdf_env["TEXMFVAR"]    = tmpdir  # explicit override for OpenShift non-root UIDs
            pdf_env["TEXMFCONFIG"] = tmpdir
            pdf_result = subprocess.run(
                [
                    "pdflatex",
                    "-interaction=nonstopmode",
                    "-output-directory", tmpdir,
                    tex_path,
                ],
                capture_output=True,
                text=True,
                timeout=120,
                cwd=tmpdir,
                env=pdf_env,
            )
        except subprocess.TimeoutExpired:
            return jsonify({
                "error": "pdflatex timed out after 120 s",
                "tex": tex_content,
                "stdout": script_stdout,
                "stderr": script_stderr,
            }), 400

        # pdflatex names the PDF after the input filename (output.pdf)
        pdf_path = os.path.join(tmpdir, "output.pdf")

        if not os.path.exists(pdf_path):
            return jsonify({
                "error": "pdflatex failed to produce a PDF",
                "tex": tex_content,
                "stdout": script_stdout,
                "stderr": script_stderr,
                "pdf_log": pdf_result.stdout + "\n" + pdf_result.stderr,
            }), 400

        with open(pdf_path, "rb") as fh:
            pdf_bytes = fh.read()

        return jsonify({
            "pdf": base64.b64encode(pdf_bytes).decode(),
            "tex": tex_content,
            "stdout": script_stdout,
            "stderr": script_stderr,
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
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
