# Stand-in for AnalysisAlgorithmsConfig.ConfigText.TextConfig — only the
# AddConfigBlocks registration path is reproduced.
import importlib

from AnalysisAlgorithmsConfig.ConfigFactory import ConfigFactory


class TextConfig(ConfigFactory):
    def __init__(self, yamlPath=None, *, config=None, addDefaultBlocks=True):
        super().__init__(addDefaultBlocks=False)
        self.addAlgConfigBlock(algName="AddConfigBlocks", alg=self._addNewConfigBlocks,
                               defaults={'self': self})
        if addDefaultBlocks:
            self.addDefaultAlgs()
        self._config = {}

    def _addNewConfigBlocks(self, modulePath, functionName, algName,
                            defaults=None, pos=None, superBlocks=None):
        try:
            module = importlib.import_module(modulePath)
            fxn = getattr(module, functionName)
        except ModuleNotFoundError as e:
            raise ModuleNotFoundError(f"{e}\nFailed to load {functionName} from {modulePath}")
        self.addAlgConfigBlock(algName=algName, alg=fxn, defaults=defaults,
                               superBlocks=superBlocks, pos=pos)
