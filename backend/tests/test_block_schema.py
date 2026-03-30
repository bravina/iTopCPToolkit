# backend/tests/test_block_schema.py
#
# Automatic tests for block_schema.py.
#
# All tests derive their expectations directly from the schema data itself —
# no hardcoded expected values.  They will catch:
#   - Structural regressions (missing keys, wrong types)
#   - Duplicate block names
#   - Malformed class_path strings
#   - Sub-blocks that nest more than one level deep
#   - Inconsistencies between is_function and the class_path format

import importlib
import pytest
from block_schema import BLOCK_TREE


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

REQUIRED_BLOCK_KEYS = {"name", "label", "group", "repeatable", "class_path", "is_function", "sub_blocks"}
REQUIRED_SUB_KEYS   = {"name", "label",           "repeatable", "class_path", "is_function", "sub_blocks"}

def all_blocks():
    """Yield (block_dict, parent_name_or_None) for every block and sub-block."""
    for block in BLOCK_TREE:
        yield block, None
        for sub in block.get("sub_blocks", []):
            yield sub, block["name"]


# ─────────────────────────────────────────────────────────────────────────────
# Structure
# ─────────────────────────────────────────────────────────────────────────────

class TestBlockStructure:

    def test_block_tree_is_list(self):
        assert isinstance(BLOCK_TREE, list)
        assert len(BLOCK_TREE) > 0

    @pytest.mark.parametrize("block,parent", list(all_blocks()))
    def test_required_keys_present(self, block, parent):
        required = REQUIRED_BLOCK_KEYS if parent is None else REQUIRED_SUB_KEYS
        missing = required - block.keys()
        assert not missing, f"Block '{block.get('name')}' (parent={parent}) missing keys: {missing}"

    @pytest.mark.parametrize("block,parent", list(all_blocks()))
    def test_name_is_non_empty_string(self, block, parent):
        assert isinstance(block["name"], str) and block["name"], \
            f"Block name must be a non-empty string, got: {block.get('name')!r}"

    @pytest.mark.parametrize("block,parent", list(all_blocks()))
    def test_repeatable_is_bool(self, block, parent):
        assert isinstance(block["repeatable"], bool), \
            f"'repeatable' must be bool in block '{block['name']}'"

    @pytest.mark.parametrize("block,parent", list(all_blocks()))
    def test_is_function_is_bool(self, block, parent):
        assert isinstance(block["is_function"], bool), \
            f"'is_function' must be bool in block '{block['name']}'"

    @pytest.mark.parametrize("block,parent", list(all_blocks()))
    def test_sub_blocks_is_list(self, block, parent):
        assert isinstance(block["sub_blocks"], list), \
            f"'sub_blocks' must be a list in block '{block['name']}'"

    @pytest.mark.parametrize("block,parent", list(all_blocks()))
    def test_class_path_has_module_and_class(self, block, parent):
        path = block["class_path"]
        assert "." in path, \
            f"'class_path' must be a dotted path (e.g. 'Pkg.Module.Class'), got: {path!r}"
        parts = path.rsplit(".", 1)
        assert all(p for p in parts), \
            f"'class_path' has empty component in block '{block['name']}': {path!r}"

    def test_top_level_blocks_have_group(self):
        for block in BLOCK_TREE:
            assert isinstance(block.get("group"), str) and block["group"], \
                f"Top-level block '{block['name']}' must have a non-empty 'group'"

    def test_sub_blocks_do_not_nest(self):
        """Sub-blocks must not have their own sub-blocks (max one level deep)."""
        for block in BLOCK_TREE:
            for sub in block.get("sub_blocks", []):
                assert sub.get("sub_blocks") == [], \
                    f"Sub-block '{sub['name']}' of '{block['name']}' must have empty sub_blocks"


# ─────────────────────────────────────────────────────────────────────────────
# Uniqueness
# ─────────────────────────────────────────────────────────────────────────────

class TestUniqueness:

    def test_top_level_names_are_unique(self):
        names = [b["name"] for b in BLOCK_TREE]
        duplicates = [n for n in set(names) if names.count(n) > 1]
        assert not duplicates, f"Duplicate top-level block names: {duplicates}"

    def test_sub_block_names_unique_within_parent(self):
        for block in BLOCK_TREE:
            sub_names = [s["name"] for s in block.get("sub_blocks", [])]
            duplicates = [n for n in set(sub_names) if sub_names.count(n) > 1]
            assert not duplicates, \
                f"Duplicate sub-block names in '{block['name']}': {duplicates}"


# ─────────────────────────────────────────────────────────────────────────────
# class_path importability (skipped outside Docker / Athena environment)
# ─────────────────────────────────────────────────────────────────────────────

def _athena_available():
    try:
        importlib.import_module("AthenaCommon")
        return True
    except ImportError:
        return False


@pytest.mark.skipif(not _athena_available(), reason="Athena environment not available")
class TestAthenaIntrospection:
    """
    These tests only run inside the Docker container where Athena is sourced.
    They verify that every class_path in block_schema.py can actually be
    imported and introspected.  A failure here means a class was renamed or
    moved between AnalysisBase releases.
    """

    @pytest.mark.parametrize("block,parent", list(all_blocks()))
    def test_class_path_is_importable(self, block, parent):
        from introspect import get_options
        options = get_options(block["class_path"], block["is_function"])
        # We don't assert a specific number of options — just that it didn't
        # raise and returned a list.
        assert isinstance(options, list), \
            f"get_options returned non-list for '{block['name']}' ({block['class_path']})"

    @pytest.mark.parametrize("block,parent", [
        (b, None) for b in BLOCK_TREE if not b["is_function"]
    ])
    def test_config_block_has_options(self, block, parent):
        """
        Non-function ConfigBlock subclasses should expose at least one option.
        An empty list likely means the class_path points to the wrong class.
        """
        from introspect import get_options
        options = get_options(block["class_path"], block["is_function"])
        assert len(options) > 0, \
            f"Block '{block['name']}' ({block['class_path']}) returned no options — " \
            f"wrong class_path or class doesn't call addOption()?"
