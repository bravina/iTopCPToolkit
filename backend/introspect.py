# backend/introspect.py
#
# Introspects ConfigBlock classes and factory functions at runtime to extract
# the list of configurable options, their types, defaults and help strings.
#
# Requires a live Athena/AnalysisBase environment.  Outside of Docker the
# imports will fail and every call returns an empty list — the GUI still works,
# it just shows no options for each block.

import importlib
import inspect
import logging
from typing import Any, Dict, List

logger = logging.getLogger("introspect")

# Options that are internal Athena plumbing; never shown in the GUI.
_SKIP_OPTIONS = {"groupName", "propertyOverrides", "ignoreDependencies"}


def _type_name(t) -> str:
    """Convert a Python type object to the simple string label used by the GUI."""
    if t is None:
        return "str"
    return {"bool": "bool", "int": "int", "float": "float", "str": "str"}.get(t.__name__, t.__name__)


def _introspect_config_block(cls) -> List[Dict[str, Any]]:
    """
    Instantiate a ConfigBlock subclass and call getOptions() to extract all
    declared options with their metadata.
    """
    instance = cls()
    options_dict = instance.getOptions()
    result = []
    for name, opt in options_dict.items():
        if name in _SKIP_OPTIONS:
            continue
        result.append({
            "name": name,
            "type": _type_name(opt.type),
            "default": opt.default,
            "info": opt.info or "",
            "required": bool(opt.required),
            "noneAction": opt.noneAction,
        })
    return result


def _introspect_function(func) -> List[Dict[str, Any]]:
    """
    Extract parameters from a plain factory function (used when is_function=True
    in block_schema.py).  No type information is available; everything is "str".
    """
    result = []
    for name, param in inspect.signature(func).parameters.items():
        if name in ("self", "seq", "args", "kwargs"):
            continue
        has_default = param.default is not inspect.Parameter.empty
        result.append({
            "name": name,
            "type": "str",
            "default": param.default if has_default else None,
            "info": "",
            "required": not has_default,
            "noneAction": "ignore",
        })
    return result


def get_options(class_path: str, is_function: bool) -> List[Dict[str, Any]]:
    """
    Import *class_path* (e.g. "MyPkg.MyModule.MyClass") and extract options.

    Returns an empty list if the import or introspection fails (e.g. when
    running outside the Docker container without Athena).
    """
    try:
        module_path, obj_name = class_path.rsplit(".", 1)
        module = importlib.import_module(module_path)
        obj = getattr(module, obj_name)

        if is_function or (callable(obj) and not inspect.isclass(obj)):
            return _introspect_function(obj)
        else:
            return _introspect_config_block(obj)
    except Exception as exc:
        logger.debug("Cannot introspect %s: %s", class_path, exc)
        return []
