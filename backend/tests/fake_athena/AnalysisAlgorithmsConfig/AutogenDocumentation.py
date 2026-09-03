# Stand-in for the unit helper the GUI shares with the Athena docs generator.
import re
from typing import Optional


def interpret_physical_unit(info: str) -> Optional[str]:
    if not info:
        return None
    patterns = [r"\[MeV\]", r"\(MeV\)", r"\(in MeV\)", r"\[in MeV\]",
                r"\[GeV\]", r"\(GeV\)", r"\(in GeV\)", r"\[in GeV\]",
                r"\[mm\]", r"\(mm\)", r"\(in mm\)", r"\[in mm\]"]
    for pattern in patterns:
        if re.search(pattern, info):
            if "MeV" in pattern:
                return "MeV"
            if "GeV" in pattern:
                return "GeV"
            return "mm"
    return None
