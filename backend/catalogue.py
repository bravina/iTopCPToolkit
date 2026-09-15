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

Since TopCPToolkit v3.7.0 the toolkit itself ships only the CI configs, the
analysis examples having moved to the TopCPToolkit_Examples repository
(``Analysis/<group>/<config>/{reco,particle,parton}.yaml``).  Both are used as
example sources here.  In either case a config may pull fragments in with
``include:``; those are resolved — by Athena's own ``combineConfigFiles``, so
the GUI reads exactly what ``runTop_el.py`` would — and an example is offered
only if the resolved config still configures against the blocks this release
registers.  Examples that no longer do (options renamed upstream, a missing
fragment, …) are dropped silently: they are someone else's stale config, not
something the user can act on.
"""

import copy
import glob
import logging
import os
from typing import Any, Dict, List, NamedTuple, Optional

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

# TopCPToolkit_Examples, cloned into the image by the Dockerfile.
EXAMPLES_DIR = "/opt/TopCPToolkit_Examples"
EXAMPLES_SUBDIR = "Analysis"

# The three files a TopCPToolkit config directory may hold.  Everything else
# next to them (fragments pulled in with `include`, input lists, version.txt)
# is not an example in its own right.
LEVEL_FILES = ("reco.yaml", "particle.yaml", "parton.yaml")


# ─────────────────────────────────────────────────────────────────────────────
# Locating the installed data directory
# ─────────────────────────────────────────────────────────────────────────────

def find_tct_data_dir() -> Optional[str]:
    """
    Directory holding ``configs/``: ``$TCT_DATA_DIR`` if set, else the first
    match of ``TCT_DATA_GLOB``.  None when TCT is not built into the image —
    the reason is logged so an empty catalogue is never a mystery.
    """
    env = os.environ.get("TCT_DATA_DIR")
    candidates = [env] if env else sorted(glob.glob(TCT_DATA_GLOB))
    if not candidates:
        logger.warning("No TopCPToolkit data directory matches %s — no catalogue / templates",
                       env or TCT_DATA_GLOB)
        return None
    for c in candidates:
        configs = os.path.join(c, CONFIG_SUBDIR)
        if os.path.isdir(configs):
            return c
        if os.path.islink(configs) and not os.path.exists(configs):
            logger.warning("%s is a dangling symlink to %s — was the TCT source tree deleted "
                           "after the build? (Athena installs share/ files as symlinks)",
                           configs, os.readlink(configs))
        else:
            logger.warning("%s has no %s/ sub-directory", c, CONFIG_SUBDIR)
    return None


def iter_yaml_files(root: str) -> List[str]:
    """Every YAML file under a tree, fragments included."""
    files = []
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            if n.endswith(YAML_EXTENSIONS):
                files.append(os.path.join(dirpath, n))
    return sorted(files)


def iter_config_files(data_dir: str) -> List[str]:
    """Every YAML file shipped with the TopCPToolkit build."""
    return iter_yaml_files(os.path.join(data_dir, CONFIG_SUBDIR))


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


def harvest_add_config_blocks(files: List[str], data_dir: Optional[str] = None,
                              label=None) -> List[Dict[str, Any]]:
    """
    Collect unique ``AddConfigBlocks`` entries across the given YAML files.
    Entries are keyed on (modulePath, functionName, algName); ``usedIn`` lists
    the configs that declare each entry, named by ``label(path)`` (by default
    the path relative to the TCT configs directory).

    Files are read as they are, without resolving ``include:``: an entry is
    declared literally in whichever file holds it, fragments included, so
    scanning every file is both simpler and more complete than resolving.
    """
    if label is None:
        def label(path):
            return _rel(data_dir, path) if data_dir else path
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
            entry["usedIn"].append(label(path))
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
    """
    Harvest + introspect every custom block declared across all example sources.

    Both the configs shipped with TopCPToolkit and the TopCPToolkit_Examples
    checkout are scanned: since TCT v3.7.0 ships only its CI configs, the
    examples repository is where most custom blocks are now declared.
    """
    sources = example_sources(data_dir)
    if not sources:
        return []
    labels: Dict[str, str] = {}
    for source in sources:
        for path in iter_yaml_files(source.root):
            rel = os.path.relpath(path, source.root).replace(os.sep, "/")
            labels[path] = f"{source.name}/{rel}"
    entries = harvest_add_config_blocks(list(labels), label=labels.get)
    for entry in entries:
        # A fresh factory per entry: algName collisions between configs must
        # not poison each other, and registration is cheap.
        entry["block"] = introspect_entry(entry, factory_maker())
    return entries


# ─────────────────────────────────────────────────────────────────────────────
# Example configs
# ─────────────────────────────────────────────────────────────────────────────

class ExampleSource(NamedTuple):
    """One directory tree examples are collected from.

    ``name`` is the first segment of every example path the API exposes, so
    paths stay unique across sources and ``read_example`` can route back.
    """
    name: str
    root: str


def find_examples_dir() -> Optional[str]:
    """
    ``Analysis/`` of the TopCPToolkit_Examples checkout: ``$TCT_EXAMPLES_DIR``
    if set, else the Dockerfile's location.  None when the repository is not in
    the image (it is ATLAS-internal, so a token-less build simply has no copy).
    """
    base = os.environ.get("TCT_EXAMPLES_DIR") or EXAMPLES_DIR
    analysis = os.path.join(base, EXAMPLES_SUBDIR)
    if os.path.isdir(analysis):
        return analysis
    logger.info("No TopCPToolkit_Examples checkout at %s — analysis examples unavailable",
                analysis)
    return None


def example_sources(data_dir: Optional[str]) -> List[ExampleSource]:
    """Every tree examples are read from, in the order they are offered."""
    sources = []
    if data_dir:
        sources.append(ExampleSource("TopCPToolkit", os.path.join(data_dir, CONFIG_SUBDIR)))
    examples = find_examples_dir()
    if examples:
        sources.append(ExampleSource("Examples", examples))
    return sources


def iter_example_files(source: ExampleSource) -> List[str]:
    """
    The ``reco``/``particle``/``parton`` YAML of every config directory under a
    source.  Fragments and data files living next to them are deliberately not
    examples: they are not loadable configs on their own.
    """
    files = []
    for dirpath, _dirs, names in os.walk(source.root):
        present = set(names)
        files.extend(os.path.join(dirpath, n) for n in LEVEL_FILES if n in present)
    return sorted(files)


def _include_roots(path: str) -> List[str]:
    """
    Where `include:` paths are looked up, mirroring TopCPToolkit's own
    ``mergeYAMLconfig``: they are written relative to the directory *above* the
    config's own (``TopCPToolkit/share/configs`` there,
    ``Analysis/<group>`` here).  The config's own directory is offered too, and
    Athena adds $DATAPATH on top.
    """
    own = os.path.dirname(os.path.abspath(path))
    return [os.path.dirname(own), own]


def resolve_includes(path: str) -> tuple:
    """
    Load one config and merge every ``include:`` fragment into it, using
    Athena's ``combineConfigFiles`` so precedence matches a real job exactly.

    Returns ``(config_dict, merged)``; raises whatever the resolution raises
    (a missing fragment is a FileNotFoundError, i.e. a stale example).
    """
    from AnalysisAlgorithmsConfig.ConfigText import combineConfigFiles
    # _find_fragment reads $DATAPATH unconditionally; outside a set-up release
    # (tests) it may be absent.
    os.environ.setdefault("DATAPATH", "")
    with open(path, encoding="utf-8") as fh:
        config = yaml.safe_load(fh)
    if not isinstance(config, dict):
        raise ValueError(f"{path} is not a YAML mapping")
    merged = combineConfigFiles(config, _include_roots(path), fragment_key="include")
    return config, bool(merged)


def config_is_loadable(config: Dict[str, Any]) -> tuple:
    """
    Whether a resolved config still matches the blocks this release registers.

    ``TextConfig.configure()`` is Athena's own check and needs no input file:
    it raises on an unknown block, on options a block does not use, and on
    anything a block's constructor rejects.  Returns ``(ok, reason)``.
    """
    from AnalysisAlgorithmsConfig.ConfigText import TextConfig
    try:
        # loadConfig() consumes the dict it is handed (it pops sub-blocks).
        TextConfig(config=copy.deepcopy(config)).configure()
    except Exception as exc:  # noqa: BLE001 — any failure means "not loadable"
        return False, f"{type(exc).__name__}: {exc}"
    return True, ""


def _example_entry(source: ExampleSource, path: str) -> Optional[Dict[str, Any]]:
    """One example, or None when it is stale (reason logged at debug level)."""
    rel = os.path.relpath(path, source.root).replace(os.sep, "/")
    try:
        config, merged = resolve_includes(path)
    except Exception as exc:  # noqa: BLE001 — unreadable or unresolvable
        logger.debug("Dropping example %s/%s: %s: %s", source.name, rel,
                     type(exc).__name__, exc)
        return None
    ok, reason = config_is_loadable(config)
    if not ok:
        logger.debug("Dropping stale example %s/%s: %s", source.name, rel, reason)
        return None
    return {
        "path": f"{source.name}/{rel}",
        "name": os.path.splitext(rel)[0],
        "source": source.name,
        "merged": merged,
    }


def list_examples(data_dir: Optional[str]) -> List[Dict[str, Any]]:
    """Every example that resolves and still configures, from every source."""
    entries = []
    for source in example_sources(data_dir):
        found = iter_example_files(source)
        kept = [e for e in (_example_entry(source, p) for p in found) if e]
        entries.extend(kept)
        logger.info("Examples from %s (%s): %d of %d usable",
                    source.name, source.root, len(kept), len(found))
    return entries


def read_example(data_dir: Optional[str], rel_path: str) -> Optional[str]:
    """
    The text of one example, with every ``include:`` already resolved so the
    GUI never has to interpret one.  None if unknown, stale, or outside the
    tree.  A config that needed no merging is returned verbatim, comments and
    all; a merged one is re-serialised.
    """
    source_name, _, rel = rel_path.partition("/")
    source = next((s for s in example_sources(data_dir) if s.name == source_name), None)
    if source is None or not rel:
        return None
    root = os.path.realpath(source.root)
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(root + os.sep) or not os.path.isfile(full):
        return None
    if os.path.basename(full) not in LEVEL_FILES:
        return None
    try:
        config, merged = resolve_includes(full)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Example %s could not be resolved: %s", rel_path, exc)
        return None
    if not merged:
        with open(full, encoding="utf-8") as fh:
            return fh.read()
    return yaml.dump(config, sort_keys=False, default_flow_style=False)
