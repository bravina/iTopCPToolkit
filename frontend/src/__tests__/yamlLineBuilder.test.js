// frontend/src/__tests__/yamlLineBuilder.test.js
//
// Tests for yamlLineBuilder.js.
//
// All tests are automatic: no hardcoded expected YAML strings.
// Invariants checked:
//   - Line numbers are sequential from 1
//   - Every non-blank line has a type, key, indent, path
//   - Block-header lines appear exactly once per top-level key
//   - formatScalar never throws and produces valid-looking output

import { describe, it, expect } from 'vitest'
import { buildLines, formatScalar, renderPrefix, flattenConfig, computeDiff } from '../utils/yamlLineBuilder.js'

// ─────────────────────────────────────────────────────────────────────────────
// Minimal schema fixture (enough to exercise lookup without Athena)
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA = [
  {
    name: 'Jets',
    label: 'Jets',
    options: [
      { name: 'containerName', type: 'str', default: 'AnaJets' },
      { name: 'runNNJvtUpdate', type: 'bool', default: false },
    ],
    sub_blocks: [
      {
        name: 'JVT',
        label: 'JVT',
        options: [{ name: 'selectionName', type: 'str', default: 'baselineJvt' }],
      },
    ],
  },
  {
    name: 'Electrons',
    label: 'Electrons',
    options: [{ name: 'containerName', type: 'str', default: 'AnaElectrons' }],
    sub_blocks: [],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// buildLines invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('buildLines — structural invariants', () => {
  const config = {
    Jets: [{ containerName: 'MyJets', JVT: { selectionName: 'baseline' } }],
    Electrons: { containerName: 'MyElectrons' },
  }

  it('line numbers start at 1 and are sequential', () => {
    const lines = buildLines(config, SCHEMA)
    const nums = lines.map(l => l.lineNum)
    expect(nums[0]).toBe(1)
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]).toBe(nums[i - 1] + 1)
    }
  })

  it('every non-blank line has required fields', () => {
    const lines = buildLines(config, SCHEMA)
    for (const line of lines) {
      expect(line.type).toBeDefined()
      expect(line.lineNum).toBeTypeOf('number')
      if (line.type !== 'blank') {
        expect(line.key).toBeDefined()
        expect(line.indent).toBeTypeOf('number')
        expect(line.indent).toBeGreaterThanOrEqual(0)
        expect(line.path).toBeDefined()
      }
    }
  })

  it('each top-level key produces exactly one block-header line', () => {
    const lines = buildLines(config, SCHEMA)
    const headers = lines.filter(l => l.type === 'block-header')
    expect(headers.map(h => h.key)).toEqual(['Jets', 'Electrons'])
  })

  it('unknown top-level key is flagged', () => {
    const lines = buildLines({ UnknownBlock: { foo: 'bar' } }, SCHEMA)
    const header = lines.find(l => l.type === 'block-header')
    expect(header.unknown).toBe(true)
  })

  it('known key is not flagged as unknown', () => {
    const lines = buildLines({ Jets: [{ containerName: 'AnaJets' }] }, SCHEMA)
    const header = lines.find(l => l.type === 'block-header')
    expect(header.unknown).toBe(false)
  })

  it('kv line carries rawValue and valueStr', () => {
    const lines = buildLines({ Electrons: { containerName: 'AnaElectrons' } }, SCHEMA)
    const kv = lines.find(l => l.type === 'kv' && l.key === 'containerName')
    expect(kv).toBeDefined()
    expect(kv.rawValue).toBe('AnaElectrons')
    expect(kv.valueStr).toBe('AnaElectrons')
  })

  it('empty config produces no lines', () => {
    expect(buildLines({}, SCHEMA)).toHaveLength(0)
  })

  it('null block value produces only a header line', () => {
    const lines = buildLines({ Jets: null }, SCHEMA)
    expect(lines.filter(l => l.type !== 'blank')).toHaveLength(1)
    expect(lines[0].type).toBe('block-header')
  })

  it('blank separator is inserted between top-level blocks', () => {
    const lines = buildLines(config, SCHEMA)
    // Find the index of the second block-header
    const headerIndices = lines.reduce((acc, l, i) => l.type === 'block-header' ? [...acc, i] : acc, [])
    expect(headerIndices.length).toBeGreaterThanOrEqual(2)
    // The line immediately before the second header should be blank
    expect(lines[headerIndices[1] - 1].type).toBe('blank')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatScalar
// ─────────────────────────────────────────────────────────────────────────────

describe('formatScalar', () => {
  const cases = [
    [null,      'null'],
    [undefined, 'null'],
    [true,      'true'],
    [false,     'false'],
    [42,        '42'],
    [3.14,      '3.14'],
    ['hello',   'hello'],
    ['',        "''"],          // empty string must be quoted
    ['a:b',     "'a:b'"],       // colon triggers quoting
    ["it's",    "'it''s'"],     // apostrophe is escaped
  ]

  for (const [input, expected] of cases) {
    it(`formats ${JSON.stringify(input)} → ${expected}`, () => {
      expect(formatScalar(input)).toBe(expected)
    })
  }

  it('never throws for any primitive input', () => {
    const inputs = [null, undefined, true, false, 0, -1, 1.5, '', 'hello', 'a:b', '#comment', '[]']
    for (const v of inputs) {
      expect(() => formatScalar(v)).not.toThrow()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// renderPrefix
// ─────────────────────────────────────────────────────────────────────────────

describe('renderPrefix', () => {
  it('non-list-start: returns spaces equal to indent', () => {
    expect(renderPrefix(4, false)).toBe('    ')
    expect(renderPrefix(0, false)).toBe('')
  })

  it('list-start: returns (indent-2) spaces + "- "', () => {
    expect(renderPrefix(4, true)).toBe('  - ')
    expect(renderPrefix(2, true)).toBe('- ')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// flattenConfig / computeDiff
// ─────────────────────────────────────────────────────────────────────────────

describe('flattenConfig', () => {
  it('flattens nested objects', () => {
    const flat = flattenConfig({ a: { b: 1, c: 2 } })
    expect(flat['a.b']).toBe(1)
    expect(flat['a.c']).toBe(2)
  })

  it('represents array indices as [n]', () => {
    const flat = flattenConfig({ a: [10, 20] })
    expect(flat['a[0]']).toBe(10)
    expect(flat['a[1]']).toBe(20)
  })

  it('handles null at leaf', () => {
    const flat = flattenConfig({ a: null })
    expect(flat['a']).toBeNull()
  })
})

describe('computeDiff', () => {
  it('identical configs produce empty diff', () => {
    const cfg = { Jets: { containerName: 'AnaJets' } }
    expect(computeDiff(cfg, cfg)).toEqual({})
  })

  it('added key is reported', () => {
    const a = { Jets: { containerName: 'AnaJets' } }
    const b = { Jets: { containerName: 'AnaJets', runNNJvtUpdate: true } }
    const diff = computeDiff(a, b)
    expect(diff['Jets.runNNJvtUpdate'].status).toBe('added')
  })

  it('removed key is reported', () => {
    const a = { Jets: { containerName: 'AnaJets', runNNJvtUpdate: true } }
    const b = { Jets: { containerName: 'AnaJets' } }
    const diff = computeDiff(a, b)
    expect(diff['Jets.runNNJvtUpdate'].status).toBe('removed')
  })

  it('changed value is reported with both values', () => {
    const a = { Jets: { containerName: 'AnaJets' } }
    const b = { Jets: { containerName: 'MyJets' } }
    const diff = computeDiff(a, b)
    expect(diff['Jets.containerName'].status).toBe('changed')
    expect(diff['Jets.containerName'].valueA).toBe('AnaJets')
    expect(diff['Jets.containerName'].valueB).toBe('MyJets')
  })
})
