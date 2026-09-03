import { describe, it, expect } from 'vitest'
import {
  effectiveBlocks, categorize, labelFor, customEntryFromCatalogue, customEntryToBlock,
  optionsByOrigin, isRequiredOption, isExpertOption, isGenericOption, optionChoices, opaqueBlock,
} from '../utils/schema.js'
import { buildSchemaLookup } from '../utils/schemaLookup.js'
import { SCHEMA, CATALOGUE, findBlock } from './fixtures/schema.js'

describe('labelFor', () => {
  it('splits CamelCase and underscores like the backend', () => {
    expect(labelFor('PileupReweighting')).toBe('Pileup Reweighting')
    expect(labelFor('PL_Jets')).toBe('PL Jets')
    expect(labelFor('MissingET')).toBe('Missing ET')
    expect(labelFor('JVT')).toBe('JVT')
  })
})

describe('effectiveBlocks', () => {
  it('returns the base blocks untouched when there are no custom entries', () => {
    const blocks = effectiveBlocks(SCHEMA.blocks, [])
    expect(blocks.map(b => b.name)).toEqual(SCHEMA.blocks.map(b => b.name))
    expect(blocks).not.toBe(SCHEMA.blocks)
  })

  it('appends root custom blocks and attaches sub-block customs under their parents', () => {
    const root = customEntryFromCatalogue(CATALOGUE[0])
    const sub = customEntryFromCatalogue({ ...CATALOGUE[0], algName: 'JetTutorial', superBlocks: ['Jets', 'Electrons'] })
    const blocks = effectiveBlocks(SCHEMA.blocks, [root, sub])
    const tut = findBlock(blocks, 'Tutorial')
    expect(tut.custom).toBe(true)
    expect(tut.customId).toBe(root.id)
    expect(tut.category).toBe('TopCPToolkit')
    const jetsSub = findBlock(blocks, 'Jets').subBlocks.find(s => s.name === 'JetTutorial')
    expect(jetsSub.factoryName).toBe('Jets.JetTutorial')
    expect(jetsSub.parents).toEqual(['Jets', 'Electrons'])
    expect(findBlock(blocks, 'Electrons').subBlocks.some(s => s.name === 'JetTutorial')).toBe(true)
    // base schema not mutated
    expect(findBlock(SCHEMA.blocks, 'Jets').subBlocks.some(s => s.name === 'JetTutorial')).toBe(false)
    expect(findBlock(SCHEMA.blocks, 'Tutorial')).toBeUndefined()
  })

  it('uses an opaque placeholder when the entry has no introspected block', () => {
    const entry = customEntryFromCatalogue({ modulePath: 'X.Y', functionName: 'Z', algName: 'Mystery' })
    const blk = customEntryToBlock(entry)
    expect(blk.opaque).toBe(true)
    expect(blk.options).toEqual([])
    expect(opaqueBlock(entry).error).toMatch(/could not be introspected/)
  })
})

describe('buildSchemaLookup', () => {
  it('indexes options and sub-blocks and always knows AddConfigBlocks', () => {
    const lookup = buildSchemaLookup(SCHEMA.blocks)
    expect(lookup.Jets.optionsByName.minPt.type).toBe('float')
    expect(lookup.Jets.subBlocksByName.JVT.optionsByName.selectionName.default).toBe('jvt')
    expect(lookup.AddConfigBlocks.optionsByName.modulePath.required).toBe(true)
  })
})

describe('categorize', () => {
  it('groups blocks in category order and appends unknown categories', () => {
    const blocks = [...SCHEMA.blocks, { name: 'Odd', category: 'Weird' }, { name: 'NoCat' }]
    const groups = categorize(blocks, SCHEMA.categories)
    expect(groups.map(g => g.category)).toEqual(['Core', 'Objects', 'Selection', 'Output', 'Others', 'Weird'])
    expect(groups.find(g => g.category === 'Others').blocks.map(b => b.name)).toEqual(['NoCat'])
  })
})

describe('option helpers', () => {
  const jets = findBlock(SCHEMA.blocks, 'Jets')
  it('predicates', () => {
    const byName = Object.fromEntries(jets.options.map(o => [o.name, o]))
    expect(isRequiredOption(byName.containerName)).toBe(true)
    expect(isRequiredOption(byName.minPt)).toBe(false)
    expect(isGenericOption(byName.skipOnData)).toBe(true)
    expect(isExpertOption(byName.propertyOverrides)).toBe(true)
    expect(optionChoices(byName.systematicsModelJES)).toEqual(['All', 'Category'])
    expect(optionChoices(byName.minPt)).toBeNull()
  })
  it('optionsByOrigin groups non-generic options by declaring class in order', () => {
    const groups = optionsByOrigin(jets)
    expect(groups.map(g => g.origin)).toEqual(['PreJets', 'SmallRJets', 'LargeRJets'])
    expect(groups.flatMap(g => g.options).some(o => o.generic)).toBe(false)
  })
})
