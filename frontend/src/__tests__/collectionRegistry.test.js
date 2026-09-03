import { describe, it, expect } from 'vitest'
import {
  buildRegistryFromState, buildRegistryFromYaml, inferFieldType, optionRole, getAutocompleteMode,
} from '../utils/collectionRegistry.js'
import { checkDepsFromState, checkDepsFromYaml, looksLikeContainerRef } from '../utils/dependencyChecker.js'
import { yamlToConfigSync } from '../utils/yamlToConfig.js'
import { SCHEMA, findBlock, opt } from './fixtures/schema.js'

const YAML = {
  Jets: [{ containerName: 'AnaJets', JVT: {}, PtEtaSelection: [{ selectionName: 'tight', minPt: 30000 }] }],
  Electrons: { containerName: 'AnaElectrons', WorkingPoint: [{ selectionName: 'loose' }, { selectionName: 'tight' }] },
  PtEtaSelection: { containerName: 'AnaElectrons', selectionName: 'pt50', minPt: 50000 },
  Thinning: { containerName: 'AnaJets', outputName: 'OutJets' },
  OverlapRemoval: { electrons: 'AnaElectrons.loose', jets: 'AnaJets.jvt', muons: 'AnaMuons' },
  EventSelection: { selectionName: 'sel', electrons: 'AnaElectrons.medium', selectionCuts: 'x' },
}

describe('inferFieldType', () => {
  it('maps names to object types with taus checked before jets', () => {
    expect(inferFieldType('Jets')).toBe('jets')
    expect(inferFieldType('PL_Jets')).toBe('jets')
    expect(inferFieldType('TauJets')).toBe('taus')
    expect(inferFieldType('DiTauJets')).toBe('taus')
    expect(inferFieldType('largeRjets')).toBe('jets')
    expect(inferFieldType('MissingET')).toBe('met')
    expect(inferFieldType('met')).toBe('met')
    expect(inferFieldType('InDetTracks')).toBe('tracks')
    expect(inferFieldType('CommonServices')).toBeNull()
  })
})

describe('optionRole', () => {
  it('prefers upstream meta.role', () => {
    expect(optionRole(opt('anything', 'str', '', { meta: { role: 'selection' } }))).toBe('selection')
  })
  it('falls back to naming conventions', () => {
    const jets = findBlock(SCHEMA.blocks, 'Jets')
    const thinning = findBlock(SCHEMA.blocks, 'Thinning')
    const byName = b => Object.fromEntries(b.options.map(o => [o.name, o]))
    expect(optionRole(byName(jets).containerName, { blockDef: jets })).toBe('container')
    expect(optionRole(byName(thinning).containerName, { blockDef: thinning })).toBe('containerRef')
    expect(optionRole(byName(thinning).outputName, { blockDef: thinning })).toBe('container')
    expect(optionRole(byName(jets).containerName, { isSub: true })).toBe('inherited')
    expect(optionRole(opt('electrons', 'str', ''))).toBe('containerRef')
    expect(optionRole(opt('selectionName', 'str', ''))).toBe('selection')
    expect(optionRole(opt('minPt', 'float', 0))).toBeNull()
    expect(getAutocompleteMode(opt('jets', 'str', ''))).toBe('collections+selections')
    expect(getAutocompleteMode(opt('minPt', 'float', 0))).toBeNull()
  })
})

describe('registry', () => {
  const fromYaml = buildRegistryFromYaml(YAML, SCHEMA.blocks)

  it('collects containers with their types, including outputName aliases', () => {
    expect(fromYaml.collections.map(c => c.name)).toEqual(['AnaJets', 'AnaElectrons', 'OutJets'])
    expect(fromYaml.byType.jets.map(c => c.name)).toEqual(['AnaJets'])
    expect(fromYaml.collections.find(c => c.name === 'OutJets').type).toBe('any')
  })

  it('collects selections from sub-blocks (using defaults) and from root selection blocks', () => {
    expect(fromYaml.withSelections).toEqual([
      'AnaJets.jvt', 'AnaJets.tight', 'AnaElectrons.loose', 'AnaElectrons.tight', 'AnaElectrons.pt50',
    ])
  })

  it('is identical whether built from YAML or from the builder state', () => {
    const fromState = buildRegistryFromState(yamlToConfigSync(YAML, SCHEMA), SCHEMA.blocks)
    expect(fromState).toEqual(fromYaml)
  })

  it('ignores disabled blocks in the builder state', () => {
    const config = yamlToConfigSync(YAML, SCHEMA)
    config.blocks.Electrons.enabled = false
    const reg = buildRegistryFromState(config, SCHEMA.blocks)
    expect(reg.collections.map(c => c.name)).toEqual(['AnaJets', 'OutJets'])
  })
})

describe('dependency checker', () => {
  it('flags unknown containers and selections, only on containerRef options', () => {
    const registry = buildRegistryFromYaml(YAML, SCHEMA.blocks)
    const issues = checkDepsFromYaml(YAML, registry, SCHEMA.blocks)
    expect(issues.map(i => `${i.path}:${i.message}`)).toEqual([
      "OverlapRemoval[0].muons:Container 'AnaMuons' is not defined by any enabled block",
      "EventSelection[0].electrons:Selection 'medium' is not defined for container 'AnaElectrons'",
    ])
    expect(issues.every(i => i.kind === 'dependency')).toBe(true)
  })

  it('gives the same answer from the builder state', () => {
    const config = yamlToConfigSync(YAML, SCHEMA)
    const registry = buildRegistryFromState(config, SCHEMA.blocks)
    expect(checkDepsFromState(config, registry, SCHEMA.blocks)).toHaveLength(2)
  })

  it('looksLikeContainerRef is conservative', () => {
    expect(looksLikeContainerRef('AnaJets.baselineJvt')).toBe(true)
    expect(looksLikeContainerRef('AnaElectrons.tight_%SYS%')).toBe(true)
    expect(looksLikeContainerRef('True')).toBe(false)
    expect(looksLikeContainerRef('a b')).toBe(false)
    expect(looksLikeContainerRef(5)).toBe(false)
  })
})
