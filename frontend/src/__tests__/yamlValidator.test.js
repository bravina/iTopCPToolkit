// frontend/src/__tests__/yamlValidator.test.js
//
// Tests for yamlValidator.js.
//
// Fully automatic: the schema is the source of truth, and we construct
// inputs that are either valid or deliberately invalid — no hardcoded
// expected message strings (we check severity and path structure instead).

import { describe, it, expect } from 'vitest'
import { validateConfig, buildIssueMap } from '../utils/yamlValidator.js'

// ─────────────────────────────────────────────────────────────────────────────
// Schema fixture
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA = [
  {
    name: 'Jets',
    options: [
      { name: 'containerName',  type: 'str',  default: 'AnaJets', required: false, noneAction: 'ignore' },
      { name: 'runNNJvtUpdate', type: 'bool', default: false,      required: false, noneAction: 'ignore' },
    ],
    sub_blocks: [
      {
        name: 'JVT',
        options: [
          { name: 'selectionName', type: 'str', default: 'baselineJvt', required: false, noneAction: 'ignore' },
        ],
      },
    ],
  },
  {
    name: 'EventSelection',
    options: [
      { name: 'selectionCutsDict', type: 'str', default: null, required: true, noneAction: 'error' },
    ],
    sub_blocks: [],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// validateConfig
// ─────────────────────────────────────────────────────────────────────────────

describe('validateConfig — valid configs', () => {
  it('known block with known options produces no issues', () => {
    const issues = validateConfig({ Jets: [{ containerName: 'AnaJets' }] }, SCHEMA)
    expect(issues).toHaveLength(0)
  })

  it('empty block produces no issues', () => {
    const issues = validateConfig({ Jets: [{}] }, SCHEMA)
    expect(issues).toHaveLength(0)
  })

  it('dict-style block (not array) produces no issues', () => {
    const issues = validateConfig({ Jets: { containerName: 'AnaJets' } }, SCHEMA)
    expect(issues).toHaveLength(0)
  })

  it('known sub-block with known options produces no issues', () => {
    const issues = validateConfig(
      { Jets: [{ JVT: { selectionName: 'baselineJvt' } }] },
      SCHEMA
    )
    expect(issues).toHaveLength(0)
  })
})

describe('validateConfig — unknown keys', () => {
  it('unknown top-level block is an error', () => {
    const issues = validateConfig({ UnknownBlock: {} }, SCHEMA)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('error')
    expect(issues[0].path).toBe('UnknownBlock')
  })

  it('unknown option key is an error', () => {
    const issues = validateConfig({ Jets: [{ unknownOption: 'value' }] }, SCHEMA)
    expect(issues.some(i => i.severity === 'error' && i.path.includes('unknownOption'))).toBe(true)
  })

  it('unknown key in sub-block is an error', () => {
    const issues = validateConfig(
      { Jets: [{ JVT: { unknownSubOpt: 'value' } }] },
      SCHEMA
    )
    expect(issues.some(i => i.severity === 'error' && i.path.includes('unknownSubOpt'))).toBe(true)
  })
})

describe('validateConfig — type mismatches', () => {
  it('string where bool expected is a warning', () => {
    const issues = validateConfig({ Jets: [{ runNNJvtUpdate: 'yes' }] }, SCHEMA)
    expect(issues.some(i => i.severity === 'warning' && i.path.includes('runNNJvtUpdate'))).toBe(true)
  })

  it('correct bool type produces no warning', () => {
    const issues = validateConfig({ Jets: [{ runNNJvtUpdate: true }] }, SCHEMA)
    expect(issues.filter(i => i.path.includes('runNNJvtUpdate'))).toHaveLength(0)
  })

  it('null value is not flagged (treated as absent)', () => {
    const issues = validateConfig({ Jets: [{ containerName: null }] }, SCHEMA)
    expect(issues.filter(i => i.path.includes('containerName'))).toHaveLength(0)
  })
})

describe('validateConfig — required options', () => {
  it('missing required option produces a warning', () => {
    // EventSelection requires selectionCutsDict
    const issues = validateConfig({ EventSelection: {} }, SCHEMA)
    expect(issues.some(i => i.path.includes('selectionCutsDict'))).toBe(true)
  })

  it('present required option produces no warning', () => {
    const issues = validateConfig(
      { EventSelection: { selectionCutsDict: { signal: 'EL_N 25000 >= 1\nSAVE\n' } } },
      SCHEMA
    )
    expect(issues.filter(i => i.path.includes('selectionCutsDict'))).toHaveLength(0)
  })
})

describe('validateConfig — never throws', () => {
  const oddInputs = [
    null, undefined, {}, { Jets: null }, { Jets: [null] },
    { Jets: [{ containerName: undefined }] },
    { Jets: 42 },
  ]
  for (const input of oddInputs) {
    it(`does not throw for input: ${JSON.stringify(input)}`, () => {
      expect(() => validateConfig(input, SCHEMA)).not.toThrow()
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// buildIssueMap
// ─────────────────────────────────────────────────────────────────────────────

describe('buildIssueMap', () => {
  it('groups issues by path', () => {
    const issues = [
      { path: 'Jets[0].foo', severity: 'error',   message: 'a' },
      { path: 'Jets[0].foo', severity: 'warning',  message: 'b' },
      { path: 'Jets[0].bar', severity: 'warning',  message: 'c' },
    ]
    const map = buildIssueMap(issues)
    expect(map['Jets[0].foo']).toHaveLength(2)
    expect(map['Jets[0].bar']).toHaveLength(1)
  })

  it('returns empty map for empty issues', () => {
    expect(buildIssueMap([])).toEqual({})
  })
})
