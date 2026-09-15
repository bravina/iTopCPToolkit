// GENERATED — do not edit by hand.
//
// The real `EventSelectionConfig.keywordSpecs()` table from AnalysisBase
// 25.2.110, plus a corpus of cut lines parsed by Athena's own parser
// (`EventSelectionConfig.parseArgs`).  `eventSelection.test.js` asserts the
// GUI parser reproduces these argument dicts exactly, so the two cannot
// drift.  Regenerate from a newer release rather than editing.

export const KEYWORDS = {
  "EL_N": {
    "args": [
      {
        "name": "sel",
        "optional": true,
        "type": "str"
      },
      {
        "name": "ptmin",
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count electrons above a pT threshold"
  },
  "EVENTFLAG": {
    "args": [
      {
        "name": "decoration",
        "type": "str"
      }
    ],
    "info": "Require an existing event-wise decoration to be true"
  },
  "EVENTVAR": {
    "args": [
      {
        "choices": [
          "double",
          "float",
          "int"
        ],
        "name": "type",
        "type": "str"
      },
      {
        "name": "name",
        "type": "str"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "value",
        "signed": true,
        "type": "float"
      }
    ],
    "info": "Cut on an existing EventInfo scalar variable, e.g. a DNN or BDT discriminant"
  },
  "EXPR": {
    "freeText": true,
    "grammar": {
      "collections": [
        "bjet",
        "el",
        "jet",
        "ljet",
        "met",
        "mu",
        "ph",
        "tau"
      ],
      "variables": [
        "dEta",
        "dPhi",
        "dR",
        "e",
        "eta",
        "m",
        "phi",
        "pt"
      ]
    },
    "info": "Cut on a generic object-kinematic expression, e.g. `dR(el[0],jet[0]) > 0.4`"
  },
  "GLOBALTRIGMATCH": {
    "args": [
      {
        "name": "postfix",
        "optional": true,
        "type": "str"
      }
    ],
    "info": "Require the global trigger matching decision, optionally for a given trigger-configuration postfix"
  },
  "IMPORT": {
    "args": [
      {
        "name": "region",
        "type": "region"
      }
    ],
    "info": "Import all the cuts of a previously defined event selection"
  },
  "JET_N": {
    "args": [
      {
        "name": "sel",
        "optional": true,
        "type": "str"
      },
      {
        "name": "ptmin",
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count jets above a pT threshold"
  },
  "JET_N_BTAG": {
    "args": [
      {
        "name": "sel",
        "optional": true,
        "pattern": "^[^:]+$",
        "type": "str"
      },
      {
        "name": "btag",
        "optional": true,
        "pattern": "^[^:]+:[^:]+$",
        "type": "str"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count b-tagged jets above the default b-tagging working point, or above a custom one given as `tagger:WP`"
  },
  "JET_N_GHOST": {
    "args": [
      {
        "name": "ghost",
        "pattern": "^[A-Za-z]+(![A-Za-z]+)?$",
        "type": "str"
      },
      {
        "name": "ptmin",
        "optional": true,
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count jets ghost-associated to a given particle, e.g. `B`, or `B!C` to also veto a second ghost association"
  },
  "LJETMASSWINDOW_N": {
    "args": [
      {
        "name": "sel",
        "optional": true,
        "type": "str"
      },
      {
        "name": "lowMass",
        "type": "float"
      },
      {
        "name": "highMass",
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      },
      {
        "name": "veto",
        "optional": true,
        "type": "flag"
      }
    ],
    "info": "Count large-R jets inside (or, with `veto`, outside) a mass window"
  },
  "LJETMASS_N": {
    "args": [
      {
        "name": "sel",
        "optional": true,
        "type": "str"
      },
      {
        "name": "minMass",
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count large-R jets above a mass threshold"
  },
  "LJET_N": {
    "args": [
      {
        "name": "sel",
        "optional": true,
        "type": "str"
      },
      {
        "name": "ptmin",
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count large-R jets above a pT threshold"
  },
  "LJET_N_GHOST": {
    "args": [
      {
        "name": "ghost",
        "pattern": "^[A-Za-z]+(![A-Za-z]+)?$",
        "type": "str"
      },
      {
        "name": "ptmin",
        "optional": true,
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count large-R jets ghost-associated to a given particle, e.g. `B`, or `B!C` to also veto a second ghost association"
  },
  "MET": {
    "args": [
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "refMET",
        "type": "float"
      }
    ],
    "info": "Cut on the missing transverse energy"
  },
  "MET+MWT": {
    "args": [
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "refMETMWT",
        "type": "float"
      }
    ],
    "info": "Cut on the sum of the missing transverse energy and the transverse mass"
  },
  "MLL": {
    "args": [
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "refMLL",
        "type": "float"
      }
    ],
    "info": "Cut on the dilepton invariant mass"
  },
  "MLLWINDOW": {
    "args": [
      {
        "name": "lowMLL",
        "type": "float"
      },
      {
        "name": "highMLL",
        "type": "float"
      },
      {
        "name": "veto",
        "optional": true,
        "type": "flag"
      }
    ],
    "info": "Require the dilepton invariant mass inside (or, with `veto`, outside) a mass window"
  },
  "MLL_OSSF": {
    "args": [
      {
        "name": "lowMll",
        "type": "float"
      },
      {
        "name": "highMll",
        "type": "float"
      },
      {
        "name": "veto",
        "optional": true,
        "type": "flag"
      }
    ],
    "info": "Require the opposite-sign same-flavour dilepton invariant mass inside (or, with `veto`, outside) a mass window"
  },
  "MU_N": {
    "args": [
      {
        "name": "sel",
        "optional": true,
        "type": "str"
      },
      {
        "name": "ptmin",
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count muons above a pT threshold"
  },
  "MWT": {
    "args": [
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "refMWT",
        "type": "float"
      }
    ],
    "info": "Cut on the transverse mass of the leading lepton and MET"
  },
  "OBJ_N": {
    "args": [
      {
        "name": "container",
        "type": "container"
      },
      {
        "name": "ptmin",
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count objects of an arbitrary container above a pT threshold"
  },
  "OS": {
    "args": [
      {
        "name": "el",
        "optional": true,
        "type": "flag"
      },
      {
        "name": "mu",
        "optional": true,
        "type": "flag"
      },
      {
        "name": "tau",
        "optional": true,
        "type": "flag"
      }
    ],
    "info": "Require an opposite-sign lepton pair; without any flag, all available lepton flavours are considered"
  },
  "PH_N": {
    "args": [
      {
        "name": "sel",
        "optional": true,
        "type": "str"
      },
      {
        "name": "ptmin",
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count photons above a pT threshold"
  },
  "RUN_NUMBER": {
    "args": [
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "runNumber",
        "type": "int"
      }
    ],
    "info": "Cut on the (random) run number"
  },
  "SAVE": {
    "args": [],
    "deprecated": true,
    "info": "Deprecated and ignored: the event filter is now emitted automatically at the end of every event selection"
  },
  "SS": {
    "args": [
      {
        "name": "el",
        "optional": true,
        "type": "flag"
      },
      {
        "name": "mu",
        "optional": true,
        "type": "flag"
      },
      {
        "name": "tau",
        "optional": true,
        "type": "flag"
      }
    ],
    "info": "Require a same-sign lepton pair; without any flag, all available lepton flavours are considered"
  },
  "SUM_EL_N_MU_N": {
    "forms": [
      [
        {
          "name": "ptmin",
          "type": "float"
        },
        {
          "name": "sign",
          "type": "sign"
        },
        {
          "name": "count",
          "type": "int"
        }
      ],
      [
        {
          "name": "ptEl",
          "type": "float"
        },
        {
          "name": "ptMu",
          "type": "float"
        },
        {
          "name": "sign",
          "type": "sign"
        },
        {
          "name": "count",
          "type": "int"
        }
      ],
      [
        {
          "name": "selEl",
          "type": "str"
        },
        {
          "name": "selMu",
          "type": "str"
        },
        {
          "name": "ptEl",
          "type": "float"
        },
        {
          "name": "ptMu",
          "type": "float"
        },
        {
          "name": "sign",
          "type": "sign"
        },
        {
          "name": "count",
          "type": "int"
        }
      ]
    ],
    "info": "Count electrons and muons together, above a common or per-flavour pT threshold"
  },
  "SUM_EL_N_MU_N_TAU_N": {
    "forms": [
      [
        {
          "name": "ptmin",
          "type": "float"
        },
        {
          "name": "sign",
          "type": "sign"
        },
        {
          "name": "count",
          "type": "int"
        }
      ],
      [
        {
          "name": "ptEl",
          "type": "float"
        },
        {
          "name": "ptMu",
          "type": "float"
        },
        {
          "name": "ptTau",
          "type": "float"
        },
        {
          "name": "sign",
          "type": "sign"
        },
        {
          "name": "count",
          "type": "int"
        }
      ],
      [
        {
          "name": "selEl",
          "type": "str"
        },
        {
          "name": "selMu",
          "type": "str"
        },
        {
          "name": "selTau",
          "type": "str"
        },
        {
          "name": "ptEl",
          "type": "float"
        },
        {
          "name": "ptMu",
          "type": "float"
        },
        {
          "name": "ptTau",
          "type": "float"
        },
        {
          "name": "sign",
          "type": "sign"
        },
        {
          "name": "count",
          "type": "int"
        }
      ]
    ],
    "info": "Count electrons, muons and tau-jets together, above a common or per-flavour pT threshold"
  },
  "TAU_N": {
    "args": [
      {
        "name": "sel",
        "optional": true,
        "type": "str"
      },
      {
        "name": "ptmin",
        "type": "float"
      },
      {
        "name": "sign",
        "type": "sign"
      },
      {
        "name": "count",
        "type": "int"
      }
    ],
    "info": "Count tau-jets above a pT threshold"
  }
}

/** Lines parsed by Athena, with the argument dict it produced. */
export const PARSED = [
  {
    "line": "EL_N 25000 >= 2",
    "keyword": "EL_N",
    "args": {
      "sel": "",
      "ptmin": "25000",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "EL_N tight 25000 >= 2",
    "keyword": "EL_N",
    "args": {
      "sel": "tight",
      "ptmin": "25000",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "MU_N loose 20000 > 1",
    "keyword": "MU_N",
    "args": {
      "sel": "loose",
      "ptmin": "20000",
      "sign": ">",
      "count": "1"
    }
  },
  {
    "line": "JET_N 25000 >= 4",
    "keyword": "JET_N",
    "args": {
      "sel": "",
      "ptmin": "25000",
      "sign": ">=",
      "count": "4"
    }
  },
  {
    "line": "PH_N 25000 == 1",
    "keyword": "PH_N",
    "args": {
      "sel": "",
      "ptmin": "25000",
      "sign": "==",
      "count": "1"
    }
  },
  {
    "line": "TAU_N 20000 >= 1",
    "keyword": "TAU_N",
    "args": {
      "sel": "",
      "ptmin": "20000",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "LJET_N 200000 >= 1",
    "keyword": "LJET_N",
    "args": {
      "sel": "",
      "ptmin": "200000",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "JET_N_BTAG >= 2",
    "keyword": "JET_N_BTAG",
    "args": {
      "sel": "",
      "btag": "",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "JET_N_BTAG tight >= 2",
    "keyword": "JET_N_BTAG",
    "args": {
      "sel": "tight",
      "btag": "",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "JET_N_BTAG GN2v01:FixedCutBEff_77 >= 2",
    "keyword": "JET_N_BTAG",
    "args": {
      "sel": "",
      "btag": "GN2v01:FixedCutBEff_77",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "JET_N_BTAG tight GN2v01:FixedCutBEff_77 >= 2",
    "keyword": "JET_N_BTAG",
    "args": {
      "sel": "tight",
      "btag": "GN2v01:FixedCutBEff_77",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "JET_N_GHOST B >= 2",
    "keyword": "JET_N_GHOST",
    "args": {
      "ghost": "B",
      "ptmin": "",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "JET_N_GHOST B!C 25000 >= 1",
    "keyword": "JET_N_GHOST",
    "args": {
      "ghost": "B!C",
      "ptmin": "25000",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "LJET_N_GHOST B >= 1",
    "keyword": "LJET_N_GHOST",
    "args": {
      "ghost": "B",
      "ptmin": "",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "LJET_N_GHOST B!C 200000 >= 1",
    "keyword": "LJET_N_GHOST",
    "args": {
      "ghost": "B!C",
      "ptmin": "200000",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "LJETMASS_N 50000 >= 1",
    "keyword": "LJETMASS_N",
    "args": {
      "sel": "",
      "minMass": "50000",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "LJETMASS_N tight 50000 >= 1",
    "keyword": "LJETMASS_N",
    "args": {
      "sel": "tight",
      "minMass": "50000",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "LJETMASSWINDOW_N 50000 100000 >= 1",
    "keyword": "LJETMASSWINDOW_N",
    "args": {
      "veto": false,
      "sel": "",
      "lowMass": "50000",
      "highMass": "100000",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "LJETMASSWINDOW_N 50000 100000 >= 1 veto",
    "keyword": "LJETMASSWINDOW_N",
    "args": {
      "veto": true,
      "sel": "",
      "lowMass": "50000",
      "highMass": "100000",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "LJETMASSWINDOW_N tight 50000 100000 >= 1 veto",
    "keyword": "LJETMASSWINDOW_N",
    "args": {
      "veto": true,
      "sel": "tight",
      "lowMass": "50000",
      "highMass": "100000",
      "sign": ">=",
      "count": "1"
    }
  },
  {
    "line": "OBJ_N AnaJets.baseline 25000 >= 2",
    "keyword": "OBJ_N",
    "args": {
      "container": "AnaJets.baseline",
      "ptmin": "25000",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "SUM_EL_N_MU_N 25000 >= 2",
    "keyword": "SUM_EL_N_MU_N",
    "args": {
      "ptmin": "25000",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "SUM_EL_N_MU_N 25000 30000 >= 2",
    "keyword": "SUM_EL_N_MU_N",
    "args": {
      "ptEl": "25000",
      "ptMu": "30000",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "SUM_EL_N_MU_N tight loose 25000 30000 >= 2",
    "keyword": "SUM_EL_N_MU_N",
    "args": {
      "selEl": "tight",
      "selMu": "loose",
      "ptEl": "25000",
      "ptMu": "30000",
      "sign": ">=",
      "count": "2"
    }
  },
  {
    "line": "SUM_EL_N_MU_N_TAU_N 25000 >= 3",
    "keyword": "SUM_EL_N_MU_N_TAU_N",
    "args": {
      "ptmin": "25000",
      "sign": ">=",
      "count": "3"
    }
  },
  {
    "line": "SUM_EL_N_MU_N_TAU_N 25000 30000 20000 >= 3",
    "keyword": "SUM_EL_N_MU_N_TAU_N",
    "args": {
      "ptEl": "25000",
      "ptMu": "30000",
      "ptTau": "20000",
      "sign": ">=",
      "count": "3"
    }
  },
  {
    "line": "SUM_EL_N_MU_N_TAU_N tight loose medium 25000 30000 20000 >= 3",
    "keyword": "SUM_EL_N_MU_N_TAU_N",
    "args": {
      "selEl": "tight",
      "selMu": "loose",
      "selTau": "medium",
      "ptEl": "25000",
      "ptMu": "30000",
      "ptTau": "20000",
      "sign": ">=",
      "count": "3"
    }
  },
  {
    "line": "MET > 30000",
    "keyword": "MET",
    "args": {
      "sign": ">",
      "refMET": "30000"
    }
  },
  {
    "line": "MWT < 100000",
    "keyword": "MWT",
    "args": {
      "sign": "<",
      "refMWT": "100000"
    }
  },
  {
    "line": "MET+MWT >= 60000",
    "keyword": "MET+MWT",
    "args": {
      "sign": ">=",
      "refMETMWT": "60000"
    }
  },
  {
    "line": "MLL > 20000",
    "keyword": "MLL",
    "args": {
      "sign": ">",
      "refMLL": "20000"
    }
  },
  {
    "line": "MLLWINDOW 80000 100000",
    "keyword": "MLLWINDOW",
    "args": {
      "veto": false,
      "lowMLL": "80000",
      "highMLL": "100000"
    }
  },
  {
    "line": "MLLWINDOW 80000 100000 veto",
    "keyword": "MLLWINDOW",
    "args": {
      "veto": true,
      "lowMLL": "80000",
      "highMLL": "100000"
    }
  },
  {
    "line": "MLL_OSSF 80000 100000",
    "keyword": "MLL_OSSF",
    "args": {
      "veto": false,
      "lowMll": "80000",
      "highMll": "100000"
    }
  },
  {
    "line": "MLL_OSSF 80000 100000 veto",
    "keyword": "MLL_OSSF",
    "args": {
      "veto": true,
      "lowMll": "80000",
      "highMll": "100000"
    }
  },
  {
    "line": "OS",
    "keyword": "OS",
    "args": {
      "el": false,
      "mu": false,
      "tau": false
    }
  },
  {
    "line": "OS el",
    "keyword": "OS",
    "args": {
      "el": true,
      "mu": false,
      "tau": false
    }
  },
  {
    "line": "OS mu",
    "keyword": "OS",
    "args": {
      "el": false,
      "mu": true,
      "tau": false
    }
  },
  {
    "line": "OS el mu",
    "keyword": "OS",
    "args": {
      "el": true,
      "mu": true,
      "tau": false
    }
  },
  {
    "line": "OS el mu tau",
    "keyword": "OS",
    "args": {
      "el": true,
      "mu": true,
      "tau": true
    }
  },
  {
    "line": "SS",
    "keyword": "SS",
    "args": {
      "el": false,
      "mu": false,
      "tau": false
    }
  },
  {
    "line": "SS mu tau",
    "keyword": "SS",
    "args": {
      "el": false,
      "mu": true,
      "tau": true
    }
  },
  {
    "line": "IMPORT SR",
    "keyword": "IMPORT",
    "args": {
      "region": "SR"
    }
  },
  {
    "line": "EVENTFLAG myFlag",
    "keyword": "EVENTFLAG",
    "args": {
      "decoration": "myFlag"
    }
  },
  {
    "line": "GLOBALTRIGMATCH",
    "keyword": "GLOBALTRIGMATCH",
    "args": {
      "postfix": ""
    }
  },
  {
    "line": "GLOBALTRIGMATCH _loose",
    "keyword": "GLOBALTRIGMATCH",
    "args": {
      "postfix": "_loose"
    }
  },
  {
    "line": "RUN_NUMBER >= 300000",
    "keyword": "RUN_NUMBER",
    "args": {
      "sign": ">=",
      "runNumber": "300000"
    }
  },
  {
    "line": "EVENTVAR float myDNN > 0.5",
    "keyword": "EVENTVAR",
    "args": {
      "type": "float",
      "name": "myDNN",
      "sign": ">",
      "value": "0.5"
    }
  },
  {
    "line": "EVENTVAR int nSomething >= 3",
    "keyword": "EVENTVAR",
    "args": {
      "type": "int",
      "name": "nSomething",
      "sign": ">=",
      "value": "3"
    }
  },
  {
    "line": "EVENTVAR double score < -0.25",
    "keyword": "EVENTVAR",
    "args": {
      "type": "double",
      "name": "score",
      "sign": "<",
      "value": "-0.25"
    }
  },
  {
    "line": "EXPR dR(el[0],jet[0]) > 0.4",
    "keyword": "EXPR",
    "args": {
      "text": "dR(el[0],jet[0]) > 0.4"
    }
  },
  {
    "line": "EXPR m(el[0]+mu[0]) > 100000",
    "keyword": "EXPR",
    "args": {
      "text": "m(el[0]+mu[0]) > 100000"
    }
  },
  {
    "line": "SAVE",
    "keyword": "SAVE",
    "args": {}
  }
]

/** Lines Athena rejects (wrong number of arguments). */
export const REJECTED = [
  "EL_N 25000 >= ",
  "EL_N a b c 25000 >= 2",
  "MET > ",
  "OS el mu tau extra"
]
