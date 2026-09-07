# backend/tests/test_introspect.py
#
# Tests for the factory walk, against the REAL AnalysisAlgorithmsConfig factory
# (the suite refuses to run without it — see conftest.py).
#
# Two kinds of assertion:
#   * invariants that must hold for every block, whatever upstream registers;
#   * exact anchors on a handful of blocks that are stable in AnalysisBase
#     25.2.106 (CommonServices, Jets, PtEtaSelection).
# There is deliberately no hardcoded list of Athena block names anywhere: a new
# upstream block must never make this suite red.

import json

import pytest

from AnalysisAlgorithmsConfig.ConfigBlock import ConfigBlock

from introspect import (
    CATEGORY_ORDER, GENERIC_OPTIONS, KNOWN_TYPES, block_from_factory, build_schema,
    find_factory_block, json_safe, label_for, make_factory, type_name,
)


def by_name(blocks, name):
    return next(b for b in blocks if b["name"] == name)


def opt(block, name):
    return next(o for o in block["options"] if o["name"] == name)


def every_block(schema):
    """Root blocks and their sub-blocks, flattened."""
    for b in schema["blocks"]:
        yield b
        yield from b["subBlocks"]


def every_option(schema):
    for b in every_block(schema):
        for o in b["options"]:
            yield b, o


@pytest.fixture(scope="module")
def schema():
    return build_schema()


# ─────────────────────────────────────────────────────────────────────────────
# Pure helpers
# ─────────────────────────────────────────────────────────────────────────────

class TestHelpers:

    @pytest.mark.parametrize("name,label", [
        ("PileupReweighting", "Pileup Reweighting"),
        ("PL_Jets", "PL Jets"),
        ("MissingET", "Missing ET"),
        ("TauJets", "Tau Jets"),
        ("JVT", "JVT"),
        ("EventCutFlow", "Event Cut Flow"),
    ])
    def test_label_for(self, name, label):
        assert label_for(name) == label

    @pytest.mark.parametrize("t,default,expected", [
        (str, "x", "str"), (bool, False, "bool"), (int, 1, "int"), (float, 1.0, "float"),
        (list, [], "list"), (dict, {}, "dict"),
        (None, [], "list"), (None, {}, "dict"), (None, True, "bool"), (None, 3, "int"),
        (None, 2.5, "float"), (None, "s", "str"), (None, None, "str"),
    ])
    def test_type_name(self, t, default, expected):
        assert type_name(t, default) == expected

    def test_json_safe(self):
        def pred(v):
            return v
        assert json_safe({"a": [1, (2, 3), pred, str]}) == {"a": [1, [2, 3], "pred", "str"]}
        assert json_safe(None) is None


# ─────────────────────────────────────────────────────────────────────────────
# The real factory: invariants
# ─────────────────────────────────────────────────────────────────────────────

class TestRealFactoryInvariants:

    def test_every_block_introspects(self, schema):
        errors = [(b["factoryName"], b["error"]) for b in every_block(schema) if b["error"]]
        assert not errors, f"Blocks failing introspection: {errors}"

    def test_every_block_has_options(self, schema):
        # Every ConfigBlock inherits the generic options from its base
        # constructor, so an empty option list means introspection went wrong.
        for b in every_block(schema):
            assert b["options"], f"{b['factoryName']} has no options"

    def test_categories_are_the_gui_order(self, schema):
        assert schema["categories"] == CATEGORY_ORDER

    def test_grouped_blocks_have_several_classes(self, schema):
        groups = [b for b in schema["blocks"] if b["kind"] == "group"]
        assert groups, "expected at least one @groupBlocks entry (e.g. Jets)"
        assert any(len(b["classes"]) > 1 for b in groups)

    def test_every_class_is_identified(self, schema):
        for b in every_block(schema):
            for c in b["classes"]:
                assert c["module"] and c["cls"]

    def test_add_config_blocks_hidden(self, schema):
        assert "AddConfigBlocks" not in [b["name"] for b in schema["blocks"]]
        assert "AddConfigBlocks" in make_factory()._algs

    def test_schema_is_json_serialisable(self, schema):
        json.dumps(schema)


# ─────────────────────────────────────────────────────────────────────────────
# The real factory: anchors on individual blocks
# ─────────────────────────────────────────────────────────────────────────────

class TestRealFactoryBlocks:

    def test_class_block(self, schema):
        # PtEtaSelectionBlock is registered directly (a plain ConfigBlock
        # subclass), so the schema entry carries exactly one class.
        pteta = by_name(schema["blocks"], "PtEtaSelection")
        assert pteta["kind"] == "class"
        assert pteta["factoryName"] == "PtEtaSelection"
        assert pteta["category"] == "Objects"    # from introspect.CATEGORIES
        assert pteta["error"] is None
        assert len(pteta["classes"]) == 1
        o = opt(pteta, "selectionName")
        assert o["type"] == "str"
        assert o["noneAction"] in ("ignore", "error")
        assert o["generic"] is False

    def test_common_services(self, schema):
        # NB: in AnalysisBase 25.2.106 CommonServices is a @groupBlocks function
        # (it appends CommonServicesConfig + TruthCollectionsFixerBlock), not a
        # single class — hence kind "group" here.
        cs = by_name(schema["blocks"], "CommonServices")
        assert cs["kind"] == "group"
        assert cs["factoryName"] == "CommonServices"
        assert cs["category"] == "Core"          # from introspect.CATEGORIES
        assert cs["error"] is None
        # tri-state: the option is declared `type=bool` with default None,
        # meaning "run systematics on MC only".
        assert opt(cs, "runSystematics")["type"] == "bool"

    def test_group_block_merges_options(self, schema):
        jets = by_name(schema["blocks"], "Jets")
        assert jets["kind"] == "group"
        assert len(jets["classes"]) > 1
        names = [o["name"] for o in jets["options"]]
        # The group's classes share options (containerName, jetCollection, ...);
        # the schema must expose each name exactly once, first class winning.
        assert len(names) == len(set(names)), \
            f"duplicate options in Jets: {sorted({n for n in names if names.count(n) > 1})}"
        for o in jets["options"]:
            assert o["origin"], f"Jets.{o['name']} has no origin"

    def test_sub_blocks(self, schema):
        jets = by_name(schema["blocks"], "Jets")
        assert jets["subBlocks"], "expected sub-blocks under Jets (JVT, PtEtaSelection, ...)"
        for b in schema["blocks"]:
            for s in b["subBlocks"]:
                # FactoryBlock names sub-blocks "<parent>.<name>"
                assert s["factoryName"] == f"{b['factoryName']}.{s['name']}"
                assert s["category"] is None     # categories are a root-level concept
                assert b["name"] in s["parents"]

    def test_a_sub_block_is_shared_between_parents(self, schema):
        # PtEtaSelection is registered with superBlocks=[ROOTNAME, "Jets",
        # "Electrons", "Muons", ...], so it appears both at the root and under
        # several parents — the two forms must not be confused with each other.
        root = by_name(schema["blocks"], "PtEtaSelection")
        assert root["parents"] == []
        sub = by_name(by_name(schema["blocks"], "Jets")["subBlocks"], "PtEtaSelection")
        assert sub["factoryName"] == "Jets.PtEtaSelection"
        assert len(sub["parents"]) > 1, f"expected several parents, got {sub['parents']}"

        shared = {s["name"] for b in schema["blocks"] for s in b["subBlocks"]
                  if len(s["parents"]) > 1}
        assert "PtEtaSelection" in shared

    def test_dependencies(self, schema):
        with_deps = {b["factoryName"]: b["dependencies"]
                     for b in every_block(schema) if b["dependencies"]}
        assert with_deps, "expected at least one block declaring addDependency()"
        for deps in with_deps.values():
            for d in deps:
                assert d["blockName"] and isinstance(d["required"], bool)


# ─────────────────────────────────────────────────────────────────────────────
# The real factory: option metadata
# ─────────────────────────────────────────────────────────────────────────────

class TestRealFactoryOptions:

    def test_every_option_has_a_type(self, schema):
        untyped = [f"{b['factoryName']}.{o['name']}"
                   for b, o in every_option(schema) if o["type"] not in KNOWN_TYPES]
        assert not untyped, f"options with an unusable type: {untyped}"

    def test_generic_options_are_flagged(self, schema):
        seen = set()
        for b, o in every_option(schema):
            if o["name"] in GENERIC_OPTIONS:
                seen.add(o["name"])
                assert o["generic"] is True, f"{b['factoryName']}.{o['name']} not flagged generic"
            else:
                assert o["generic"] is False
        # declared by ConfigBlock's own constructor, so present on every block
        assert "skipOnData" in seen

    def test_expert_mode_is_picked_up(self, schema):
        expert = [f"{b['factoryName']}.{o['name']}"
                  for b, o in every_option(schema) if o["expertMode"] is not None]
        assert expert, "expected at least one expertMode-restricted option"

    def test_physical_units_are_picked_up(self, schema):
        # via AutogenDocumentation.interpret_physical_unit on the option's info
        mev = [f"{b['factoryName']}.{o['name']}"
               for b, o in every_option(schema) if o["physicalUnit"] == "MeV"]
        assert mev, "expected at least one option documented in [MeV]"

    def test_factory_level_defaults_are_merged(self, schema):
        # PtEtaSelection is registered in ConfigFactory.addDefaultAlgs with
        # `defaults={'selectionName': ''}`: the factory default must be reported
        # separately from — and override — the block's own default.  If
        # AnalysisBase changes that registration, adapt the expected value here,
        # do not delete the test.
        pteta = by_name(schema["blocks"], "PtEtaSelection")
        assert opt(pteta, "selectionName")["factoryDefault"] == ""
        assert opt(pteta, "selectionName")["default"] == ""

        # ... and the same must hold for every other `defaults=` in the factory.
        factory = make_factory()
        checked = 0
        for b in schema["blocks"]:
            fb = factory._algs[b["name"]]
            for key, value in (fb.defaults or {}).items():
                found = [o for o in b["options"] if o["name"] == key]
                if not found:
                    # A factory default may name something the block does not
                    # declare, in which case it has nowhere to land and never
                    # reaches the schema.  In AB 25.2.106 that is the case for
                    # Output and Thinning, both registered with
                    # `defaults={'configName': ...}` while neither block declares
                    # a `configName` option or constructor argument.
                    continue
                assert found[0]["factoryDefault"] == json_safe(value)
                assert found[0]["default"] == json_safe(value)
                checked += 1
        assert checked, "no factory-level default reached the schema"


# ─────────────────────────────────────────────────────────────────────────────
# Code paths no block shipped by AnalysisBase currently exercises
# ─────────────────────────────────────────────────────────────────────────────

class CtorArgTestBlock(ConfigBlock):
    """A block taking constructor arguments, filled from the factory defaults."""

    def __init__(self, containerName, postfix=''):
        super().__init__()
        self.setBlockName('CtorArgTestBlock')
        # a legacy-style block: the arguments are consumed by the constructor
        # itself rather than declared through addOption
        del containerName, postfix
        self.addOption('declaredOption', 'x', type=str, info='a declared option')


class TestConstructorOptions:
    """
    ``FactoryBlock.makeConfig`` fills constructor arguments from the factory
    ``defaults=``, and ``ConfigText`` accepts them as YAML keys (funcOpts), so
    the schema exposes them as options with ``origin == "__init__"``.  Every
    block AnalysisBase 25.2.106 registers has a zero-argument constructor, so
    this path is exercised with a scratch registration instead.
    """

    @pytest.fixture
    def block(self):
        factory = make_factory()
        factory.addAlgConfigBlock(algName="CtorArgTestBlock", alg=CtorArgTestBlock,
                                  defaults={'containerName': 'AnaJets'})
        fb = find_factory_block(factory, "CtorArgTestBlock")
        return block_from_factory(fb, factory)

    def test_declared_options_are_untouched(self, block):
        assert block["error"] is None
        o = opt(block, "declaredOption")
        assert o["origin"] == "CtorArgTestBlock" and o["default"] == "x"

    def test_constructor_argument_with_a_factory_default(self, block):
        o = opt(block, "containerName")
        assert o["origin"] == "__init__"
        assert o["default"] == "AnaJets"
        assert o["factoryDefault"] == "AnaJets"
        assert o["required"] is False

    def test_constructor_argument_with_a_signature_default(self, block):
        o = opt(block, "postfix")
        assert o["origin"] == "__init__"
        assert o["default"] == ""
        assert o["factoryDefault"] is None
        assert o["required"] is False


class BrokenTestBlock(ConfigBlock):
    """A block whose constructor fails — introspection must report, not crash."""

    def __init__(self):
        super().__init__()
        raise RuntimeError("boom")


class TestIntrospectionErrors:
    """
    No block shipped by AnalysisBase is broken (that is what
    ``test_every_block_introspects`` asserts), so the error path is exercised
    by registering a deliberately broken block in a scratch factory.
    """

    @pytest.fixture
    def factory_with_broken_block(self):
        factory = make_factory()
        factory.addAlgConfigBlock(algName="BrokenTestBlock", alg=BrokenTestBlock)
        return factory

    def test_block_from_factory_records_the_error(self, factory_with_broken_block):
        fb = find_factory_block(factory_with_broken_block, "BrokenTestBlock")
        block = block_from_factory(fb, factory_with_broken_block)
        assert block["error"] and "boom" in block["error"]
        assert block["options"] == []
        assert block["classes"] == []
        assert block["category"] == "Others"     # unknown to introspect.CATEGORIES
        assert block["kind"] == "class"

    def test_build_schema_survives_a_broken_block(self, factory_with_broken_block):
        schema = build_schema(factory_with_broken_block)
        broken = next((b for b in schema["blocks"] if b["name"] == "BrokenTestBlock"), None)
        assert broken is not None, "addAlgConfigBlock did not schedule the block at root level"
        assert "boom" in broken["error"]
        json.dumps(schema)
        # every other block still introspected fine
        assert [b["factoryName"] for b in schema["blocks"] if b["error"]] == ["BrokenTestBlock"]
