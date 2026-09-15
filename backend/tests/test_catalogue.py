# backend/tests/test_catalogue.py
#
# Harvesting AddConfigBlocks entries from reference configs and introspecting
# them against the real factory.  The custom blocks live in AnalysisTestBlocks,
# which stands in for a user's own analysis package (AnalysisBase has no
# TopCPToolkit) and uses nothing but the public ConfigBlock API.

import os

import catalogue
from catalogue import (
    build_catalogue, find_tct_data_dir, harvest_add_config_blocks, iter_config_files,
    list_examples, read_example,
)


def test_iter_config_files_only_yaml(tct_data_dir):
    files = [os.path.relpath(f, tct_data_dir / "configs") for f in iter_config_files(str(tct_data_dir))]
    assert files == ["a.yaml", "broken.yaml", os.path.join("sub", "b.yaml")]


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

    missing = by["Missing"]["block"]
    assert missing["error"] and "NoSuchModule" in missing["error"]
    assert missing["options"] == []


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


def test_examples(tct_data_dir):
    ex = list_examples(str(tct_data_dir))
    assert [e["path"] for e in ex] == ["a.yaml", "broken.yaml", os.path.join("sub", "b.yaml")]
    assert ex[2]["name"] == os.path.join("sub", "b")
    assert "tutorialOption: 5" in read_example(str(tct_data_dir), os.path.join("sub", "b.yaml"))
    assert read_example(str(tct_data_dir), "missing.yaml") is None
    assert read_example(str(tct_data_dir), "../notes.txt") is None
    assert read_example(None, "a.yaml") is None
