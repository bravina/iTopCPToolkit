# backend/tests/conftest.py
#
# Test environment setup:
#   * backend/ on sys.path so `app`, `introspect`, `catalogue` import directly
#   * tests/fake_blocks/ always on sys.path (FakeAlgorithms works with both the
#     real and the fake AnalysisAlgorithmsConfig)
#   * tests/fake_athena/ on sys.path ONLY when the real Athena package is not
#     importable, so the same test-suite runs on a plain runner and inside the
#     Docker image (where HAVE_ATHENA is True and real-factory tests run).

import os
import sys
import textwrap

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, os.path.join(HERE, "fake_blocks"))

try:
    import AnalysisAlgorithmsConfig.ConfigFactory  # noqa: F401
    HAVE_ATHENA = True
except ImportError:
    sys.path.insert(0, os.path.join(HERE, "fake_athena"))
    HAVE_ATHENA = False


@pytest.fixture
def tct_data_dir(tmp_path):
    """A fake <build>/data/TopCPToolkit tree with reference configs."""
    configs = tmp_path / "configs"
    (configs / "sub").mkdir(parents=True)
    (configs / "a.yaml").write_text(textwrap.dedent("""
        AddConfigBlocks:
          - modulePath: 'FakeAlgorithms.FakeConfig'
            functionName: 'TutorialConfig'
            algName: 'Tutorial'
            pos: 'Output'
          - modulePath: 'NoSuchModule.Config'
            functionName: 'Missing'
            algName: 'Missing'
          - modulePath: 'FakeAlgorithms.FakeConfig'
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
            modulePath: 'FakeAlgorithms.FakeConfig'
            functionName: 'TutorialConfig'
            pos: 'Output'
        Tutorial:
          tutorialOption: 5
        """))
    (configs / "broken.yaml").write_text("AddConfigBlocks: [\n  - :::\n")
    (configs / "notes.txt").write_text("not a config\n")
    return tmp_path
