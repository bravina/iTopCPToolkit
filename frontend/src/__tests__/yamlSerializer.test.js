import { describe, it, expect } from 'vitest'
import yaml from 'js-yaml'
import { buildYamlObject, toYamlString, isDefault, usedCustomEntries } from '../utils/yamlSerializer.js'
import { yamlToConfigSync } from '../utils/yamlToConfig.js'
import { initialConfig, emptyInstance } from '../utils/configState.js'
import { customEntryFromCatalogue, effectiveBlocks } from '../utils/schema.js'
import { SCHEMA, CATALOGUE, findBlock } from './fixtures/schema.js'

function enable(config, name, options = {}, subs = {}) {
  const def = findBlock(effectiveBlocks(SCHEMA.blocks, config.addConfigBlocks), name)
  const inst = emptyInstance(def)
  inst.options = options
  for (const [subName, subInstances] of Object.entries(subs)) {
    inst.subBlocks[subName] = { enabled: true, instances: subInstances.map(o => ({ _id: `${subName}-${Math.random()}`, options: o })) }
  }
  config.blocks[name] = { enabled: true, instances: [inst] }
  return inst
}

describe('isDefault', () => {
  it('treats empty as default, compares objects by value, scalars loosely', () => {
    expect(isDefault('', 'x')).toBe(true)
    expect(isDefault(undefined, null)).toBe(true)
    expect(isDefault(false, false)).toBe(true)
    expect(isDefault(true, false)).toBe(false)
    expect(isDefault('5', 5)).toBe(true)
    expect(isDefault([1, 2], [1, 2])).toBe(true)
    expect(isDefault('x', null)).toBe(false)
  })
})

describe('buildYamlObject', () => {
  it('returns {} for empty state and omits disabled blocks', () => {
    expect(buildYamlObject(initialConfig(SCHEMA.blocks), SCHEMA)).toEqual({})
  })

  it('always writes a list, drops default-valued options, keeps explicit non-defaults', () => {
    const config = initialConfig(SCHEMA.blocks)
    enable(config, 'Jets', { containerName: 'AnaJets', minPt: 25000.0, runJvtSelection: false, ptCuts: [] })
    const obj = buildYamlObject(config, SCHEMA)
    expect(Array.isArray(obj.Jets)).toBe(true)
    expect(obj.Jets).toEqual([{ containerName: 'AnaJets', runJvtSelection: false }])
  })

  it('uses the factory-merged default (configName: Output is omitted)', () => {
    const config = initialConfig(SCHEMA.blocks)
    enable(config, 'Output', { configName: 'Output', treeName: 'reco' })
    expect(buildYamlObject(config, SCHEMA).Output).toEqual([{ treeName: 'reco' }])
  })

  it('writes enabled sub-blocks as lists and empty instances as {}', () => {
    const config = initialConfig(SCHEMA.blocks)
    enable(config, 'Jets', { containerName: 'AnaJets' }, { JVT: [{}], PtEtaSelection: [{ minPt: 25000 }, { minPt: 50000, selectionName: 'hi' }] })
    const obj = buildYamlObject(config, SCHEMA)
    expect(obj.Jets[0].JVT).toEqual([{}])
    expect(obj.Jets[0].PtEtaSelection).toEqual([{ minPt: 25000 }, { minPt: 50000, selectionName: 'hi' }])
  })

  it('keeps unknown options and unknown blocks verbatim', () => {
    const config = initialConfig(SCHEMA.blocks)
    enable(config, 'Jets', { containerName: 'AnaJets', mysteryOption: 42 })
    config.unknown.NotABlock = { foo: 'bar' }
    const obj = buildYamlObject(config, SCHEMA)
    expect(obj.Jets[0].mysteryOption).toBe(42)
    expect(obj.NotABlock).toEqual({ foo: 'bar' })
  })

  it('emits AddConfigBlocks first and only for custom blocks in use', () => {
    const config = initialConfig(SCHEMA.blocks)
    const used = customEntryFromCatalogue(CATALOGUE[0])
    const unused = customEntryFromCatalogue({ ...CATALOGUE[0], algName: 'Unused' })
    config.addConfigBlocks = [used, unused]
    config.blocks.Tutorial = { enabled: true, instances: [emptyInstance(CATALOGUE[0].block)] }
    config.blocks.Unused = { enabled: false, instances: [emptyInstance(CATALOGUE[0].block)] }
    enable(config, 'CommonServices', { runSystematics: false })
    expect(usedCustomEntries(config).map(e => e.algName)).toEqual(['Tutorial'])
    const obj = buildYamlObject(config, SCHEMA)
    expect(Object.keys(obj)[0]).toBe('AddConfigBlocks')
    expect(obj.AddConfigBlocks).toEqual([{ modulePath: 'TopCPToolkit.TutorialConfig',
      functionName: 'TutorialConfig', algName: 'Tutorial', pos: 'Output' }])
    expect(obj.Tutorial).toEqual([{}])
  })

  it('emits AddConfigBlocks for a custom sub-block enabled inside a parent', () => {
    const config = initialConfig(SCHEMA.blocks)
    const sub = customEntryFromCatalogue({ ...CATALOGUE[0], algName: 'JetTutorial', superBlocks: 'Jets' })
    config.addConfigBlocks = [sub]
    enable(config, 'Jets', { containerName: 'AnaJets' }, { JetTutorial: [{ tutorialOption: 7 }] })
    const obj = buildYamlObject(config, SCHEMA)
    expect(obj.AddConfigBlocks[0].superBlocks).toBe('Jets')
    expect(obj.Jets[0].JetTutorial).toEqual([{ tutorialOption: 7 }])
  })
})

describe('toYamlString', () => {
  it('produces valid YAML that parses back to the object', () => {
    const config = initialConfig(SCHEMA.blocks)
    enable(config, 'Jets', { containerName: 'AnaJets', jetCollection: 'AntiKt4EMPFlowJets' }, { JVT: [{}] })
    enable(config, 'EventSelection', { selectionName: 'ejets', selectionCuts: 'EL_N 25000 >= 1\nJET_N 25000 >= 4' })
    const text = toYamlString(config, SCHEMA)
    expect(yaml.load(text)).toEqual(buildYamlObject(config, SCHEMA))
    expect(text).not.toMatch(/SAVE/)
  })

  it('round-trips through yamlToConfigSync', () => {
    const config = initialConfig(SCHEMA.blocks)
    enable(config, 'Jets', { containerName: 'AnaJets' }, { PtEtaSelection: [{ minPt: 20000 }] })
    enable(config, 'Output', { vars: ['a', 'b'], metaConfig: { k: 1 } })
    config.unknown.Weird = [{ x: 1 }]
    const obj = buildYamlObject(config, SCHEMA)
    const back = yamlToConfigSync(obj, SCHEMA)
    expect(buildYamlObject(back, SCHEMA)).toEqual(obj)
  })
})
