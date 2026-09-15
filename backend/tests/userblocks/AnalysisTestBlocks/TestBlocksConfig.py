# A stand-in for a *user's own analysis package* — NOT a stand-in for Athena.
#
# `AddConfigBlocks` entries point at a module outside AnalysisAlgorithmsConfig
# (in production: TopCPToolkit, or a user's own package).  The test suite runs
# in a plain AnalysisBase image, which has the real Athena but no TopCPToolkit,
# so the catalogue / introspection tests need *some* importable module playing
# that role.  This is it.  It uses nothing but the public ConfigBlock and
# groupBlocks API, exactly like the tutorial in HowToExtendTopCPToolkit.

from AnalysisAlgorithmsConfig.ConfigBlock import ConfigBlock
from AnalysisAlgorithmsConfig.ConfigSequence import groupBlocks


class TutorialConfig(ConfigBlock):
    """Tutorial block from HowToExtendTopCPToolkit."""

    def __init__(self):
        super().__init__()
        self.setBlockName('Tutorial')
        self.addOption('tutorialOption', 3, type=int, info='an integer option')
        self.addOption('containerName', '', type=str, info='the name of the output container',
                       meta={'role': 'container'})
        # Upstream wants choices as a (list[str], cap) tuple, cap None = no limit.
        self.addOption('workingPoint', 'Medium', type=str, info='the working point',
                       meta={'choices': (['Loose', 'Medium', 'Tight'], 1)})


@groupBlocks
def TutorialGroup(seq):
    seq.append(TutorialConfig())
