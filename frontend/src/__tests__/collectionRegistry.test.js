// frontend/src/__tests__/collectionRegistry.test.js
//
// Tests for collectionRegistry.js.
//
// The two public builders (fromState / fromYaml) are tested for equivalence:
// given the same logical config expressed in both formats, they must produce
// identical registries. This is the key invariant that prevents the Reader
// and Builder modes from diverging.

import { describe, it, expect } from 'vitest'
import {
  buildRegistryFromState,
  buildRegistryFromYaml,
  inferFieldType,
  getAutocompleteMode,
  DEFINING_BLOCK_TYPES,
} from '../utils/collectionRegistry.js'

// ─────────────────────────────────────────────────────────────────────────────
// Schema fixture
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA = [
  {
    name: 'Jets',
    options: [{ name: 'containerName', default: 'AnaJets' }],
    sub_blocks: [
      {
        name: 'JVT',
        options: [{ name: 'selectionName', default: 'baselineJvt' }],
      },
      {
        name: 'WorkingPoint',
        options: [{ name: 'selectionName', default: '' }],
      },
    ],
  },
  {
    name: 'Electrons',
    options: [{ name: 'containerName', default: 'AnaElectrons' }],
    sub_blocks: [
      {
        name: 'WorkingPoint',
        options: [{ name: 'selectionName', default: '' }],
      },
    ],
  },
  {
    name: 'Thinning',
    options: [
      { name: 'containerName', default: '' },
      { name: 'outputName',    default: '' },
    ],
    sub_blocks: [],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers to build minimal state / YAML representations of the same config
// ─────────────────────────────────────────────────────────────────────────────

function makeJetsState(containerName = 'AnaJets', jvtEnabled = false, wpSelection = null) {
  return {
    Jets: {
      enabled: true,
      instances: [{
        _id: 'i1',
        options: { containerName },
        sub_blocks: {
          JVT: {
            enabled: jvtEnabled,
            instances: [{ _id: 's1', options: {} }],
          },
          WorkingPoint: {
            enabled: wpSelection !== null,
            instances: [{ _id: 's2', options: wpSelection ? { selectionName: wpSelection } : {} }],
          },
        },
      }],
    },
  }
}

function makeJetsYaml(containerName = 'AnaJets', jvtPresent = false, wpSelection = null) {
  const inst = { containerName }
  if (jvtPresent) inst.JVT = {}
  if (wpSelection) inst.WorkingPoint = { selectionName: wpSelection }
  return { Jets: [inst] }
}

// ─────────────────────────────────────────────────────────────────────────────
// buildRegistryFromState
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRegistryFromState', () => {
  it('disabled block produces no collections', () => {
    const state = { Jets: { enabled: false, instances: [] } }
    const reg = buildRegistryFromState(state, SCHEMA)
    expect(reg.collections).toHaveLength(0)
  })

  it('enabled Jets block registers a jets collection', () => {
    const reg = buildRegistryFromState(makeJetsState(), SCHEMA)
    expect(reg.collections).toHaveLength(1)
    expect(reg.collections[0]).toMatchObject({ name: 'AnaJets', type: 'jets' })
  })

  it('JVT sub-block adds baselineJvt selection implicitly', () => {
    const reg = buildRegistryFromState(makeJetsState('AnaJets', true), SCHEMA)
    expect(reg.selections.some(s => s.name === 'baselineJvt' && s.container === 'AnaJets')).toBe(true)
    expect(reg.withSelections).toContain('AnaJets.baselineJvt')
  })

  it('WorkingPoint sub-block adds named selection', () => {
    const reg = buildRegistryFromState(makeJetsState('AnaJets', false, 'tight'), SCHEMA)
    expect(reg.selections.some(s => s.name === 'tight' && s.container === 'AnaJets')).toBe(true)
  })

  it('byType index is populated', () => {
    const reg = buildRegistryFromState(makeJetsState(), SCHEMA)
    expect(reg.byType.jets).toBeDefined()
    expect(reg.byType.jets[0].name).toBe('AnaJets')
  })

  it('same container name is not registered twice', () => {
    const state = {
      Jets: {
        enabled: true,
        instances: [
          { _id: 'i1', options: { containerName: 'AnaJets' }, sub_blocks: { JVT: { enabled: false, instances: [] }, WorkingPoint: { enabled: false, instances: [] } } },
          { _id: 'i2', options: { containerName: 'AnaJets' }, sub_blocks: { JVT: { enabled: false, instances: [] }, WorkingPoint: { enabled: false, instances: [] } } },
        ],
      },
    }
    const reg = buildRegistryFromState(state, SCHEMA)
    expect(reg.collections.filter(c => c.name === 'AnaJets')).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// buildRegistryFromYaml
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRegistryFromYaml', () => {
  it('Jets YAML registers a jets collection', () => {
    const reg = buildRegistryFromYaml(makeJetsYaml(), SCHEMA)
    expect(reg.collections[0]).toMatchObject({ name: 'AnaJets', type: 'jets' })
  })

  it('JVT key in YAML adds WorkingPoint selection via sub-block', () => {
    const reg = buildRegistryFromYaml(makeJetsYaml('AnaJets', false, 'tight'), SCHEMA)
    expect(reg.selections.some(s => s.name === 'tight')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Equivalence: fromState and fromYaml must agree
// ─────────────────────────────────────────────────────────────────────────────

describe('fromState vs fromYaml equivalence', () => {
  it('plain Jets block: same collections', () => {
    const stateReg = buildRegistryFromState(makeJetsState('MyJets'), SCHEMA)
    const yamlReg  = buildRegistryFromYaml(makeJetsYaml('MyJets'), SCHEMA)
    expect(stateReg.collections.map(c => c.name).sort())
      .toEqual(yamlReg.collections.map(c => c.name).sort())
  })

  it('Jets+WorkingPoint: same selections', () => {
    const stateReg = buildRegistryFromState(makeJetsState('AnaJets', false, 'tight'), SCHEMA)
    const yamlReg  = buildRegistryFromYaml(makeJetsYaml('AnaJets', false, 'tight'), SCHEMA)
    const stateNames = stateReg.selections.map(s => `${s.container}.${s.name}`).sort()
    const yamlNames  = yamlReg.selections.map(s => `${s.container}.${s.name}`).sort()
    expect(stateNames).toEqual(yamlNames)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Thinning outputName
// ─────────────────────────────────────────────────────────────────────────────

describe('Thinning outputName', () => {
  it('creates an output container from YAML', () => {
    const reg = buildRegistryFromYaml(
      {
        Jets:    [{ containerName: 'AnaJets' }],
        Thinning:[{ containerName: 'AnaJets', outputName: 'OutJets' }],
      },
      SCHEMA
    )
    expect(reg.collections.some(c => c.name === 'OutJets')).toBe(true)
  })

  it('output container inherits the source type', () => {
    const reg = buildRegistryFromYaml(
      {
        Jets:    [{ containerName: 'AnaJets' }],
        Thinning:[{ containerName: 'AnaJets', outputName: 'OutJets' }],
      },
      SCHEMA
    )
    const out = reg.collections.find(c => c.name === 'OutJets')
    expect(out.type).toBe('jets')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// inferFieldType
// ─────────────────────────────────────────────────────────────────────────────

describe('inferFieldType', () => {
  const cases = [
    ['jets',       ['jets', 'inputJets', 'largeRjets', 'ljetContainer']],
    ['electrons',  ['electrons', 'inputElectrons']],
    ['muons',      ['muons', 'inputMuons']],
    ['photons',    ['photons', 'inputPhotons']],
    ['taus',       ['taus', 'tau']],
    ['met',        ['met', 'missingET']],
    ['tracks',     ['tracks', 'track']],
    [null,         ['selectionName', 'btagger', 'someRandomOption']],
  ]
  for (const [expectedType, optNames] of cases) {
    for (const optName of optNames) {
      it(`"${optName}" → ${expectedType}`, () => {
        expect(inferFieldType(optName)).toBe(expectedType)
      })
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// getAutocompleteMode
// ─────────────────────────────────────────────────────────────────────────────

describe('getAutocompleteMode', () => {
  it('outputName → null (never a reference)', () => {
    expect(getAutocompleteMode('outputName', 'Thinning')).toBeNull()
  })

  it('containerName in a defining block → null', () => {
    // Jets is in DEFINING_BLOCK_TYPES, so containerName is an invented name
    expect(getAutocompleteMode('containerName', 'Jets')).toBeNull()
  })

  it('containerName in a non-defining block → autocomplete', () => {
    expect(getAutocompleteMode('containerName', 'OverlapRemoval')).toBe('collections+selections')
  })

  it('jets option → autocomplete', () => {
    expect(getAutocompleteMode('jets', 'OverlapRemoval')).toBe('collections+selections')
  })

  it('electrons option → autocomplete', () => {
    expect(getAutocompleteMode('electrons', 'OverlapRemoval')).toBe('collections+selections')
  })

  it('unrelated option name → null', () => {
    expect(getAutocompleteMode('debugMode', 'EventSelection')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DEFINING_BLOCK_TYPES consistency
// ─────────────────────────────────────────────────────────────────────────────

describe('DEFINING_BLOCK_TYPES', () => {
  it('all values are either null or a non-empty string', () => {
    for (const [name, type] of Object.entries(DEFINING_BLOCK_TYPES)) {
      expect(type === null || (typeof type === 'string' && type.length > 0)).toBe(true)
    }
  })
})
