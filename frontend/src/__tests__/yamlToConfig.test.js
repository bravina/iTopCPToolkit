import { describe, it, expect } from 'vitest'
import {
  yamlToConfigSync, yamlToConfig, normalizeAddConfigBlocks, normalizeInstances, isValidEntry,
} from '../utils/yamlToConfig.js'
import { SCHEMA } from './fixtures/schema.js'

describe('normalizeAddConfigBlocks', () => {
  it('accepts the list form and the dict form', () => {
    const list = normalizeAddConfigBlocks([{ modulePath: 'a', functionName: 'b', algName: 'c', pos: 'Output' }])
    const dict = normalizeAddConfigBlocks({ c: { modulePath: 'a', functionName: 'b', pos: 'Output' } })
    expect(list).toEqual(dict)
    expect(list[0].superBlocks).toBeNull()
    expect(normalizeAddConfigBlocks(null)).toEqual([])
    expect(normalizeAddConfigBlocks('nope')).toEqual([])
  })
  it('isValidEntry requires the three mandatory keys', () => {
    expect(isValidEntry({ modulePath: 'a', functionName: 'b', algName: 'c' })).toBe(true)
    expect(isValidEntry({ modulePath: 'a', algName: 'c' })).toBe(false)
  })
})

describe('normalizeInstances', () => {
  it('handles null, dict, list and junk', () => {
    expect(normalizeInstances(null)).toEqual([{}])
    expect(normalizeInstances({ a: 1 })).toEqual([{ a: 1 }])
    expect(normalizeInstances([{ a: 1 }, 'junk', null])).toEqual([{ a: 1 }, {}, {}])
    expect(normalizeInstances(5)).toEqual([{}])
  })
})

describe('yamlToConfigSync', () => {
  it('enables present blocks, keeps the rest disabled, converts dict/list/null forms', () => {
    const config = yamlToConfigSync({
      Jets: [{ containerName: 'AnaJets', JVT: {}, PtEtaSelection: [{ minPt: 1 }, { minPt: 2 }] }],
      Electrons: { containerName: 'AnaElectrons' },
      CommonServices: null,
    }, SCHEMA)
    expect(config.blocks.Jets.enabled).toBe(true)
    expect(config.blocks.Output.enabled).toBe(false)
    expect(config.blocks.CommonServices.instances).toHaveLength(1)
    const jets = config.blocks.Jets.instances[0]
    expect(jets.options).toEqual({ containerName: 'AnaJets' })
    expect(jets.subBlocks.JVT.enabled).toBe(true)
    expect(jets.subBlocks.JVT.instances).toHaveLength(1)
    expect(jets.subBlocks.PtEtaSelection.instances.map(i => i.options.minPt)).toEqual([1, 2])
    expect(config.blocks.Electrons.instances[0].subBlocks.WorkingPoint.enabled).toBe(false)
    expect(config.addConfigBlocks).toEqual([])
    expect(config.unknown).toEqual({})
  })

  it('preserves unknown blocks and unknown options', () => {
    const config = yamlToConfigSync({ Mystery: { a: 1 }, Jets: { containerName: 'X', notAnOption: true } }, SCHEMA)
    expect(config.unknown).toEqual({ Mystery: { a: 1 } })
    expect(config.blocks.Mystery).toBeUndefined()
    expect(config.blocks.Jets.instances[0].options.notAnOption).toBe(true)
  })

  it('resolves AddConfigBlocks through the catalogue', () => {
    const config = yamlToConfigSync({
      AddConfigBlocks: [{ modulePath: 'TopCPToolkit.TutorialConfig', functionName: 'TutorialConfig', algName: 'MyTut', pos: 'Output' }],
      MyTut: { tutorialOption: 9 },
    }, SCHEMA)
    expect(config.addConfigBlocks).toHaveLength(1)
    expect(config.addConfigBlocks[0].block.opaque).toBeUndefined()
    expect(config.blocks.MyTut.enabled).toBe(true)
    expect(config.blocks.MyTut.instances[0].options.tutorialOption).toBe(9)
    expect(config.unknown).toEqual({})
  })

  it('marks entries missing from the catalogue as opaque, but still keeps their block', () => {
    const config = yamlToConfigSync({
      AddConfigBlocks: { Custom: { modulePath: 'My.Module', functionName: 'CustomConfig' } },
      Custom: { foo: 1 },
    }, SCHEMA)
    expect(config.addConfigBlocks[0].block.opaque).toBe(true)
    expect(config.blocks.Custom.enabled).toBe(true)
    expect(config.blocks.Custom.instances[0].options.foo).toBe(1)
  })
})

describe('yamlToConfig (async resolution)', () => {
  const yamlObj = {
    AddConfigBlocks: [{ modulePath: 'My.Module', functionName: 'CustomConfig', algName: 'Custom', superBlocks: 'Jets' }],
    Jets: { containerName: 'AnaJets', Custom: { foo: 1 } },
  }

  it('calls the resolver for unknown entries and attaches sub-block customs to parents', async () => {
    const seen = []
    const config = await yamlToConfig(yamlObj, SCHEMA, async (entry) => {
      seen.push(entry.algName)
      return { name: 'Custom', kind: 'class', options: [{ name: 'foo', type: 'int', default: 0 }], subBlocks: [], dependencies: [] }
    })
    expect(seen).toEqual(['Custom'])
    expect(config.addConfigBlocks[0].block.opaque).toBeUndefined()
    const jets = config.blocks.Jets.instances[0]
    expect(jets.subBlocks.Custom.enabled).toBe(true)
    expect(jets.subBlocks.Custom.instances[0].options).toEqual({ foo: 1 })
    expect(jets.options.Custom).toBeUndefined()
  })

  it('falls back to opaque when the resolver fails', async () => {
    const config = await yamlToConfig(yamlObj, SCHEMA, async () => { throw new Error('nope') })
    expect(config.addConfigBlocks[0].block.opaque).toBe(true)
    expect(config.addConfigBlocks[0].block.error).toMatch(/nope/)
  })
})
