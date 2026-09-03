"""
backend/catalogue.py

TopCPToolkit does not register its custom blocks in Python; users declare
them in YAML through the special ``AddConfigBlocks`` block::

    AddConfigBlocks:
      - modulePath: 'TopCPToolkit.KLFitterConfig'
        functionName: 'KLFitterConfig'
        algName: 'KLFitter'
        pos: 'Output'

The GUI therefore builds its catalogue of TCT blocks by *harvesting* every
``AddConfigBlocks`` entry found in the reference configs installed with the
TCT build (``<build>/x86_64*/data/TopCPToolkit/configs/**``), and introspecting
each one the same way ``TextConfig`` would register it.  The reference configs
double as "start from template" examples.
"""

import glob
import logging
import os
from typing import Any, Dict, List, Optional

import yaml

from introspect import (
    TCT_CATEGORY, block_from_factory, category_for, find_factory_block,
    label_for, make_factory,
)

logger = logging.getLogger("catalogue")

TCT_DATA_GLOB = "/opt/TopCPToolkit/build/*/data/TopCPToolkit"
CONFIG_SUBDIR = "configs"
YAML_EXTENSIONS = (".yaml", ".yml")
ENTRY_KEYS = ("modulePath", "functionName", "algName")


# ─────────────────────────────────────────────────────────────────────────────
# Locating the installed data directory
# ─────────────────────────────────────────────────────────────────────────────

def find_tct_data_dir() -> Optional[str]:
    """
    Directory holding ``configs/``: ``$TCT_DATA_DIR`` if set, else the first
    match of ``TCT_DATA_GLOB``.  None when TCT is not built into the image.
    """
    env = os.environ.get("TCT_DATA_DIR")
    candidates = [env] if env else sorted(glob.glob(TCT_DATA_GLOB))
    for c in candidates:
        if c and os.path.isdir(os.path.join(c, CONFIG_SUBDIR)):
            return c
    return None


def iter_config_files(data_dir: str) -> List[str]:
    root = os.path.join(data_dir, CONFIG_SUBDIR)
    files = []
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            if n.endswith(YAML_EXTENSIONS):
                files.append(os.path.join(dirpath, n))
    return sorted(files)


def _rel(data_dir: str, path: str) -> str:
    return os.path.relpath(path, os.path.join(data_dir, CONFIG_SUBDIR))


# ─────────────────────────────────────────────────────────────────────────────
# Harvesting AddConfigBlocks entries
# ─────────────────────────────────────────────────────────────────────────────

def _normalise_add_config_blocks(value: Any) -> List[Dict[str, Any]]:
    """Accept both the list form and the dict form ``{algName: {...}}``."""
    if isinstance(value, dict):
        return [dict(opts or {}, algName=name) for name, opts in value.items()]
    if isinstance(value, list):
        return [e for e in value if isinstance(e, dict)]
    return []


def harvest_add_config_blocks(files: List[str], data_dir: Optional[str] = None) -> List[Dict[str, Any]]:
    """
    Collect unique ``AddConfigBlocks`` entries across the given YAML files.
    Entries are keyed on (modulePath, functionName, algName); ``usedIn`` lists
    the configs (relative paths) that declare each entry.
    """
    entries: Dict[tuple, Dict[str, Any]] = {}
    for path in files:
        try:
            with open(path, encoding="utf-8") as fh:
                doc = yaml.safe_load(fh)
        except Exception as exc:  # noqa: BLE001 - a broken example must not kill startup
            logger.warning("Skipping unreadable config %s: %s", path, exc)
            continue
        if not isinstance(doc, dict):
            continue
        for raw in _normalise_add_config_blocks(doc.get("AddConfigBlocks")):
            if not all(isinstance(raw.get(k), str) and raw.get(k) for k in ENTRY_KEYS):
                logger.warning("Ignoring malformed AddConfigBlocks entry in %s: %r", path, raw)
                continue
            key = tuple(raw[k] for k in ENTRY_KEYS)
            entry = entries.setdefault(key, {
                "modulePath": raw["modulePath"],
                "functionName": raw["functionName"],
                "algName": raw["algName"],
                "pos": raw.get("pos"),
                "superBlocks": raw.get("superBlocks"),
                "usedIn": [],
            })
            entry["usedIn"].append(_rel(data_dir, path) if data_dir else path)
    return sorted(entries.values(), key=lambda e: e["algName"].lower())


# ─────────────────────────────────────────────────────────────────────────────
# Introspecting one entry
# ─────────────────────────────────────────────────────────────────────────────

def introspect_entry(entry: Dict[str, Any], factory=None) -> Dict[str, Any]:
    """
    Register the entry into a (scratch) factory exactly like
    ``TextConfig._addNewConfigBlocks`` and return its schema block.
    ``pos`` is deliberately not passed: it only affects scheduling order and
    may reference blocks unknown to the scratch factory.
    """
    if factory is None:
        factory = make_factory()
    alg_name = entry["algName"]
    try:
        factory._addNewConfigBlocks(
            modulePath=entry["modulePath"],
            functionName=entry["functionName"],
            algName=alg_name,
            superBlocks=entry.get("superBlocks"),
        )
        fb = find_factory_block(factory, alg_name, entry.get("superBlocks"))
        block = block_from_factory(fb, factory, is_sub=bool(entry.get("superBlocks")))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cannot introspect AddConfigBlocks entry %s (%s.%s): %s",
                       alg_name, entry["modulePath"], entry["functionName"], exc)
        block = {
            "name": alg_name, "factoryName": alg_name, "kind": "class",
            "category": None, "label": label_for(alg_name), "classes": [],
            "options": [], "dependencies": [], "subBlocks": [], "parents": [],
            "error": f"{type(exc).__name__}: {exc}",
        }
    block["category"] = category_for(alg_name, TCT_CATEGORY)
    return block


def build_catalogue(data_dir: Optional[str], factory_maker=make_factory) -> List[Dict[str, Any]]:
    """Harvest + introspect every custom block declared in the reference configs."""
    if not data_dir:
        return []
    entries = harvest_add_config_blocks(iter_config_files(data_dir), data_dir)
    for entry in entries:
        # A fresh factory per entry: algName collisions between configs must
        # not poison each other, and registration is cheap.
        entry["block"] = introspect_entry(entry, factory_maker())
    return entries


# ─────────────────────────────────────────────────────────────────────────────
# Reference configs as examples
# ─────────────────────────────────────────────────────────────────────────────

def list_examples(data_dir: Optional[str]) -> List[Dict[str, str]]:
    if not data_dir:
        return []
    return [{"path": _rel(data_dir, p), "name": os.path.splitext(_rel(data_dir, p))[0]}
            for p in iter_config_files(data_dir)]


def read_example(data_dir: Optional[str], rel_path: str) -> Optional[str]:
    """Return the text of one reference config; None if missing or outside the tree."""
    if not data_dir:
        return None
    root = os.path.realpath(os.path.join(data_dir, CONFIG_SUBDIR))
    full = os.path.realpath(os.path.join(root, rel_path))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
        return None
    with open(full, encoding="utf-8") as fh:
        return fh.read()
