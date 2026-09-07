# A stand-in for a *user's own analysis package* — NOT a stand-in for Athena.
#
# `AddConfigBlocks` entries point at a module outside AnalysisAlgorithmsConfig
# (in production: TopCPToolkit, or a user's own package).  The test suite runs
# in a plain AnalysisBase image, which has the real Athena but no TopCPToolkit,
# so the catalogue / introspection tests need *some* importable module playing
# that role.  This is it.  It uses nothing but the public ConfigBlock and
# groupBlocks API, exactly like the tutorial in HowToExtendTopCPToolkit.

import inspect

from AnalysisAlgorithmsConfig.ConfigBlock import ConfigBlock
from AnalysisAlgorithmsConfig.ConfigSequence import groupBlocks


def _supports_meta() -> bool:
    """True when this release's ``ConfigBlock.addOption`` accepts ``meta=``."""
    try:
        return "meta" in inspect.signature(ConfigBlock.addOption).parameters
    except (TypeError, ValueError):  # pragma: no cover - exotic release
        return False


#: Whether ``addOption(..., meta=...)`` exists in the release under test.
#: AnalysisBase 25.2.106 does NOT have it yet (the upstream MR is pending), so
#: tests that assert on `meta` passthrough skip on this.
SUPPORTS_META = _supports_meta()


def _add(block, name, default, *, meta=None, **kw):
    """
    ``addOption`` with ``meta``, on releases that have it.  Where the kwarg does
    not exist yet the option is declared without it and introspection reports
    ``meta: None`` — the same thing a real user block would produce on that
    release, which is what the meta tests skip on.
    """
    if meta is not None and SUPPORTS_META:
        block.addOption(name, default, meta=meta, **kw)
    else:
        block.addOption(name, default, **kw)


class TutorialConfig(ConfigBlock):
    """Tutorial block from HowToExtendTopCPToolkit."""

    def __init__(self):
        super().__init__()
        self.setBlockName('Tutorial')
        self.addOption('tutorialOption', 3, type=int, info='an integer option')
        _add(self, 'containerName', '', type=str, info='the name of the output container',
             meta={'role': 'container'})
        _add(self, 'workingPoint', 'Medium', type=str, info='the working point',
             meta={'choices': ['Loose', 'Medium', 'Tight']})


@groupBlocks
def TutorialGroup(seq):
    seq.append(TutorialConfig())
