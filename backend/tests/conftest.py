# backend/tests/conftest.py
#
# Test environment setup:
#   * backend/ on sys.path so `app`, `introspect`, `catalogue` import directly
#   * tests/userblocks/ on sys.path so `AnalysisTestBlocks.TestBlocksConfig`
#     — the stand-in for a user's own analysis package — is importable through
#     AddConfigBlocks
#
# The suite requires a live AnalysisBase environment.  The backend is nothing
# but a mirror of Athena's ConfigFactory, so testing it against anything other
# than the real thing would only prove that a replica matches itself.  If
# Athena is missing we fail here, at collection time, rather than degrading.

import os
import sys
import textwrap

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "userblocks"))

try:
    import AnalysisAlgorithmsConfig.ConfigFactory  # noqa: F401
except ImportError as exc:  # pragma: no cover - the message IS the behaviour
    raise RuntimeError(
        "\n"
        "AnalysisAlgorithmsConfig is not importable, so the backend test suite\n"
        "cannot run here.  These tests introspect the real Athena ConfigFactory;\n"
        "there is deliberately no stand-in for it.\n"
        "\n"
        "Run them inside an AnalysisBase image, with the release set up:\n"
        "\n"
        "    source /home/atlas/release_setup.sh\n"
        "    cd backend && pytest tests/ -v\n"
        "\n"
        f"(underlying import error: {exc})"
    ) from exc


@pytest.fixture
def tct_data_dir(tmp_path):
    """A stand-in <build>/data/TopCPToolkit tree with reference configs."""
    configs = tmp_path / "configs"
    (configs / "sub").mkdir(parents=True)
    (configs / "a.yaml").write_text(textwrap.dedent("""
        AddConfigBlocks:
          - modulePath: 'AnalysisTestBlocks.TestBlocksConfig'
            functionName: 'TutorialConfig'
            algName: 'Tutorial'
            pos: 'Output'
          - modulePath: 'NoSuchModule.Config'
            functionName: 'Missing'
            algName: 'Missing'
          - modulePath: 'AnalysisTestBlocks.TestBlocksConfig'
            functionName: 'TutorialGroup'
            algName: 'TutorialGroup'
            superBlocks: 'Jets'
          - algName: 'malformed'
        CommonServices:
          runSystematics: false
        """))
    (configs / "sub" / "b.yaml").write_text(textwrap.dedent("""
        AddConfigBlocks:
          Tutorial:
            modulePath: 'AnalysisTestBlocks.TestBlocksConfig'
            functionName: 'TutorialConfig'
            pos: 'Output'
        Tutorial:
          tutorialOption: 5
        """))
    (configs / "broken.yaml").write_text("AddConfigBlocks: [\n  - :::\n")
    (configs / "notes.txt").write_text("not a config\n")
    # A config directory shaped the way TopCPToolkit ships them: only the three
    # level files are examples, the fragment next to them is not.
    ci = configs / "CI_test_00"
    ci.mkdir()
    (ci / "reco.yaml").write_text(textwrap.dedent("""
        CommonServices:
          runSystematics: false
        """))
    (ci / "fragment.yaml").write_text("CommonServices:\n  systematicsHistogram: 'h'\n")
    return tmp_path


@pytest.fixture
def examples_dir(tmp_path, monkeypatch):
    """
    A stand-in TopCPToolkit_Examples checkout:
    ``Analysis/<group>/<config>/{reco,particle,parton}.yaml``.

    Four configs, covering what the collector has to tell apart: one that
    resolves an `include` and configures, one stale through an unknown block,
    one stale through an option no block uses, and one whose fragment is gone.
    """
    root = tmp_path / "TopCPToolkit_Examples"
    grp = root / "Analysis" / "GRP"

    good = grp / "Good_example1"
    good.mkdir(parents=True)
    # The fragment sets both options; the local value of runSystematics wins.
    (good / "reco.yaml").write_text(textwrap.dedent("""
        include:
          - Good_example1/fragment.yaml
        CommonServices:
          runSystematics: false
        """))
    (good / "fragment.yaml").write_text(textwrap.dedent("""
        CommonServices:
          runSystematics: true
          systematicsHistogram: 'systematics'
        """))
    (good / "particle.yaml").write_text("# a comment worth keeping\nCommonServices:\n  runSystematics: false\n")
    (good / "version.txt").write_text("v3.7.0\n")

    stale_block = grp / "StaleBlock_example1"
    stale_block.mkdir(parents=True)
    (stale_block / "reco.yaml").write_text("NoSuchBlockHere:\n  someOption: 1\n")

    stale_option = grp / "StaleOption_example1"
    stale_option.mkdir(parents=True)
    (stale_option / "reco.yaml").write_text("CommonServices:\n  noSuchOptionHere: 1\n")

    broken = grp / "BrokenInclude_example1"
    broken.mkdir(parents=True)
    (broken / "reco.yaml").write_text("include:\n  - BrokenInclude_example1/gone.yaml\n")

    monkeypatch.setenv("TCT_EXAMPLES_DIR", str(root))
    return root
