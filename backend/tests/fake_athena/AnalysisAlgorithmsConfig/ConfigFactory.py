# Stand-in for AnalysisAlgorithmsConfig.ConfigFactory.  The registration
# logic (FactoryBlock / addAlgConfigBlock / _algs / _order) is copied from the
# real implementation so introspect.py exercises the same data structures;
# addDefaultAlgs registers the fake blocks from FakeAlgorithms.FakeConfig.
import inspect


def getDefaultArgs(func):
    signature = inspect.signature(func)
    return {k: v.default for k, v in signature.parameters.items()
            if v.default is not inspect.Parameter.empty}


def getFuncArgs(func):
    if inspect.isclass(func):
        args = list(inspect.signature(func.__init__).parameters.keys())
        args.remove('self')
    else:
        args = list(inspect.signature(func).parameters.keys())
    return args


class FactoryBlock():
    def __init__(self, alg, factoryName, algName, options, defaults, subAlgs=None):
        self.alg = alg
        self.factoryName = factoryName
        self.algName = algName
        self.options = options
        self.defaults = defaults
        self.subAlgs = {} if subAlgs is None else subAlgs


class ConfigFactory():
    def __init__(self, addDefaultBlocks=True):
        self.ROOTNAME = 'root'
        self._algs = {}
        self._order = {self.ROOTNAME: []}
        if addDefaultBlocks:
            self.addDefaultAlgs()

    def addAlgConfigBlock(self, algName, alg, defaults=None, pos=None, superBlocks=None):
        if not callable(alg):
            raise ValueError(f"{algName} is not a callable.")
        opts = getFuncArgs(alg)
        if superBlocks is None:
            superBlocks = [self.ROOTNAME]
        elif not isinstance(superBlocks, list):
            superBlocks = [superBlocks]
        for block in superBlocks:
            if block not in self._order:
                self._order[block] = []
            order = self._order[block]
            if block == self.ROOTNAME:
                algs = self._algs
            else:
                if block not in self._algs:
                    raise ValueError(f"{block} not added")
                algs = self._algs[block].subAlgs
            if algName in algs:
                raise ValueError(f"{algName} has already been added.")
            factoryName = f"{block}.{algName}" if block != self.ROOTNAME else algName
            algs[algName] = FactoryBlock(alg=alg, factoryName=factoryName, algName=algName,
                                         options=opts, defaults=defaults, subAlgs={})
            if pos is None:
                order.append(algName)
            elif pos in order:
                order.insert(order.index(pos), algName)
            else:
                raise ValueError(f"{pos} does not exit in already added config blocks")

    def addDefaultAlgs(self):
        from FakeAlgorithms import FakeConfig as F
        self.addAlgConfigBlock(algName="CommonServices", alg=F.CommonServicesFake)
        self.addAlgConfigBlock(algName="Jets", alg=F.JetsFake)
        self.addAlgConfigBlock(algName="JVT", alg=F.JvtFake, superBlocks="Jets")
        self.addAlgConfigBlock(algName="Electrons", alg=F.ElectronsFake)
        self.addAlgConfigBlock(algName="WorkingPoint", alg=F.ElectronWPFake, superBlocks="Electrons")
        self.addAlgConfigBlock(algName="PtEtaSelection", alg=F.PtEtaFake,
                               defaults={'selectionName': ''},
                               superBlocks=[self.ROOTNAME, "Jets", "Electrons"])
        self.addAlgConfigBlock(algName="EventSelection", alg=F.EventSelectionFakeGroup)
        self.addAlgConfigBlock(algName="Output", alg=F.OutputFake, defaults={'configName': 'Output'})
        self.addAlgConfigBlock(algName="Legacy", alg=F.LegacyFake, defaults={'containerName': 'AnaLegacy'})
        self.addAlgConfigBlock(algName="Broken", alg=F.BrokenFake)
