# Minimal stand-in for AnalysisAlgorithmsConfig.ConfigBlock (athena/main, Sep 2026).
# Only the API surface used by introspect.py and by the fake blocks is reproduced.


class ConfigBlockOption:
    """the information for a single option on a configuration block"""

    def __init__(self, type=None, info='', noneAction='ignore', required=False,
                 default=None, meta=None):
        self.type = type
        self.info = info
        self.required = required
        self.noneAction = noneAction
        self.default = default
        self.meta = meta


class ConfigBlockDependency:
    def __init__(self, blockName, required=True):
        self.blockName = blockName
        self.required = required


class ConfigBlock:
    """Base class for configuration blocks (fake)."""

    def __init__(self):
        self._blockName = ''
        self._factoryName = None
        self._dependencies = []
        self._options = {}
        self._expertModeSettings = {}
        self.addOption('groupName', '', type=str,
            info='Used to specify this block when setting an option at an arbitrary location.')
        self.addOption('skipOnData', False, type=bool,
            info='User option to prevent the block from running on data.')
        self.addOption('skipOnMC', False, type=bool,
            info='User option to prevent the block from running on MC.')
        self.addOption('skipWithSystematics', False, type=bool,
            info='User option to prevent the block from running with systematics.')
        self.addOption('onlyForDSIDs', [], type=list,
            info='Used to specify which MC DSIDs to allow this block to run on.')
        self.addOption('propertyOverrides', {}, type=dict,
            info='EXPERT USE ONLY: A dictionary of properties to override.',
            expertMode=True)

    def setBlockName(self, name):
        self._blockName = name

    def getBlockName(self):
        return self._blockName

    def factoryName(self):
        return self._factoryName or self._blockName or self.__class__.__name__

    def setFactoryName(self, name):
        self._factoryName = name

    def addOption(self, name, defaultValue, *, type, info='', noneAction='ignore',
                  required=False, expertMode=None, meta=None):
        if name in self._options:
            raise KeyError(f'duplicate option: {name}')
        if type not in [str, bool, int, float, list, dict, None]:
            raise TypeError(f'unknown option type: {type}')
        if noneAction not in ['error', 'set', 'ignore']:
            raise ValueError(f'invalid noneAction: {noneAction}')
        if expertMode is not None:
            if expertMode is True:
                self._expertModeSettings[name] = True
            elif not isinstance(expertMode, list):
                raise TypeError('expertMode must be a list')
            else:
                self._expertModeSettings[name] = expertMode
        setattr(self, name, defaultValue)
        self._options[name] = ConfigBlockOption(type=type, info=info, noneAction=noneAction,
                                                required=required, default=defaultValue, meta=meta)

    def setOptionValue(self, name, value, **kwargs):
        if name not in self._options:
            raise KeyError(f'unknown option: {name}')
        setattr(self, name, value)

    def getOptionValue(self, name):
        return getattr(self, name)

    def getOptions(self):
        return self._options.copy()

    def hasOption(self, name):
        return name in self._options

    def addDependency(self, dependencyName, required=True):
        if not self.hasDependencies():
            self.addOption('ignoreDependencies', [], type=list,
                           info='List of dependencies defined in the ConfigBlock to ignore.')
        self._dependencies.append(ConfigBlockDependency(dependencyName, required))

    def hasDependencies(self):
        return bool(self._dependencies)

    def getDependencies(self):
        return self._dependencies

    def makeAlgs(self, config):
        pass
