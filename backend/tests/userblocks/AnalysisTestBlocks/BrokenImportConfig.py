# A block whose module is importable by path but whose own imports are not:
# the catalogue must drop it the same way it drops a missing module.

import definitely_not_a_real_module  # noqa: F401


def BrokenImportConfig():
    raise AssertionError("never reached")
