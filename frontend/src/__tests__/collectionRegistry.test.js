import { describe, it, expect } from 'vitest'
import {
  buildRegistryFromState, buildRegistryFromYaml, inferFieldType, optionRole, getAutocompleteMode,
  selectionsFor, regionSelectionExpr,
} from '../utils/collectionRegistry.js'
import { checkDepsFromState, checkDepsFromYaml, looksLikeContainerRef } from '../utils/dependencyChecker.js'
import { yamlToConfigSync } from '../utils/yamlToConfig.js'
import { SCHEMA, block, findBlock, opt } from './fixtures/schema.js'

// ── Local schema variants ─────────────────────────────────────────────────────
// fixtures/schema.js is shared with other suites and is never mutated here; the
// two variants below are deep copies with `meta.role` added or stripped.

/** A Trigger block whose option names *look* like object references but are not:
 *  electronID/electronIsol/muonID hold working points, jetCollection an xAOD name. */
const TRIGGER = block('Trigger', [
  opt('electronID', 'str', ''),
  opt('electronIsol', 'str', ''),
  opt('muonID', 'str', ''),
  opt('jetCollection', 'str', ''),
], { category: 'Selection' })

/** Deep-copy a block list, rewriting each option through `fn(opt, blockDef)`. */
function mapOptions(blocks, fn) {
  const mapBlock = (b) => ({
    ...b,
    options: (b.options || []).map(o => fn({ ...o }, b)),
    subBlocks: (b.subBlocks || []).map(mapBlock),
  })
  return blocks.map(mapBlock)
}

const stripRole = o => (o.meta && 'role' in o.meta
  ? { ...o, meta: Object.fromEntries(Object.entries(o.meta).filter(([k]) => k !== 'role')) }
  : o)

const withRole = (o, role) => ({ ...o, meta: { ...(o.meta || {}), role } })

/** No option anywhere declares a role — the state the GUI is in until upstream
 *  annotates the blocks. */
const NO_ROLES = [...mapOptions(SCHEMA.blocks, stripRole), TRIGGER]

/** Roles declared the way upstream is expected to declare them. */
const ROLED = [...mapOptions(SCHEMA.blocks, (o, b) => {
  const isSub = (b.parents || []).length > 0
  const names = new Set((b.options || []).map(x => x.name))
  if (o.name === 'selectionName') return withRole(o, 'selection')
  if (o.name === 'outputName') return withRole(o, 'container')
  // Sub-block containerName is propagated from the parent, not declared.  A root
  // block that also names an output or a selection (Thinning, PtEtaSelection)
  // reads an existing container rather than defining one.
  if (!isSub && o.name === 'containerName') {
    return withRole(o, names.has('outputName') || names.has('selectionName') ? 'containerRef' : 'container')
  }
  if (b.name === 'OverlapRemoval' && ['electrons', 'muons', 'jets'].includes(o.name)) return withRole(o, 'containerRef')
  if (b.name === 'EventSelection' && o.name === 'electrons') return withRole(o, 'containerRef')
  return o
}), TRIGGER]

const schemaWith = blocks => ({ ...SCHEMA, blocks })

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
  it('comes from upstream meta.role', () => {
    expect(optionRole(opt('anything', 'str', '', { meta: { role: 'selection' } }))).toBe('selection')
    expect(optionRole(opt('whatever', 'str', '', { meta: { role: 'container' } }))).toBe('container')
    expect(optionRole(opt('nameless', 'str', '', { meta: { role: 'containerRef' } }))).toBe('containerRef')
    // An empty or non-string role is not a role.
    expect(optionRole(opt('x', 'str', '', { meta: { role: '' } }))).toBeNull()
    expect(optionRole(opt('x', 'str', '', { meta: { choices: ['a'] } }))).toBeNull()
  })

  it('keeps containerName propagation in sub-blocks, and defines at root', () => {
    const jets = findBlock(SCHEMA.blocks, 'Jets')
    const containerName = jets.options.find(o => o.name === 'containerName')
    expect(optionRole(containerName, { isSub: true })).toBe('inherited')
    // Temporary bridge: an un-annotated root containerName defines a container.
    expect(optionRole(containerName, { isSub: false })).toBe('container')
    expect(optionRole(containerName)).toBe('container')
  })

  it('lets a declared role override the containerName fallback', () => {
    const declared = opt('containerName', 'str', '', { meta: { role: 'containerRef' } })
    expect(optionRole(declared)).toBe('containerRef')
    expect(optionRole(declared, { isSub: true })).toBe('containerRef')
  })

  it('never infers a role from the option name', () => {
    // Regression: Trigger working points and input xAOD names are not references.
    for (const name of ['electronID', 'electronIsol', 'muonID', 'jetCollection']) {
      expect(optionRole(opt(name, 'str', ''))).toBeNull()
    }
    // containerName is the one exception (see optionRole): everything else
    // stays roleless until upstream annotates it.
    for (const name of ['electrons', 'muons', 'jets', 'outputName', 'selectionName',
                        'inputParticles', 'minPt']) {
      expect(optionRole(opt(name, 'str', ''))).toBeNull()
    }
  })

  it('drives autocomplete only for declared containerRefs', () => {
    expect(getAutocompleteMode(opt('anything', 'str', '', { meta: { role: 'containerRef' } })))
      .toBe('collections+selections')
    expect(getAutocompleteMode(opt('jets', 'str', ''))).toBeNull()
    expect(getAutocompleteMode(opt('electronID', 'str', ''))).toBeNull()
    expect(getAutocompleteMode(opt('minPt', 'float', 0))).toBeNull()
  })

  it('offers the existing names for a selection, which may create or reuse', () => {
    expect(getAutocompleteMode(opt('selectionName', 'str', '', { meta: { role: 'selection' } })))
      .toBe('selections')
  })
})

describe('selections create or reuse', () => {
  const registry = buildRegistryFromYaml(YAML, ROLED)

  it('suggests only the names defined on the same container', () => {
    expect(selectionsFor(registry, 'AnaElectrons').sort()).toEqual(['loose', 'pt50', 'tight'])
    // 'jvt' is the JVT sub-block's default selectionName, defined on AnaJets too.
    expect(selectionsFor(registry, 'AnaJets').sort()).toEqual(['jvt', 'tight'])
  })

  it('accepts a container.selection value, scoping on the container half', () => {
    expect(selectionsFor(registry, 'AnaJets.tight').sort()).toEqual(['jvt', 'tight'])
  })

  it('falls back to every known name when the container is unknown', () => {
    expect(selectionsFor(registry, null).sort()).toEqual(['jvt', 'loose', 'pt50', 'tight'])
  })

  it('de-duplicates a name reused across containers', () => {
    // 'tight' is defined on both AnaJets and AnaElectrons.
    expect(selectionsFor(registry, null).filter(n => n === 'tight')).toHaveLength(1)
  })

  it('is empty, not undefined, for a container with no selections', () => {
    expect(selectionsFor(registry, 'NoSuchContainer')).toEqual([])
    expect(selectionsFor(undefined, 'AnaJets')).toEqual([])
  })

  it('registers a reused name once, on the container it belongs to', () => {
    const reused = {
      ...YAML,
      // A second block writing the same selection on the same container:
      // upstream overwrites the decoration rather than defining a new one.
      PtEtaSelection: [
        { containerName: 'AnaElectrons', selectionName: 'pt50', minPt: 50000 },
        { containerName: 'AnaElectrons', selectionName: 'pt50', minPt: 80000 },
      ],
    }
    const r = buildRegistryFromYaml(reused, ROLED)
    expect(r.selections.filter(s => s.name === 'pt50' && s.container === 'AnaElectrons')).toHaveLength(1)
  })

  it('never reports a brand-new selection name as an undefined reference', () => {
    const fresh = {
      ...YAML,
      PtEtaSelection: { containerName: 'AnaElectrons', selectionName: 'nobodyReferencesThis', minPt: 1 },
    }
    const r = buildRegistryFromYaml(fresh, ROLED)
    const issues = checkDepsFromYaml(fresh, r, ROLED)
    expect(issues.filter(i => i.message.includes('nobodyReferencesThis'))).toEqual([])
  })
})

describe('regions (EventSelection.selectionName)', () => {
  // Upstream has no 'region' role yet; until it does, EventSelection's
  // selectionName is recognised by block + option name so IMPORT can offer a
  // picker.  Everything else keeps its declared role.
  it('is a region only on EventSelection', () => {
    const selectionName = opt('selectionName', 'str', '')
    expect(optionRole(selectionName, { blockName: 'EventSelection' })).toBe('region')
    expect(optionRole(selectionName, { blockName: 'PtEtaSelection' })).toBeNull()
    expect(optionRole(selectionName)).toBeNull()
  })

  it('yields to a role declared upstream', () => {
    const declared = opt('selectionName', 'str', '', { meta: { role: 'selection' } })
    expect(optionRole(declared, { blockName: 'EventSelection' })).toBe('selection')
  })

  it('collects every region defined in the config, de-duplicated and in order', () => {
    const yaml = {
      EventSelection: [
        { selectionName: 'SR', selectionCuts: 'EL_N 25000 >= 1' },
        { selectionName: 'CR', selectionCuts: 'IMPORT SR' },
        { selectionName: 'SR', selectionCuts: 'OS' },
      ],
    }
    expect(buildRegistryFromYaml(yaml, SCHEMA.blocks).regions).toEqual(['SR', 'CR'])
    const config = yamlToConfigSync(yaml, SCHEMA)
    expect(buildRegistryFromState(config, SCHEMA.blocks).regions).toEqual(['SR', 'CR'])
  })

  it('is empty, not undefined, when no region is defined', () => {
    expect(buildRegistryFromYaml({ Jets: [{ containerName: 'AnaJets' }] }, SCHEMA.blocks).regions).toEqual([])
  })

  it('does not make regions look like containers or selections', () => {
    const yaml = { EventSelection: { selectionName: 'SR', selectionCuts: 'OS' } }
    const reg = buildRegistryFromYaml(yaml, SCHEMA.blocks)
    expect(reg.collections.map(c => c.name)).not.toContain('SR')
    expect(reg.withSelections.join()).not.toMatch(/SR/)
  })
})

describe('regions consumed outside EventSelection', () => {
  // A block that RUNS on a region (DiTauMass.eventSelection upstream) declares
  // role 'region' too.  Only EventSelection defines them, so such an option is
  // a reference: it offers the defined names and holds the decoration.
  const consumer = opt('eventSelection', 'str', '', { meta: { role: 'region' } })

  it('offers the defined regions, and does not define one itself', () => {
    expect(getAutocompleteMode(consumer, { blockName: 'DiTauMass' })).toBe('regions')
    // EventSelection's own selectionName creates the region, so it gets no picker
    expect(getAutocompleteMode(opt('selectionName', 'str', ''), { blockName: 'EventSelection' })).toBeNull()
  })

  it('offers them on EventSelection.preselection too, which references one', () => {
    // selectionName defines, preselection references — same block, so the block
    // name alone cannot tell them apart
    const preselection = opt('preselection', 'str', '', { meta: { role: 'region' } })
    expect(getAutocompleteMode(preselection, { blockName: 'EventSelection' })).toBe('regions')

    const blocks = [block('EventSelection', [
      opt('selectionName', 'str', '', { meta: { role: 'region' } }),
      preselection,
      opt('selectionCuts', 'str', ''),
    ], { category: 'Selection' })]
    const yaml = {
      EventSelection: [
        { selectionName: 'SR', selectionCuts: 'OS' },
        { selectionName: 'CR', preselection: regionSelectionExpr('SR'), selectionCuts: 'OS' },
      ],
    }
    // only the two selectionNames are regions; the preselection value is not
    expect(buildRegistryFromYaml(yaml, blocks).regions).toEqual(['SR', 'CR'])
  })

  it('is not registered as a region', () => {
    const blocks = [...SCHEMA.blocks, block('DiTauMass', [consumer], { category: 'Analysis' })]
    const yaml = {
      EventSelection: [{ selectionName: 'SR', selectionCuts: 'OS' }],
      DiTauMass: [{ eventSelection: regionSelectionExpr('SR') }],
    }
    expect(buildRegistryFromYaml(yaml, blocks).regions).toEqual(['SR'])
  })

  it('builds the event filter decoration the algorithms read', () => {
    expect(regionSelectionExpr('SR')).toBe('pass_SR_%SYS%,as_char')
  })

  it('leaves the value unchecked, so combinations are not flagged', () => {
    const blocks = [...SCHEMA.blocks, block('DiTauMass', [consumer], { category: 'Analysis' })]
    const yaml = {
      EventSelection: [{ selectionName: 'SR', selectionCuts: 'OS' }],
      DiTauMass: [{ eventSelection: 'pass_SR_%SYS%,as_char || !pass_CR_%SYS%,as_char' }],
    }
    const reg = buildRegistryFromYaml(yaml, blocks)
    expect(checkDepsFromYaml(yaml, reg, blocks)).toEqual([])
  })
})

describe('registry with declared roles', () => {
  const fromYaml = buildRegistryFromYaml(YAML, ROLED)

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
    const fromState = buildRegistryFromState(yamlToConfigSync(YAML, schemaWith(ROLED)), ROLED)
    expect(fromState).toEqual(fromYaml)
  })

  it('ignores disabled blocks in the builder state', () => {
    const config = yamlToConfigSync(YAML, schemaWith(ROLED))
    config.blocks.Electrons.enabled = false
    const reg = buildRegistryFromState(config, ROLED)
    expect(reg.collections.map(c => c.name)).toEqual(['AnaJets', 'OutJets'])
  })
})

describe('registry without declared roles', () => {
  it('knows only the containers named by a root containerName', () => {
    // No option declares a role, so the containerName bridge is all that is
    // left: it defines containers, and nothing is a reference or a selection.
    const fromYaml = buildRegistryFromYaml(YAML, NO_ROLES)
    expect(fromYaml.collections.map(c => c.name)).toEqual(['AnaJets', 'AnaElectrons'])
    expect(fromYaml.selections).toEqual([])
    expect(fromYaml.withSelections).toEqual([])

    const fromState = buildRegistryFromState(yamlToConfigSync(YAML, schemaWith(NO_ROLES)), NO_ROLES)
    expect(fromState).toEqual(fromYaml)
  })

  it('picks up the roles the plain fixture declares, plus containerName', () => {
    // fixtures/schema.js annotates only JVT.selectionName (selection) and
    // EventSelection.electrons (containerRef); the containers come from the
    // root containerName fallback.
    const reg = buildRegistryFromYaml(YAML, SCHEMA.blocks)
    expect(reg.collections.map(c => c.name)).toEqual(['AnaJets', 'AnaElectrons'])
    expect(reg.withSelections).toEqual(['AnaJets.jvt'])
  })
})

describe('partial upstream annotation (AnalysisBase 25.2.110)', () => {
  // 25.2.110 annotates the blocks that READ a container but not the object
  // blocks that DEFINE one.  Taken literally that makes every `containerName:
  // AnaJets` an undefined reference; the fallback in optionRole is what keeps
  // the GUI quiet until the object blocks are annotated too.
  const AB_110 = mapOptions(SCHEMA.blocks, (o, b) => {
    if (b.name === 'Thinning' && o.name === 'containerName') return withRole(o, 'containerRef')
    if (o.name === 'outputName') return withRole(o, 'container')
    return o
  })

  it('does not report the object containers as undefined', () => {
    const yaml = {
      Jets: [{ containerName: 'AnaJets' }],
      Electrons: { containerName: 'AnaElectrons' },
      Thinning: { containerName: 'AnaJets', outputName: 'OutJets' },
    }
    const registry = buildRegistryFromYaml(yaml, AB_110)
    expect(registry.collections.map(c => c.name)).toEqual(['AnaJets', 'AnaElectrons', 'OutJets'])
    expect(checkDepsFromYaml(yaml, registry, AB_110)).toEqual([])
  })

  it('still reports a container nothing defines', () => {
    const yaml = { Jets: [{ containerName: 'AnaJets' }], Thinning: { containerName: 'NoSuchJets' } }
    const registry = buildRegistryFromYaml(yaml, AB_110)
    const issues = checkDepsFromYaml(yaml, registry, AB_110)
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toMatch(/NoSuchJets/)
  })
})

describe('dependency checker', () => {
  it('flags unknown containers and selections, only on containerRef options', () => {
    const registry = buildRegistryFromYaml(YAML, ROLED)
    const issues = checkDepsFromYaml(YAML, registry, ROLED)
    expect(issues.map(i => `${i.path}:${i.message}`)).toEqual([
      "OverlapRemoval[0].muons:Container 'AnaMuons' is not defined by any enabled block",
      "EventSelection[0].electrons:Selection 'medium' is not defined for container 'AnaElectrons'",
    ])
    expect(issues.every(i => i.kind === 'dependency')).toBe(true)
  })

  it('gives the same answer from the builder state', () => {
    const config = yamlToConfigSync(YAML, schemaWith(ROLED))
    const registry = buildRegistryFromState(config, ROLED)
    expect(checkDepsFromState(config, registry, ROLED)).toHaveLength(2)
  })

  it('warns exactly once for a single unknown container', () => {
    const yaml = { Jets: [{ containerName: 'AnaJets' }], OverlapRemoval: { jets: 'AnaJets', muons: 'AnaMuons' } }
    const registry = buildRegistryFromYaml(yaml, ROLED)
    const issues = checkDepsFromYaml(yaml, registry, ROLED)
    expect(issues).toHaveLength(1)
    expect(issues[0].path).toBe('OverlapRemoval[0].muons')
    expect(issues[0].message).toMatch(/AnaMuons/)
  })

  it('never flags working points or input collection names', () => {
    // Regression: electronID: Tight used to be read as a reference to a
    // container named 'Tight' via the old inferFieldType fallback.
    const yaml = {
      Trigger: { electronID: 'Tight', electronIsol: 'Loose', muonID: 'Medium' },
      Jets: [{ containerName: 'AnaJets', jetCollection: 'AntiKt4EMPFlowJets' }],
    }
    for (const blocks of [ROLED, NO_ROLES]) {
      const registry = buildRegistryFromYaml(yaml, blocks)
      expect(checkDepsFromYaml(yaml, registry, blocks)).toEqual([])
      const config = yamlToConfigSync(yaml, schemaWith(blocks))
      expect(checkDepsFromState(config, buildRegistryFromState(config, blocks), blocks)).toEqual([])
    }
  })

  it('reports nothing at all when no option declares a role', () => {
    const registry = buildRegistryFromYaml(YAML, NO_ROLES)
    expect(checkDepsFromYaml(YAML, registry, NO_ROLES)).toEqual([])
    const config = yamlToConfigSync(YAML, schemaWith(NO_ROLES))
    expect(checkDepsFromState(config, buildRegistryFromState(config, NO_ROLES), NO_ROLES)).toEqual([])
  })

  it('looksLikeContainerRef is conservative', () => {
    expect(looksLikeContainerRef('AnaJets.baselineJvt')).toBe(true)
    expect(looksLikeContainerRef('AnaElectrons.tight_%SYS%')).toBe(true)
    expect(looksLikeContainerRef('True')).toBe(false)
    expect(looksLikeContainerRef('a b')).toBe(false)
    expect(looksLikeContainerRef(5)).toBe(false)
  })
})
