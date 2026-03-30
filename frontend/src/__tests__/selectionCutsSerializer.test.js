// frontend/src/__tests__/selectionCutsSerializer.test.js
//
// Tests for selectionCutsSerializer.js.
//
// Strategy: purely automatic — no hardcoded expected outputs.
// Every test asserts a roundtrip invariant:
//   parseSelectionCutsString(cutsToRawText(cuts)) ≈ original cuts
// (modulo generated UUIDs and normalised whitespace)
//
// One representative line per keyword is constructed programmatically,
// so adding a new keyword only requires adding one entry to KEYWORD_CASES.

import { describe, it, expect } from 'vitest'
import {
  parseSelectionCutsString,
  serializeCut,
  cutsToRawText,
  parseSelectionCutsDict,
  serializeSelectionCutsDict,
  SIGNS,
} from '../utils/selectionCutsSerializer.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Strip UUIDs so we can compare structure without caring about id values. */
function stripIds(cuts) {
  return cuts.map(({ id: _id, ...rest }) => rest)
}

/** Parse a raw line, strip its id, return { keyword, args }. */
function parseOne(line) {
  const cuts = parseSelectionCutsString(line)
  if (cuts.length === 0) return null
  const { id: _id, ...rest } = cuts[0]
  return rest
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical text lines for every supported keyword.
// Each entry: [rawLine, expectedKeyword, briefDescription]
// The roundtrip test re-parses serializeCut(parsedCut) and checks it matches
// the re-serialised form (not necessarily the original text, but semantically
// equivalent after one parse→serialise cycle).
// ─────────────────────────────────────────────────────────────────────────────

const KEYWORD_CASES = [
  ['OS',                              'OS',              'opposite-sign, no args'],
  ['SS',                              'SS',              'same-sign, no args'],
  ['GLOBALTRIGMATCH',                 'GLOBALTRIGMATCH', 'global trig match, no postfix'],
  ['GLOBALTRIGMATCH _2024',           'GLOBALTRIGMATCH', 'global trig match with postfix'],
  ['EVENTFLAG myFlag_%SYS%',          'EVENTFLAG',       'event flag'],
  ['IMPORT SUBregion',                'IMPORT',          'import sub-region'],
  ['RUN_NUMBER >= 400000',            'RUN_NUMBER',      'run number cut'],
  ['MET >= 30000',                    'MET',             'MET cut'],
  ['MWT > 20000',                     'MWT',             'MWT cut'],
  ['MET+MWT >= 60000',                'MET+MWT',         'MET+MWT combined cut'],
  ['MLL >= 80000',                    'MLL',             'dilepton mass cut'],
  ['MLLWINDOW 76000 106000',          'MLLWINDOW',       'Z window'],
  ['MLLWINDOW 76000 106000 veto',     'MLLWINDOW',       'Z window veto'],
  ['MLL_OSSF 12000 60000',            'MLL_OSSF',        'OSSF mass window'],
  ['EL_N 25000 >= 1',                 'EL_N',            'electron count, no sel'],
  ['EL_N tight 25000 >= 2',           'EL_N',            'electron count with sel'],
  ['MU_N 25000 >= 1',                 'MU_N',            'muon count, no sel'],
  ['MU_N loose 25000 == 1',           'MU_N',            'muon count with sel'],
  ['JET_N 25000 >= 4',                'JET_N',           'jet count, no sel'],
  ['JET_N baselineJvt 25000 >= 4',    'JET_N',           'jet count with sel'],
  ['LJET_N 200000 >= 1',              'LJET_N',          'large-R jet count'],
  ['PH_N 25000 >= 1',                 'PH_N',            'photon count'],
  ['TAU_N 25000 >= 1',                'TAU_N',           'tau count'],
  ['LJETMASS_N 50000 >= 1',           'LJETMASS_N',      'large-R jet mass cut, no sel'],
  ['LJETMASS_N top 50000 >= 1',       'LJETMASS_N',      'large-R jet mass cut with sel'],
  ['LJETMASSWINDOW_N 50000 200000 >= 1',          'LJETMASSWINDOW_N', 'mass window, no sel'],
  ['LJETMASSWINDOW_N top 50000 200000 >= 1',      'LJETMASSWINDOW_N', 'mass window with sel'],
  ['LJETMASSWINDOW_N 50000 200000 >= 1 veto',     'LJETMASSWINDOW_N', 'mass window veto'],
  ['JET_N_BTAG >= 1',                             'JET_N_BTAG',       'btag, no tagger'],
  ['JET_N_BTAG GN2v01:FixedCutBEff_77 >= 2',     'JET_N_BTAG',       'btag with tagger'],
  ['JET_N_GHOST B >= 1',              'JET_N_GHOST',     'ghost B count'],
  ['JET_N_GHOST B 25000 >= 1',        'JET_N_GHOST',     'ghost B count with pT'],
  ['LJET_N_GHOST B >= 1',             'LJET_N_GHOST',    'large-R ghost B count'],
  ['SUM_EL_N_MU_N 25000 >= 2',        'SUM_EL_N_MU_N',   'sum leptons, same pT'],
  ['SUM_EL_N_MU_N 25000 20000 >= 2',  'SUM_EL_N_MU_N',   'sum leptons, different pT'],
  ['SUM_EL_N_MU_N tight loose 25000 20000 >= 2', 'SUM_EL_N_MU_N', 'sum leptons with sel'],
  ['SUM_EL_N_MU_N_TAU_N 25000 >= 2',  'SUM_EL_N_MU_N_TAU_N', 'sum 3 leptons, same pT'],
  ['OBJ_N AnaJets.baselineJvt 25000 >= 4', 'OBJ_N', 'generic object count'],
]

// ─────────────────────────────────────────────────────────────────────────────
// Roundtrip tests
// ─────────────────────────────────────────────────────────────────────────────

describe('selectionCutsSerializer — parse→serialize roundtrip', () => {
  for (const [rawLine, expectedKeyword, description] of KEYWORD_CASES) {
    it(`${expectedKeyword}: ${description}`, () => {
      // Parse the raw line
      const cuts = parseSelectionCutsString(rawLine)
      expect(cuts).toHaveLength(1)

      const cut = cuts[0]
      expect(cut.keyword).toBe(expectedKeyword)

      // Serialize back to text
      const serialized = serializeCut(cut)
      expect(typeof serialized).toBe('string')
      expect(serialized.trim()).not.toBe('')

      // Re-parse the serialized form — keyword must survive
      const reParsed = parseSelectionCutsString(serialized)
      expect(reParsed).toHaveLength(1)
      expect(reParsed[0].keyword).toBe(expectedKeyword)

      // Args must round-trip (UUIDs aside)
      expect(stripIds(reParsed)).toEqual(stripIds(cuts))
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// cutsToRawText / parseSelectionCutsString roundtrip
// ─────────────────────────────────────────────────────────────────────────────

describe('selectionCutsSerializer — cutsToRawText roundtrip', () => {
  it('multi-cut string survives parse→text→parse', () => {
    const raw = [
      'EL_N 25000 >= 1',
      'MET >= 30000',
      'JET_N 25000 >= 2',
      'SAVE',
    ].join('\n')

    const cuts = parseSelectionCutsString(raw)
    expect(cuts).toHaveLength(3) // SAVE is stripped

    const text = cutsToRawText(cuts)
    expect(text).toContain('SAVE')

    const reParsed = parseSelectionCutsString(text)
    expect(stripIds(reParsed)).toEqual(stripIds(cuts))
  })

  it('cutsToRawText always ends with SAVE', () => {
    const cuts = parseSelectionCutsString('OS\nEL_N 25000 >= 1')
    const text = cutsToRawText(cuts)
    const lines = text.trim().split('\n')
    expect(lines[lines.length - 1]).toBe('SAVE')
  })

  it('empty cuts array produces only SAVE', () => {
    const text = cutsToRawText([])
    expect(text.trim()).toBe('SAVE')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseSelectionCutsDict / serializeSelectionCutsDict roundtrip
// ─────────────────────────────────────────────────────────────────────────────

describe('selectionCutsSerializer — dict roundtrip', () => {
  it('dict with multiple regions survives parse→serialize→parse', () => {
    const dict = {
      signal:  'EL_N 25000 >= 1\nMET >= 30000\nSAVE\n',
      control: 'MU_N 25000 >= 2\nOS\nSAVE\n',
    }

    const selections = parseSelectionCutsDict(dict)
    expect(selections).toHaveLength(2)
    expect(selections.map(s => s.name)).toEqual(['signal', 'control'])

    const reDict = serializeSelectionCutsDict(selections)
    expect(reDict).not.toBeNull()

    // Re-parse and check keywords survive
    const reSignal = parseSelectionCutsString(reDict.signal)
    expect(reSignal[0].keyword).toBe('EL_N')
    expect(reSignal[1].keyword).toBe('MET')

    const reControl = parseSelectionCutsString(reDict.control)
    expect(reControl[0].keyword).toBe('MU_N')
    expect(reControl[1].keyword).toBe('OS')
  })

  it('null/empty value returns null', () => {
    expect(serializeSelectionCutsDict([])).toBeNull()
    expect(serializeSelectionCutsDict(null)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('selectionCutsSerializer — edge cases', () => {
  it('blank lines are ignored', () => {
    const cuts = parseSelectionCutsString('\n\n  \nEL_N 25000 >= 1\n\n')
    expect(cuts).toHaveLength(1)
  })

  it('comment lines are ignored', () => {
    const cuts = parseSelectionCutsString('# this is a comment\nEL_N 25000 >= 1')
    expect(cuts).toHaveLength(1)
  })

  it('SAVE line is not included in parsed cuts', () => {
    const cuts = parseSelectionCutsString('EL_N 25000 >= 1\nSAVE')
    expect(cuts).toHaveLength(1)
    expect(cuts[0].keyword).toBe('EL_N')
  })

  it('unrecognised line falls back to __raw__', () => {
    const cuts = parseSelectionCutsString('UNKNOWN_KEYWORD foo bar')
    expect(cuts).toHaveLength(1)
    expect(cuts[0].keyword).toBe('__raw__')
    expect(cuts[0].args.rawText).toBe('UNKNOWN_KEYWORD foo bar')
  })

  it('__raw__ roundtrip preserves text', () => {
    const raw = 'SOME_FUTURE_KEYWORD arg1 arg2'
    const cuts = parseSelectionCutsString(raw)
    const text = cutsToRawText(cuts)
    const reParsed = parseSelectionCutsString(text)
    expect(reParsed[0].args.rawText).toBe(raw)
  })

  it('SIGNS covers all comparison operators used in EventSelectionConfig', () => {
    // These are the only operators EventSelectionConfig.check_sign() accepts
    expect(SIGNS).toEqual(expect.arrayContaining(['<', '>', '==', '>=', '<=']))
  })
})
