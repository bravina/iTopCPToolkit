"""
Introspect ConfigBlock classes and factory functions to extract option metadata.
Requires a live Athena/AnalysisBase environment to work.
Falls back gracefully to an empty option list on import errors.
"""

import importlib
import inspect
import logging
from typing import Any, Dict, List

logger = logging.getLogger("introspect")

# Options that are internal plumbing — skip in the GUI
_SKIP_OPTIONS = {"groupName", "propertyOverrides", "ignoreDependencies"}


def _type_name(t) -> str:
    if t is None:
        return "str"
    name = t.__name__
    # Map Python builtins to simpler labels
    return {"bool": "bool", "int": "int", "float": "float", "str": "str"}.get(name, name)


def _introspect_config_block(cls) -> List[Dict[str, Any]]:
    """Extract options from a ConfigBlock subclass via getOptions()."""
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
    """Extract parameters from a plain factory function."""
    result = []
    for name, param in inspect.signature(func).parameters.items():
        if name in ("self", "seq", "args", "kwargs"):
            continue
        has_default = param.default is not inspect.Parameter.empty
        result.append({
            "name": name,
            "type": "str",  # no type annotation available
            "default": param.default if has_default else None,
            "info": "",
            "required": not has_default,
            "noneAction": "ignore",
        })
    return result


def get_options(class_path: str, is_function: bool) -> List[Dict[str, Any]]:
    """
    Import *class_path* (e.g. "MyModule.SubModule.MyClass") and extract options.
    Returns an empty list if the import or introspection fails (e.g. outside Docker).
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
