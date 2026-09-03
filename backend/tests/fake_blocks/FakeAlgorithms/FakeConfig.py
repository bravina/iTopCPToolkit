# Fake ConfigBlocks used by the backend tests.
#
# They depend only on the public ConfigBlock / groupBlocks API, so they import
# under BOTH the fake AnalysisAlgorithmsConfig package (CI) and the real one
# (inside the Docker image) — which lets the catalogue/introspect tests run
# unchanged in both environments.

from AnalysisAlgorithmsConfig.ConfigBlock import ConfigBlock
from AnalysisAlgorithmsConfig.ConfigSequence import groupBlocks


def _add(block, name, default, *, meta=None, **kw):
    """addOption with `meta`, tolerating releases where the kwarg does not exist yet."""
    try:
        block.addOption(name, default, meta=meta, **kw)
    except TypeError:
        block.addOption(name, default, **kw)
        if meta is not None:
            block._options[name].meta = meta


class CommonServicesFake(ConfigBlock):
    """Fake common services block."""

    def __init__(self):
        super().__init__()
        self.setBlockName('CommonServices')
        self.addOption('enableExpertMode', False, type=bool,
                       info='allows CP experts to use non-recommended configurations.')
        self.addOption('systematicsHistogram', '', type=str,
                       info='name of the systematics histogram', expertMode=True)
        self.addOption('runSystematics', True, type=bool, info='whether to run systematics')


class PreJetsFake(ConfigBlock):
    """Shared jet options."""

    def __init__(self):
        super().__init__()
        self.setBlockName('Jets')
        self.addOption('containerName', '', type=str, noneAction='error',
                       info='the name of the output container')
        self.addOption('jetCollection', '', type=str, info='the jet collection')


class SmallRJetsFake(ConfigBlock):
    """Small-R jet options."""

    def __init__(self):
        super().__init__()
        self.setBlockName('Jets')
        self.addOption('jetCollection', '', type=str, info='the jet collection')
        _add(self, 'systematicsModelJES', 'Category', type=str, info='the JES model',
             meta={'choices': ['All', 'Global', 'Category', 'Scenario1']})
        self.addOption('ptCuts', [], type=None, info='untyped list option')
        self.addOption('runJvtSelection', True, type=bool, info='run JVT')


class LargeRJetsFake(ConfigBlock):
    """Large-R jet options."""

    def __init__(self):
        super().__init__()
        self.setBlockName('Jets')
        self.addOption('jetCollection', '', type=str, info='the jet collection')
        self.addOption('minPt', 25000.0, type=float, info='minimum pT [MeV]')


@groupBlocks
def JetsFake(seq):
    seq.append(PreJetsFake())
    seq.append(SmallRJetsFake())
    seq.append(LargeRJetsFake())


class JvtFake(ConfigBlock):
    """Fake JVT block."""

    def __init__(self):
        super().__init__()
        self.setBlockName('JVT')
        self.addOption('containerName', '', type=str, info='inherited from parent')
        _add(self, 'selectionName', 'jvt', type=str, info='the selection name',
             meta={'role': 'selection'})


class PtEtaFake(ConfigBlock):
    """Fake pT/eta selection."""

    def __init__(self):
        super().__init__()
        self.setBlockName('PtEtaSelection')
        self.addOption('containerName', '', type=str, info='the container')
        self.addOption('selectionName', 'selectPtEta', type=str, info='the selection name')
        self.addOption('minPt', 0.0, type=float, info='minimum pT [MeV]')
        self.addOption('maxEta', 0.0, type=float, info='maximum |eta|')


class ElectronsFake(ConfigBlock):
    """Fake electron calibration."""

    def __init__(self):
        super().__init__()
        self.setBlockName('Electrons')
        self.addOption('containerName', '', type=str, noneAction='error', info='the container')
        self.addOption('forceFullSimConfig', False, type=bool, info='force full sim')


class ElectronWPFake(ConfigBlock):
    """Fake electron working point."""

    def __init__(self):
        super().__init__()
        self.setBlockName('WorkingPoint')
        self.addOption('selectionName', '', type=str, noneAction='error', info='the selection')
        _add(self, 'identificationWP', '', type=str, info='the ID WP',
             meta={'choices': ['LooseBLayer', 'Medium', 'Tight']})
        self.addOption('isolationWP', '', type=str, info='the isolation WP')


class EventSelectionFake(ConfigBlock):
    """Fake event selection."""

    def __init__(self):
        super().__init__()
        self.setBlockName('EventSelection')
        self.addOption('selectionName', '', type=str, noneAction='error', info='the name')
        _add(self, 'electrons', '', type=str, info='the electrons', meta={'role': 'containerRef'})
        _add(self, 'selectionCuts', '', type=str, noneAction='error', info='the cuts',
             meta={'multiline': True})


class EventSelectionMergerFake(ConfigBlock):
    """Fake merger with a dependency."""

    def __init__(self):
        super().__init__()
        self.setBlockName('EventSelectionMerger')
        self.addDependency('EventSelection', required=True)
        self.addOption('noFilter', False, type=bool, info='do not filter')


@groupBlocks
def EventSelectionFakeGroup(seq):
    seq.append(EventSelectionFake())
    seq.append(EventSelectionMergerFake())


class OutputFake(ConfigBlock):
    """Fake ntuple output."""

    def __init__(self):
        super().__init__()
        self.setBlockName('Output')
        self.addOption('configName', '', type=str, info='config name')
        self.addOption('treeName', 'analysis', type=str, info='the tree')
        self.addOption('vars', [], type=list, info='extra variables')
        self.addOption('metaConfig', {}, type=dict, info='metadata')


class LegacyFake(ConfigBlock):
    """Block with a constructor argument (accepted as a YAML key via funcOpts)."""

    def __init__(self, containerName):
        super().__init__()
        self.setBlockName('Legacy')
        self.containerName = containerName
        self.addOption('postfix', '', type=str, info='postfix')


class BrokenFake(ConfigBlock):
    """Block whose constructor fails — must surface as an error, not crash the schema."""

    def __init__(self):
        super().__init__()
        raise RuntimeError('boom')


# ── Custom blocks used through AddConfigBlocks in the catalogue tests ──────────

class TutorialConfig(ConfigBlock):
    """Tutorial block from HowToExtendTopCPToolkit."""

    def __init__(self):
        super().__init__()
        self.setBlockName('Tutorial')
        self.addOption('tutorialOption', 3, type=int, info='an integer option')


@groupBlocks
def TutorialGroup(seq):
    seq.append(TutorialConfig())
