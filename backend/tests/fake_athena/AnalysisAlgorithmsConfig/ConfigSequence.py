# Minimal stand-in for AnalysisAlgorithmsConfig.ConfigSequence.
from functools import wraps
from random import randrange


def groupBlocks(func):
    """Decorates a function taking `seq`; assigns one groupName to all appended blocks."""
    @wraps(func)
    def wrapper(**kwargs):
        func(**kwargs)
        groupName = f"{func.__name__}_{randrange(10**8):08}"
        for block in kwargs['seq']:
            block.setOptionValue('groupName', groupName)
    return wrapper


class ConfigSequence:
    def __init__(self):
        self._blocks = []

    def append(self, block):
        self._blocks.append(block)

    def __iter__(self):
        return iter(self._blocks)

    def __len__(self):
        return len(self._blocks)

    def setFactoryName(self, factoryName):
        for block in self._blocks:
            block.setFactoryName(factoryName)
