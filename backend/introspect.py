"""
backend/introspect.py

Builds the GUI schema by walking a live ``AnalysisAlgorithmsConfig``
``ConfigFactory``.  The factory is the same registry that ``TextConfig`` uses
to interpret YAML, so whatever it exposes is — by construction — exactly what
a YAML config may contain.  Nothing about blocks, sub-blocks, options or
defaults is hardcoded here; the only GUI-side knowledge is a small
``CATEGORIES`` map used to group blocks in the sidebar.

Requires a live AnalysisBase environment.  Without it, ``athena_available()``
is False and ``app.py`` refuses to build a schema.

Facts about the factory this module relies on (athena/main, Sep 2026):

* ``factory._algs``  : ``{algName: FactoryBlock}`` for root blocks
* ``factory._order`` : ``{parentName: [algName, ...]}`` display order,
  keyed by ``factory.ROOTNAME`` for the root level
* ``FactoryBlock``   : ``alg, factoryName, algName, options, defaults, subAlgs``
  where ``options`` is the list of constructor/function arguments and
  ``subAlgs`` is ``{algName: FactoryBlock}`` (one level deep)
* ``alg`` is either a ``ConfigBlock`` subclass or a ``@groupBlocks`` function
  taking ``seq`` and appending several ``ConfigBlock`` instances to it
* ``ConfigBlock.getOptions()`` returns ``{name: ConfigBlockOption}`` with
  ``type, default, info, required, noneAction`` (and ``meta`` once upstream)
* ``ConfigBlock._expertModeSettings`` and ``getDependencies()`` carry
  expert-mode rules and block dependencies
"""

import copy
import inspect
import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger("introspect")

# Options every ConfigBlock declares in its base constructor.  They are kept in
# the schema but flagged ``generic`` so the UI can fold them away.
GENERIC_OPTIONS = frozenset({
    "groupName", "skipOnData", "skipOnMC", "skipWithSystematics",
    "onlyForDSIDs", "propertyOverrides", "ignoreDependencies",
})

# Constructor / function arguments that are plumbing, never YAML keys.
FACTORY_ARG_SKIP = frozenset({"self", "seq", "args", "kwargs"})

# Factory entries that are not user-facing blocks.
HIDDEN_BLOCKS = frozenset({"AddConfigBlocks"})

KNOWN_TYPES = ("str", "bool", "int", "float", "list", "dict")

# ── Sidebar categories (the only hand-maintained piece) ─────────────────────
# Anything not listed lands in DEFAULT_CATEGORY.  TopCPToolkit blocks harvested
# from the reference configs get TCT_CATEGORY unless listed here.
CATEGORY_ORDER = ["Core", "Objects", "Truth", "Selection", "Output", "TopCPToolkit", "Others"]
DEFAULT_CATEGORY = "Others"
TCT_CATEGORY = "TopCPToolkit"

CATEGORIES: Dict[str, str] = {
    # Core
    "CommonServices": "Core", "PileupReweighting": "Core", "EventCleaning": "Core",
    "HSTPFilter": "Core", "GeneratorLevelAnalysis": "Core", "Bootstraps": "Core",
    "Trigger": "Core", "TriggerMatching": "Core",
    # Objects
    "Jets": "Objects", "Electrons": "Objects", "Muons": "Objects", "Photons": "Objects",
    "TauJets": "Objects", "DiTauJets": "Objects", "InDetTracks": "Objects",
    "MissingET": "Objects", "JetReclustering": "Objects",
    "ReclusteredJetCalibration": "Objects", "SystObjectLink": "Objects",
    "PtEtaSelection": "Objects", "DiTauMMC": "Objects", "EventShape": "Objects",
    # Truth
    "PL_Electrons": "Truth", "PL_Muons": "Truth", "PL_Neutrinos": "Truth", "PL_Jets": "Truth",
    "PL_Taus": "Truth", "PL_Photons": "Truth", "PL_Resonances": "Truth",
    "PL_MissingET": "Truth", "PL_OverlapRemoval": "Truth", "PartonHistory": "Truth",
    # Selection
    "OverlapRemoval": "Selection", "ObjectCutFlow": "Selection",
    "EventSelection": "Selection", "EventCutFlow": "Selection",
    "SelectionDecoration": "Selection", "VGammaOR": "Selection",
    # Output
    "Thinning": "Output", "PerEventSF": "Output", "LeptonSF": "Output",
    "FakeBkgCalculator": "Output", "Output": "Output", "IOStats": "Output",
    "PrintConfiguration": "Output",
}


# ─────────────────────────────────────────────────────────────────────────────
# Environment helpers
# ─────────────────────────────────────────────────────────────────────────────

def athena_available() -> bool:
    """True when the AnalysisBase configuration machinery is importable."""
    try:
        import AnalysisAlgorithmsConfig.ConfigFactory  # noqa: F401
        return True
    except ImportError:
        return False


def make_factory():
    """
    Create the registry the GUI mirrors.  ``TextConfig`` rather than plain
    ``ConfigFactory`` because it also knows how to register ``AddConfigBlocks``
    entries (used by catalogue.py).
    """
    from AnalysisAlgorithmsConfig.ConfigText import TextConfig
    return TextConfig()


# ─────────────────────────────────────────────────────────────────────────────
# Small pure helpers
# ─────────────────────────────────────────────────────────────────────────────

_LABEL_SPLIT = re.compile(r"(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def label_for(name: str) -> str:
    """'PileupReweighting' -> 'Pileup Reweighting', 'PL_Jets' -> 'PL Jets'."""
    return _LABEL_SPLIT.sub(" ", name.replace("_", " ")).strip()


def category_for(name: str, default: str = DEFAULT_CATEGORY) -> str:
    return CATEGORIES.get(name, default)


def json_safe(value: Any) -> Any:
    """Recursively convert a Python value into something JSON-serialisable."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (list, tuple, set, frozenset)):
        return [json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if inspect.isclass(value) or callable(value):
        return getattr(value, "__name__", repr(value))
    return repr(value)


def type_name(opt_type: Any, default: Any) -> str:
    """
    Map an option's declared type to the GUI type label.  When the block
    declared ``type=None`` the type is inferred from the default value.
    """
    if opt_type is not None:
        name = getattr(opt_type, "__name__", str(opt_type))
        return name if name in KNOWN_TYPES else "str"
    if isinstance(default, bool):
        return "bool"
    if isinstance(default, int):
        return "int"
    if isinstance(default, float):
        return "float"
    if isinstance(default, (list, tuple)):
        return "list"
    if isinstance(default, dict):
        return "dict"
    return "str"


def physical_unit(info: str) -> Optional[str]:
    """Delegate to Athena's own docs helper so GUI and docs agree on units."""
    if not info:
        return None
    try:
        from AnalysisAlgorithmsConfig.AutogenDocumentation import interpret_physical_unit
        return interpret_physical_unit(info)
    except Exception:  # pragma: no cover - helper missing in some releases
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Block introspection
# ─────────────────────────────────────────────────────────────────────────────

def _constructor_kwargs(fb) -> Dict[str, Any]:
    """
    Keyword arguments needed to instantiate ``fb.alg`` for introspection —
    mirrors ``FactoryBlock.makeConfig``: factory defaults fill in constructor
    arguments that have no signature default.
    """
    defaults = fb.defaults or {}
    kwargs = {}
    for arg in fb.options or []:
        if arg in FACTORY_ARG_SKIP:
            continue
        if arg in defaults:
            kwargs[arg] = defaults[arg]
    return kwargs


def instantiate(fb) -> List[Any]:
    """
    Return the ``ConfigBlock`` instances behind a factory entry: one for a
    class block, several for a ``@groupBlocks`` function.
    """
    alg = fb.alg
    kwargs = _constructor_kwargs(fb)
    if inspect.isclass(alg):
        return [alg(**kwargs)]
    from AnalysisAlgorithmsConfig.ConfigSequence import ConfigSequence
    seq = ConfigSequence()
    alg(seq=seq, **kwargs)
    return list(seq)


def normalise_meta(meta: Any) -> Optional[Dict[str, Any]]:
    """
    Turn an option's upstream ``meta`` dict into the JSON shape the GUI uses.

    Upstream (``ConfigBlock.addOption``, AB 25.2.110) allows two keys:

    * ``role``    : 'container' | 'containerRef' | 'selection', passed through.
    * ``choices`` : a ``(list[str], int | None)`` tuple, where the second
      element caps how many values may be picked (``None`` = no limit; only
      meaningful for ``list`` options).  It is flattened here into
      ``choices`` (the list) and ``maxChoices`` (the cap), so the frontend
      never has to know about the tuple.

    Unknown keys are passed through untouched, so a future upstream key needs
    no backend change to reach the GUI.
    """
    if not isinstance(meta, dict):
        return None
    out: Dict[str, Any] = {}
    for key, value in meta.items():
        if key != "choices":
            out[key] = json_safe(value)
            continue
        choices, cap = value, None
        if isinstance(value, (tuple, list)) and len(value) == 2 \
                and isinstance(value[0], (list, tuple)) \
                and (value[1] is None or isinstance(value[1], int)):
            choices, cap = value[0], value[1]
        out["choices"] = json_safe(choices)
        out["maxChoices"] = cap
    return out or None


def options_from_block(block) -> List[Dict[str, Any]]:
    """Extract every declared option of one ConfigBlock instance."""
    expert = getattr(block, "_expertModeSettings", None) or {}
    origin = type(block).__name__
    result = []
    for name, opt in block.getOptions().items():
        default = json_safe(opt.default)
        meta = getattr(opt, "meta", None)
        result.append({
            "name": name,
            "type": type_name(opt.type, opt.default),
            "default": default,
            "factoryDefault": None,
            "info": opt.info or "",
            "required": bool(opt.required),
            "noneAction": opt.noneAction,
            "expertMode": _expert_rules(expert.get(name)),
            "physicalUnit": physical_unit(opt.info or ""),
            "generic": name in GENERIC_OPTIONS,
            "origin": origin,
            "meta": normalise_meta(meta),
        })
    return result


def _expert_rules(rule) -> Optional[List[Any]]:
    if rule is None:
        return None
    if rule is True:
        return [True]
    if isinstance(rule, list):
        return [json_safe(r) for r in rule]
    return [json_safe(rule)]


def _constructor_options(fb, known: set) -> List[Dict[str, Any]]:
    """
    Constructor/function arguments are accepted YAML keys too
    (``ConfigText._configureAlg`` counts ``funcOpts`` as expected options).
    Expose those that are not already declared as options.
    """
    defaults = fb.defaults or {}
    try:
        target = fb.alg.__init__ if inspect.isclass(fb.alg) else fb.alg
        sig_defaults = {
            k: v.default for k, v in inspect.signature(target).parameters.items()
            if v.default is not inspect.Parameter.empty
        }
    except (TypeError, ValueError):
        sig_defaults = {}
    result = []
    for arg in fb.options or []:
        if arg in FACTORY_ARG_SKIP or arg in known:
            continue
        default = defaults.get(arg, sig_defaults.get(arg))
        result.append({
            "name": arg,
            "type": type_name(None, default),
            "default": json_safe(default),
            "factoryDefault": json_safe(defaults[arg]) if arg in defaults else None,
            "info": "",
            "required": arg not in defaults and arg not in sig_defaults,
            "noneAction": "ignore",
            "expertMode": None,
            "physicalUnit": None,
            "generic": False,
            "origin": "__init__",
            "meta": None,
        })
    return result


def _apply_factory_defaults(options: List[Dict[str, Any]], fb) -> None:
    for opt in options:
        if fb.defaults and opt["name"] in fb.defaults:
            value = json_safe(fb.defaults[opt["name"]])
            opt["factoryDefault"] = value
            opt["default"] = value


def _empty_block(fb, is_sub: bool) -> Dict[str, Any]:
    name = fb.algName
    return {
        "name": name,
        "factoryName": fb.factoryName,
        "kind": "class" if inspect.isclass(fb.alg) else "group",
        "category": None if is_sub else category_for(name),
        "label": label_for(name),
        "classes": [],
        "options": [],
        "dependencies": [],
        "subBlocks": [],
        "parents": [],
        "error": None,
    }


def block_from_factory(fb, factory, is_sub: bool = False, _cache=None) -> Dict[str, Any]:
    """
    Build the schema entry for one ``FactoryBlock`` (recursing into its
    sub-blocks).  Never raises: introspection failures are recorded in
    ``block["error"]`` and logged, so a broken block is still visible.
    """
    if _cache is None:
        _cache = {}
    cache_key = (id(fb.alg), repr(fb.defaults))
    if cache_key in _cache:
        block = copy.deepcopy(_cache[cache_key])
        block.update({"name": fb.algName, "factoryName": fb.factoryName,
                      "label": label_for(fb.algName),
                      "category": None if is_sub else category_for(fb.algName)})
    else:
        block = _empty_block(fb, is_sub)
        try:
            seen = set()
            for inst in instantiate(fb):
                cls = type(inst)
                block["classes"].append({
                    "module": cls.__module__,
                    "cls": cls.__name__,
                    "docstring": inspect.getdoc(cls) or "",
                })
                for opt in options_from_block(inst):
                    if opt["name"] in seen:
                        continue
                    seen.add(opt["name"])
                    block["options"].append(opt)
                get_deps = getattr(inst, "getDependencies", None)
                if callable(get_deps):
                    for dep in get_deps() or []:
                        block["dependencies"].append({
                            "blockName": getattr(dep, "blockName", str(dep)),
                            "required": bool(getattr(dep, "required", True)),
                        })
            block["options"].extend(_constructor_options(fb, seen))
            _apply_factory_defaults(block["options"], fb)
        except Exception as exc:  # noqa: BLE001 - surface every failure
            block["error"] = f"{type(exc).__name__}: {exc}"
            logger.warning("Cannot introspect block %s (%s): %s",
                           fb.factoryName, getattr(fb.alg, "__name__", fb.alg), exc)
        _cache[cache_key] = copy.deepcopy(block)

    # Sub-blocks: order comes from factory._order keyed by this block's name
    order = factory._order.get(fb.algName, [])
    for sub_name in order:
        sub_fb = fb.subAlgs.get(sub_name)
        if sub_fb is None:
            continue
        block["subBlocks"].append(block_from_factory(sub_fb, factory, is_sub=True, _cache=_cache))
    return block


def _assign_parents(blocks: List[Dict[str, Any]]) -> None:
    parents: Dict[str, List[str]] = {}
    for b in blocks:
        for sb in b["subBlocks"]:
            parents.setdefault(sb["name"], []).append(b["name"])
    for b in blocks:
        for sb in b["subBlocks"]:
            sb["parents"] = list(parents.get(sb["name"], []))


def event_selection_keywords() -> Optional[Dict[str, Any]]:
    """
    The ``selectionCuts`` keyword grammar, straight from
    ``EventSelectionConfig.keywordSpecs()`` (AB 25.2.110 and later).  The same
    table drives Athena's own parser, so the GUI cuts editor cannot drift from
    it.  None when the release does not expose it.
    """
    try:
        from EventSelectionAlgorithms.EventSelectionConfig import EventSelectionConfig
    except ImportError:
        logger.warning("EventSelectionAlgorithms not importable — no keyword spec")
        return None
    specs = getattr(EventSelectionConfig, "keywordSpecs", None)
    if not callable(specs):
        logger.warning("EventSelectionConfig has no keywordSpecs() — release too old "
                       "for the typed selection-cuts editor")
        return None
    try:
        return {str(kw): json_safe(spec) for kw, spec in specs().items()}
    except Exception as exc:  # noqa: BLE001 - never break the schema over this
        logger.warning("EventSelectionConfig.keywordSpecs() failed: %s", exc)
        return None


def build_schema(factory=None) -> Dict[str, Any]:
    """
    Walk the factory and return ``{"categories": [...], "blocks": [...]}``.
    Root blocks appear in factory order (the order ``TextConfig`` schedules them).
    """
    if factory is None:
        factory = make_factory()
    cache: Dict[Any, Any] = {}
    blocks = []
    for name in factory._order.get(factory.ROOTNAME, []):
        if name in HIDDEN_BLOCKS:
            continue
        fb = factory._algs.get(name)
        if fb is None:
            continue
        blocks.append(block_from_factory(fb, factory, _cache=cache))
    _assign_parents(blocks)
    return {"categories": list(CATEGORY_ORDER), "blocks": blocks}


def find_factory_block(factory, alg_name: str, super_blocks=None):
    """Locate a ``FactoryBlock`` at the root or under the first super-block."""
    if super_blocks:
        parent = super_blocks[0] if isinstance(super_blocks, (list, tuple)) else super_blocks
        if parent != factory.ROOTNAME:
            return factory._algs[parent].subAlgs[alg_name]
    return factory._algs[alg_name]
