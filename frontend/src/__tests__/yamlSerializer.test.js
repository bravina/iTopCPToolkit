// frontend/src/__tests__/yamlSerializer.test.js
//
// Tests for yamlSerializer.js.
//
// Key invariant: options at their default value are omitted from the YAML output.
// Key roundtrip: buildYamlObject(state) → parsed back → same non-default values.

import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
import { buildYamlObject, toYamlString } from '../utils/yamlSerializer.js'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

// Minimal schema covering the cases we want to test
const SCHEMA = [
  {
    name: 'Jets',
    label: 'Jets',
    repeatable: true,
    options: [
      { name: 'containerName',   type: 'str',  default: 'AnaJets' },
      { name: 'runNNJvtUpdate',  type: 'bool', default: false },
      { name: 'jetCollection',   type: 'str',  default: '' },
    ],
    sub_blocks: [
      {
        name: 'JVT',
        label: 'JVT',
        repeatable: false,
        options: [{ name: 'selectionName', type: 'str', default: 'baselineJvt' }],
        sub_blocks: [],
      },
      {
        name: 'FlavourTagging',
        label: 'Flavour Tagging',
        repeatable: true,
        options: [
          { name: 'btagger', type: 'str', default: 'GN2v01' },
          { name: 'btagWP',  type: 'str', default: '' },
        ],
        sub_blocks: [],
      },
    ],
  },
  {
    name: 'PileupReweighting',
    label: 'Pileup Reweighting',
    repeatable: false,
    options: [{ name: 'useDefaultConfig', type: 'bool', default: true }],
    sub_blocks: [],
  },
]

/** Build a minimal valid config state for a Jets block instance. */
function makeJetsState(overrides = {}) {
  return {
    Jets: {
      enabled: true,
      instances: [{
        _id: 'inst-1',
        options: { containerName: 'MyJets', runNNJvtUpdate: true, ...overrides },
        sub_blocks: {
          JVT: { enabled: false, instances: [{ _id: 'sub-1', options: {} }] },
          FlavourTagging: { enabled: false, instances: [{ _id: 'sub-2', options: {} }] },
        },
      }],
    },
    PileupReweighting: { enabled: false, instances: [{ _id: 'inst-2', options: {}, sub_blocks: {} }] },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// buildYamlObject
// ─────────────────────────────────────────────────────────────────────────────

describe('buildYamlObject', () => {
  it('disabled blocks are excluded', () => {
    const state = makeJetsState()
    state.Jets.enabled = false
    const obj = buildYamlObject(state, SCHEMA)
    expect(obj).not.toHaveProperty('Jets')
  })

  it('enabled block is included', () => {
    const obj = buildYamlObject(makeJetsState(), SCHEMA)
    expect(obj).toHaveProperty('Jets')
  })

  it('repeatable block serialises as an array', () => {
    const obj = buildYamlObject(makeJetsState(), SCHEMA)
    expect(Array.isArray(obj.Jets)).toBe(true)
  })

  it('non-repeatable block serialises as an object', () => {
    const state = makeJetsState()
    state.PileupReweighting.enabled = true
    const obj = buildYamlObject(state, SCHEMA)
    expect(Array.isArray(obj.PileupReweighting)).toBe(false)
    expect(typeof obj.PileupReweighting).toBe('object')
  })

  it('option at default value is omitted', () => {
    // containerName defaults to 'AnaJets'; if we set it to the default it should disappear
    const state = makeJetsState({ containerName: 'AnaJets' })
    const obj = buildYamlObject(state, SCHEMA)
    // The instance should not contain containerName since it equals the default
    expect(obj.Jets[0]).not.toHaveProperty('containerName')
  })

  it('option different from default is included', () => {
    const obj = buildYamlObject(makeJetsState(), SCHEMA)
    // 'MyJets' ≠ default 'AnaJets'
    expect(obj.Jets[0].containerName).toBe('MyJets')
  })

  it('boolean option different from default is included', () => {
    // runNNJvtUpdate defaults to false; we set it to true
    const obj = buildYamlObject(makeJetsState(), SCHEMA)
    expect(obj.Jets[0].runNNJvtUpdate).toBe(true)
  })

  it('disabled sub-block is excluded', () => {
    const obj = buildYamlObject(makeJetsState(), SCHEMA)
    expect(obj.Jets[0]).not.toHaveProperty('JVT')
  })

  it('enabled sub-block is included', () => {
    const state = makeJetsState()
    state.Jets.instances[0].sub_blocks.JVT.enabled = true
    const obj = buildYamlObject(state, SCHEMA)
    expect(obj.Jets[0]).toHaveProperty('JVT')
  })

  it('enabled repeatable sub-block serialises as array', () => {
    const state = makeJetsState()
    state.Jets.instances[0].sub_blocks.FlavourTagging.enabled = true
    state.Jets.instances[0].sub_blocks.FlavourTagging.instances = [
      { _id: 'ft-1', options: { btagger: 'GN2v01', btagWP: 'FixedCutBEff_77' } },
    ]
    const obj = buildYamlObject(state, SCHEMA)
    expect(Array.isArray(obj.Jets[0].FlavourTagging)).toBe(true)
    expect(obj.Jets[0].FlavourTagging[0].btagWP).toBe('FixedCutBEff_77')
  })

  it('block with all-default options serialises as null (rendered as {})', () => {
    const state = makeJetsState({ containerName: 'AnaJets', runNNJvtUpdate: false })
    const obj = buildYamlObject(state, SCHEMA)
    // All options match defaults → instance serialises to null
    expect(obj.Jets[0]).toBeNull()
  })

  it('empty state returns {}', () => {
    expect(buildYamlObject({}, SCHEMA)).toEqual({})
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// toYamlString
// ─────────────────────────────────────────────────────────────────────────────

describe('toYamlString', () => {
  it('returns a comment when no blocks are enabled', () => {
    const result = toYamlString(makeJetsState(), SCHEMA)
    // All disabled → '# No blocks enabled yet\n'
    const state = makeJetsState()
    state.Jets.enabled = false
    expect(toYamlString(state, SCHEMA)).toContain('# No blocks enabled')
  })

  it('output is valid YAML', () => {
    const result = toYamlString(makeJetsState(), SCHEMA)
    expect(() => yaml.load(result)).not.toThrow()
  })

  it('parsed output contains the block key', () => {
    const result = toYamlString(makeJetsState(), SCHEMA)
    const parsed = yaml.load(result)
    expect(parsed).toHaveProperty('Jets')
  })

  it('non-default values survive the string roundtrip', () => {
    const result = toYamlString(makeJetsState(), SCHEMA)
    const parsed = yaml.load(result)
    expect(parsed.Jets[0].containerName).toBe('MyJets')
    expect(parsed.Jets[0].runNNJvtUpdate).toBe(true)
  })

  it('multiple enabled blocks are separated by blank lines', () => {
    const state = makeJetsState()
    state.PileupReweighting.enabled = true
    const result = toYamlString(state, SCHEMA)
    // Should contain a blank line between the two blocks
    expect(result).toMatch(/\n\n/)
  })
})
