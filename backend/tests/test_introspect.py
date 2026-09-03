# backend/tests/test_introspect.py
#
# Tests for the factory walk.  Against the fake factory (CI) the expectations
# are exact; against the real factory (inside the Docker image) only invariants
# are checked — no hardcoded list of Athena blocks anywhere.

import pytest
from conftest import HAVE_ATHENA

import introspect
from introspect import (
    CATEGORY_ORDER, build_schema, json_safe, label_for, make_factory, type_name,
)

fake_only = pytest.mark.skipif(HAVE_ATHENA, reason="expectations tied to the fake factory")
real_only = pytest.mark.skipif(not HAVE_ATHENA, reason="needs a live Athena environment")


def by_name(blocks, name):
    return next(b for b in blocks if b["name"] == name)


def opt(block, name):
    return next(o for o in block["options"] if o["name"] == name)


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
# Fake factory: exact expectations
# ─────────────────────────────────────────────────────────────────────────────

@fake_only
class TestFakeFactory:

    def test_root_order_and_hidden_blocks(self, schema):
        names = [b["name"] for b in schema["blocks"]]
        assert names == ["CommonServices", "Jets", "Electrons", "PtEtaSelection",
                         "EventSelection", "Output", "Legacy", "Broken"]
        assert schema["categories"] == CATEGORY_ORDER

    def test_class_block(self, schema):
        cs = by_name(schema["blocks"], "CommonServices")
        assert cs["kind"] == "class"
        assert cs["factoryName"] == "CommonServices"
        assert cs["category"] == "Core"
        assert cs["classes"] == [{"module": "FakeAlgorithms.FakeConfig",
                                  "cls": "CommonServicesFake",
                                  "docstring": "Fake common services block."}]
        o = opt(cs, "enableExpertMode")
        assert o["type"] == "bool" and o["default"] is False and o["generic"] is False
        assert o["info"].startswith("allows CP experts")
        assert opt(cs, "systematicsHistogram")["expertMode"] == [True]
        assert opt(cs, "runSystematics")["expertMode"] is None
        assert opt(cs, "skipOnData")["generic"] is True
        assert opt(cs, "propertyOverrides")["generic"] is True
        assert opt(cs, "propertyOverrides")["expertMode"] == [True]
        assert cs["error"] is None

    def test_group_block_unions_options(self, schema):
        jets = by_name(schema["blocks"], "Jets")
        assert jets["kind"] == "group"
        assert [c["cls"] for c in jets["classes"]] == ["PreJetsFake", "SmallRJetsFake", "LargeRJetsFake"]
        names = [o["name"] for o in jets["options"]]
        assert names.count("jetCollection") == 1  # duplicates merged
        assert {"containerName", "jetCollection", "ptCuts", "minPt", "runJvtSelection"} <= set(names)
        assert opt(jets, "jetCollection")["origin"] == "PreJetsFake"  # first class wins
        assert opt(jets, "minPt")["origin"] == "LargeRJetsFake"
        assert opt(jets, "containerName")["noneAction"] == "error"

    def test_type_inferred_from_default_and_units(self, schema):
        jets = by_name(schema["blocks"], "Jets")
        assert opt(jets, "ptCuts")["type"] == "list"
        assert opt(jets, "minPt")["physicalUnit"] == "MeV"
        assert opt(jets, "jetCollection")["physicalUnit"] is None
        out = by_name(schema["blocks"], "Output")
        assert opt(out, "vars")["type"] == "list"
        assert opt(out, "metaConfig")["type"] == "dict"

    def test_meta_passthrough(self, schema):
        jets = by_name(schema["blocks"], "Jets")
        assert opt(jets, "systematicsModelJES")["meta"] == {
            "choices": ["All", "Global", "Category", "Scenario1"]}
        assert opt(jets, "jetCollection")["meta"] is None
        wp = by_name(by_name(schema["blocks"], "Electrons")["subBlocks"], "WorkingPoint")
        assert opt(wp, "identificationWP")["meta"]["choices"] == ["LooseBLayer", "Medium", "Tight"]

    def test_sub_blocks_and_factory_defaults(self, schema):
        jets = by_name(schema["blocks"], "Jets")
        assert [s["name"] for s in jets["subBlocks"]] == ["JVT", "PtEtaSelection"]
        jvt = by_name(jets["subBlocks"], "JVT")
        assert jvt["factoryName"] == "Jets.JVT"
        assert jvt["category"] is None
        assert jvt["parents"] == ["Jets"]
        assert opt(jvt, "selectionName")["meta"] == {"role": "selection"}

        pteta = by_name(jets["subBlocks"], "PtEtaSelection")
        assert pteta["parents"] == ["Jets", "Electrons"]
        assert opt(pteta, "selectionName")["default"] == ""
        assert opt(pteta, "selectionName")["factoryDefault"] == ""
        assert opt(pteta, "minPt")["factoryDefault"] is None

        root_pteta = by_name(schema["blocks"], "PtEtaSelection")
        assert root_pteta["category"] == "Objects"
        assert root_pteta["parents"] == []
        assert opt(root_pteta, "selectionName")["default"] == ""

    def test_dependencies(self, schema):
        es = by_name(schema["blocks"], "EventSelection")
        assert es["kind"] == "group"
        assert es["dependencies"] == [{"blockName": "EventSelection", "required": True}]
        assert opt(es, "ignoreDependencies")["generic"] is True
        assert opt(es, "selectionCuts")["meta"] == {"multiline": True}
        assert opt(es, "electrons")["meta"] == {"role": "containerRef"}

    def test_constructor_arguments_are_options(self, schema):
        legacy = by_name(schema["blocks"], "Legacy")
        assert legacy["error"] is None
        o = opt(legacy, "containerName")
        assert o["origin"] == "__init__"
        assert o["default"] == "AnaLegacy" and o["factoryDefault"] == "AnaLegacy"
        assert o["required"] is False
        out = by_name(schema["blocks"], "Output")
        assert opt(out, "configName")["factoryDefault"] == "Output"
        assert opt(out, "configName")["default"] == "Output"
        assert opt(out, "treeName")["factoryDefault"] is None

    def test_broken_block_is_reported_not_fatal(self, schema):
        broken = by_name(schema["blocks"], "Broken")
        assert "boom" in broken["error"]
        assert broken["options"] == [] and broken["classes"] == []
        assert broken["category"] == "Others"

    def test_schema_is_json_serialisable(self, schema):
        import json
        json.dumps(schema)


# ─────────────────────────────────────────────────────────────────────────────
# Real factory: invariants only (runs inside the Docker image)
# ─────────────────────────────────────────────────────────────────────────────

@real_only
class TestRealFactory:

    def test_every_block_introspects(self, schema):
        errors = [b["factoryName"] for b in schema["blocks"] if b["error"]]
        errors += [s["factoryName"] for b in schema["blocks"] for s in b["subBlocks"] if s["error"]]
        assert not errors, f"Blocks failing introspection: {errors}"

    def test_every_block_has_options(self, schema):
        for b in schema["blocks"]:
            assert b["options"], f"{b['factoryName']} has no options"
            for s in b["subBlocks"]:
                assert s["options"], f"{s['factoryName']} has no options"

    def test_grouped_blocks_have_several_classes(self, schema):
        groups = [b for b in schema["blocks"] if b["kind"] == "group"]
        assert groups, "expected at least one @groupBlocks entry (e.g. Jets)"
        assert any(len(b["classes"]) > 1 for b in groups)

    def test_add_config_blocks_hidden(self, schema):
        assert "AddConfigBlocks" not in [b["name"] for b in schema["blocks"]]
        assert "AddConfigBlocks" in make_factory()._algs

    def test_schema_is_json_serialisable(self, schema):
        import json
        json.dumps(schema)
