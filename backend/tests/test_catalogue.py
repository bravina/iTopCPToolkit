# backend/tests/test_catalogue.py
#
# Harvesting AddConfigBlocks entries from reference configs and introspecting
# them against the real factory, and collecting the example configs of both
# sources (the TopCPToolkit build and a TopCPToolkit_Examples checkout).  The
# custom blocks live in AnalysisTestBlocks, which stands in for a user's own
# analysis package (AnalysisBase has no TopCPToolkit) and uses nothing but the
# public ConfigBlock API.

import copy
import os

import pytest
import yaml

import catalogue
from catalogue import (
    build_catalogue, config_is_loadable, example_sources, find_examples_dir,
    find_tct_data_dir, harvest_add_config_blocks, iter_config_files, iter_example_files,
    list_examples, read_example, resolve_includes,
)


def test_iter_config_files_only_yaml(tct_data_dir):
    files = [os.path.relpath(f, tct_data_dir / "configs") for f in iter_config_files(str(tct_data_dir))]
    # sorted by full path, so a directory sorts by its name: "CI_test_00" before
    # "a.yaml" (uppercase first), and notes.txt is not a config at all
    assert files == [os.path.join("CI_test_00", "fragment.yaml"),
                     os.path.join("CI_test_00", "reco.yaml"),
                     "a.yaml", "broken.yaml",
                     os.path.join("sub", "b.yaml")]


def test_harvest_dedupes_and_records_usage(tct_data_dir):
    entries = harvest_add_config_blocks(iter_config_files(str(tct_data_dir)), str(tct_data_dir))
    assert [e["algName"] for e in entries] == ["Missing", "Tutorial", "TutorialGroup"]
    tutorial = entries[1]
    assert tutorial["modulePath"] == "AnalysisTestBlocks.TestBlocksConfig"
    assert tutorial["functionName"] == "TutorialConfig"
    assert tutorial["pos"] == "Output"
    assert tutorial["superBlocks"] is None
    assert tutorial["usedIn"] == ["a.yaml", os.path.join("sub", "b.yaml")]
    assert entries[2]["superBlocks"] == "Jets"


def test_build_catalogue_introspects_entries(tct_data_dir):
    entries = build_catalogue(str(tct_data_dir))
    by = {e["algName"]: e for e in entries}

    tut = by["Tutorial"]["block"]
    assert tut["error"] is None
    assert tut["category"] == "TopCPToolkit"
    assert tut["kind"] == "class"
    o = next(o for o in tut["options"] if o["name"] == "tutorialOption")
    assert o["type"] == "int" and o["default"] == 3
    assert o["meta"] is None

    grp = by["TutorialGroup"]["block"]
    assert grp["kind"] == "group"
    assert grp["factoryName"] == "Jets.TutorialGroup"
    assert grp["category"] == "TopCPToolkit"

    # The NoSuchModule entry of the fixture is not offered at all.
    assert "Missing" not in by


def test_unimportable_blocks_are_dropped(tct_data_dir, examples_dir):
    """A block whose module this build lacks is not offered."""
    (examples_dir / "Analysis" / "GRP" / "Good_example1" / "reco.yaml").write_text(
        "AddConfigBlocks:\n"
        "  - modulePath: 'NotInThisRelease.SomeConfig'\n"
        "    functionName: 'SomeConfig'\n"
        "    algName: 'FromTheFuture'\n"
    )
    by = {e["algName"]: e for e in build_catalogue(str(tct_data_dir))}
    assert "FromTheFuture" not in by
    assert "Tutorial" in by, "dropping one entry must not disturb the others"


def test_a_module_whose_own_import_fails_is_dropped_too(tct_data_dir, examples_dir):
    """The module is present, but it imports something this build lacks."""
    (examples_dir / "Analysis" / "GRP" / "Good_example1" / "reco.yaml").write_text(
        "AddConfigBlocks:\n"
        "  - modulePath: 'AnalysisTestBlocks.BrokenImportConfig'\n"
        "    functionName: 'BrokenImportConfig'\n"
        "    algName: 'BrokenImport'\n"
    )
    by = {e["algName"]: e for e in build_catalogue(str(tct_data_dir))}
    assert "BrokenImport" not in by


def test_other_introspection_failures_are_still_listed(tct_data_dir, examples_dir):
    """Only a missing module is silent: a real block that breaks stays visible."""
    (examples_dir / "Analysis" / "GRP" / "Good_example1" / "reco.yaml").write_text(
        "AddConfigBlocks:\n"
        "  - modulePath: 'AnalysisTestBlocks.TestBlocksConfig'\n"
        "    functionName: 'NoSuchFunction'\n"
        "    algName: 'Broken'\n"
    )
    by = {e["algName"]: e for e in build_catalogue(str(tct_data_dir))}
    assert "Broken" in by, "an importable module that fails is the user's to see"
    assert by["Broken"]["block"]["error"]
    assert by["Broken"]["block"]["missingModule"] is False


def test_introspect_entry_still_reports_a_missing_module(tct_data_dir):
    """The /introspect path must not go silent: the user's own config needs the error."""
    block = catalogue.introspect_entry({
        "modulePath": "NotInThisRelease.SomeConfig",
        "functionName": "SomeConfig",
        "algName": "FromTheFuture",
    })
    assert "NotInThisRelease" in block["error"]
    assert block["missingModule"] is True


def test_meta_annotations_reach_the_schema(tct_data_dir):
    tut = {e["algName"]: e for e in build_catalogue(str(tct_data_dir))}["Tutorial"]["block"]
    by_opt = {o["name"]: o for o in tut["options"]}
    assert by_opt["containerName"]["meta"] == {"role": "container"}
    # The upstream (list, cap) tuple is split into choices + maxChoices.
    assert by_opt["workingPoint"]["meta"] == {
        "choices": ["Loose", "Medium", "Tight"], "maxChoices": 1}


def test_build_catalogue_without_tct():
    assert build_catalogue(None) == []


def test_find_tct_data_dir_env_override(tct_data_dir, monkeypatch):
    monkeypatch.setenv("TCT_DATA_DIR", str(tct_data_dir))
    assert find_tct_data_dir() == str(tct_data_dir)
    monkeypatch.setenv("TCT_DATA_DIR", str(tct_data_dir / "nowhere"))
    monkeypatch.setattr(catalogue, "TCT_DATA_GLOB", str(tct_data_dir / "no-such-*"))
    assert find_tct_data_dir() is None


def test_examples_of_the_tct_build(tct_data_dir, monkeypatch, tmp_path):
    monkeypatch.setenv("TCT_EXAMPLES_DIR", str(tmp_path / "no-examples-checkout"))
    ex = list_examples(str(tct_data_dir))
    # a.yaml / sub/b.yaml are configs, but not reco/particle/parton ones
    assert [e["path"] for e in ex] == ["TopCPToolkit/CI_test_00/reco.yaml"]
    assert ex[0]["name"] == "CI_test_00/reco"
    assert "runSystematics" in read_example(str(tct_data_dir), "TopCPToolkit/CI_test_00/reco.yaml")
    assert read_example(str(tct_data_dir), "TopCPToolkit/missing.yaml") is None
    assert read_example(str(tct_data_dir), "TopCPToolkit/../notes.txt") is None
    assert read_example(None, "TopCPToolkit/CI_test_00/reco.yaml") is None


# ─────────────────────────────────────────────────────────────────────────────
# Example configs: sources, `include` resolution, staleness
# ─────────────────────────────────────────────────────────────────────────────

def test_sources_are_tct_then_examples(tct_data_dir, examples_dir):
    sources = example_sources(str(tct_data_dir))
    assert [s.name for s in sources] == ["TopCPToolkit", "Examples"]
    assert sources[1].root == str(examples_dir / "Analysis")
    assert find_examples_dir() == str(examples_dir / "Analysis")


def test_no_examples_checkout_is_not_an_error(tct_data_dir, monkeypatch, tmp_path):
    monkeypatch.setenv("TCT_EXAMPLES_DIR", str(tmp_path / "nowhere"))
    assert find_examples_dir() is None
    assert [s.name for s in example_sources(str(tct_data_dir))] == ["TopCPToolkit"]
    assert example_sources(None) == []


def test_only_level_files_are_examples(examples_dir):
    source = example_sources(None)[0]
    names = sorted(os.path.basename(f) for f in iter_example_files(source))
    # fragment.yaml and version.txt sit next to them but are not configs
    assert names == ["particle.yaml", "reco.yaml", "reco.yaml", "reco.yaml", "reco.yaml"]


def test_resolve_includes_merges_with_local_winning(examples_dir):
    path = str(examples_dir / "Analysis" / "GRP" / "Good_example1" / "reco.yaml")
    config, merged = resolve_includes(path)
    assert merged is True
    assert "include" not in config
    # local value wins, the fragment fills in what the config does not set
    assert config["CommonServices"]["runSystematics"] is False
    assert config["CommonServices"]["systematicsHistogram"] == "systematics"


def test_resolve_includes_reports_a_missing_fragment(examples_dir):
    path = str(examples_dir / "Analysis" / "GRP" / "BrokenInclude_example1" / "reco.yaml")
    with pytest.raises(FileNotFoundError):
        resolve_includes(path)


def test_a_scalar_include_still_merges_and_stays_quiet(examples_dir, recwarn):
    """
    Athena warns that `include:` should be a list, and can merge it anyway.
    The config belongs to the examples repository, so the warning must not
    reach the root logger on every startup.
    """
    good = examples_dir / "Analysis" / "GRP" / "Good_example1"
    (good / "reco.yaml").write_text(
        "include: Good_example1/fragment.yaml\n"
        "CommonServices:\n"
        "  runSystematics: false\n"
    )
    config, merged = resolve_includes(str(good / "reco.yaml"))
    assert merged, "the fragment is still merged"
    assert config["CommonServices"]["systematicsHistogram"] == "systematics"
    assert config["CommonServices"]["runSystematics"] is False, "the local value still wins"
    assert list(recwarn) == [], "Athena's warning must not escape"


def test_a_warning_does_not_hide_a_real_failure(examples_dir):
    """Capturing warnings must not swallow the exception a stale include raises."""
    broken = examples_dir / "Analysis" / "GRP" / "BrokenInclude_example1" / "reco.yaml"
    broken.write_text("include: BrokenInclude_example1/gone.yaml\n")
    with pytest.raises(Exception):
        resolve_includes(str(broken))


def test_config_is_loadable_against_the_real_factory():
    ok, reason = config_is_loadable({"CommonServices": {"runSystematics": False}})
    assert ok and reason == ""

    ok, reason = config_is_loadable({"NoSuchBlockHere": {"someOption": 1}})
    assert not ok and "NoSuchBlockHere" in reason

    ok, reason = config_is_loadable({"CommonServices": {"noSuchOptionHere": 1}})
    assert not ok and "noSuchOptionHere" in reason


def test_config_is_loadable_does_not_consume_the_config():
    config = {"Jets": [{"containerName": "AnaJets", "PtEtaSelection": {"minPt": 25000}}]}
    before = copy.deepcopy(config)
    config_is_loadable(config)
    assert config == before


def test_list_examples_keeps_the_usable_ones_only(tct_data_dir, examples_dir):
    entries = list_examples(str(tct_data_dir))
    paths = [e["path"] for e in entries]
    # stale and unresolvable configs are dropped, silently
    assert paths == [
        "TopCPToolkit/CI_test_00/reco.yaml",
        "Examples/GRP/Good_example1/particle.yaml",
        "Examples/GRP/Good_example1/reco.yaml",
    ]
    assert [e["source"] for e in entries] == ["TopCPToolkit", "Examples", "Examples"]
    by_path = {e["path"]: e for e in entries}
    assert by_path["Examples/GRP/Good_example1/reco.yaml"]["merged"] is True
    assert by_path["Examples/GRP/Good_example1/reco.yaml"]["name"] == "GRP/Good_example1/reco"
    assert by_path["Examples/GRP/Good_example1/particle.yaml"]["merged"] is False


def test_read_example_returns_a_config_with_no_includes_left(tct_data_dir, examples_dir):
    text = read_example(str(tct_data_dir), "Examples/GRP/Good_example1/reco.yaml")
    doc = yaml.safe_load(text)
    assert "include" not in text and "include" not in doc
    assert doc["CommonServices"] == {"runSystematics": False, "systematicsHistogram": "systematics"}


def test_read_example_leaves_an_unmerged_config_verbatim(tct_data_dir, examples_dir):
    text = read_example(str(tct_data_dir), "Examples/GRP/Good_example1/particle.yaml")
    assert text.startswith("# a comment worth keeping")


def test_read_example_rejects_anything_else(tct_data_dir, examples_dir):
    for path in [
        "Examples/GRP/Good_example1/fragment.yaml",   # a fragment is not an example
        "Examples/GRP/Good_example1/version.txt",     # not a config at all
        "Examples/GRP/../../../etc/passwd",           # traversal
        "Examples/GRP/Nope_example1/reco.yaml",       # unknown
        "NoSuchSource/reco.yaml",                     # unknown source
        "GRP/Good_example1/reco.yaml",                # unprefixed
        "",
    ]:
        assert read_example(str(tct_data_dir), path) is None


def test_catalogue_harvests_from_both_sources(tct_data_dir, examples_dir):
    (examples_dir / "Analysis" / "GRP" / "Good_example1" / "reco.yaml").write_text(
        "AddConfigBlocks:\n"
        "  - modulePath: 'AnalysisTestBlocks.TestBlocksConfig'\n"
        "    functionName: 'TutorialConfig'\n"
        "    algName: 'FromExamples'\n"
        "    pos: 'Output'\n"
    )
    entries = build_catalogue(str(tct_data_dir))
    by = {e["algName"]: e for e in entries}
    assert "FromExamples" in by, "examples repository is not harvested"
    assert by["FromExamples"]["usedIn"] == ["Examples/GRP/Good_example1/reco.yaml"]
    # the TCT configs are still harvested, and now carry their source prefix
    assert by["Tutorial"]["usedIn"] == ["TopCPToolkit/a.yaml", "TopCPToolkit/sub/b.yaml"]
