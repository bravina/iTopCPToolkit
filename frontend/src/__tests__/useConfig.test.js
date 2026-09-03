import { describe, it, expect } from 'vitest'
import { _historyReducer as reduce, _emptyHistory } from '../hooks/useConfig.js'
import { customEntryFromCatalogue } from '../utils/schema.js'
import { SCHEMA, CATALOGUE, findBlock } from './fixtures/schema.js'

function run(...actions) {
  return actions.reduce((h, a) => reduce(h, a), _emptyHistory)
}
const init = { type: 'INIT', blocks: SCHEMA.blocks }

describe('useConfig reducer', () => {
  it('INIT creates every block disabled with one instance', () => {
    const h = run(init)
    expect(Object.keys(h.present.blocks)).toEqual(SCHEMA.blocks.map(b => b.name))
    expect(h.present.blocks.Jets.enabled).toBe(false)
    expect(Object.keys(h.present.blocks.Jets.instances[0].subBlocks)).toEqual(['JVT', 'PtEtaSelection'])
    expect(h.past).toEqual([])
  })

  it('instances can always be added and never drop below one', () => {
    let h = run(init, { type: 'ADD_INSTANCE', blockName: 'CommonServices', blockDef: findBlock(SCHEMA.blocks, 'CommonServices') })
    expect(h.present.blocks.CommonServices.instances).toHaveLength(2)
    const [a, b] = h.present.blocks.CommonServices.instances
    h = reduce(h, { type: 'REMOVE_INSTANCE', blockName: 'CommonServices', instanceId: a._id })
    h = reduce(h, { type: 'REMOVE_INSTANCE', blockName: 'CommonServices', instanceId: b._id })
    expect(h.present.blocks.CommonServices.instances).toHaveLength(1)
  })

  it('sub-block toggling works even for sub-blocks added after the instance existed', () => {
    let h = run(init)
    const inst = h.present.blocks.Jets.instances[0]
    h = reduce(h, { type: 'TOGGLE_SUB_BLOCK', blockName: 'Jets', instanceId: inst._id, subName: 'LateCustom' })
    expect(h.present.blocks.Jets.instances[0].subBlocks.LateCustom.enabled).toBe(true)
    expect(h.present.blocks.Jets.instances[0].subBlocks.LateCustom.instances).toHaveLength(1)
  })

  it('undo/redo with coalescing of consecutive edits to the same option', () => {
    let h = run(init, { type: 'TOGGLE_BLOCK', name: 'Jets' })
    const id = h.present.blocks.Jets.instances[0]._id
    h = reduce(h, { type: 'SET_OPTION', blockName: 'Jets', instanceId: id, key: 'containerName', value: 'A' })
    h = reduce(h, { type: 'SET_OPTION', blockName: 'Jets', instanceId: id, key: 'containerName', value: 'An' })
    h = reduce(h, { type: 'SET_OPTION', blockName: 'Jets', instanceId: id, key: 'containerName', value: 'Ana' })
    expect(h.past).toHaveLength(2)  // toggle + first keystroke; the rest coalesced
    h = reduce(h, { type: 'UNDO' })
    expect(h.present.blocks.Jets.instances[0].options.containerName).toBeUndefined()
    expect(h.present.blocks.Jets.enabled).toBe(true)
    h = reduce(h, { type: 'REDO' })
    expect(h.present.blocks.Jets.instances[0].options.containerName).toBe('Ana')
    h = reduce(h, { type: 'UNDO' })
    h = reduce(h, { type: 'UNDO' })
    expect(h.present.blocks.Jets.enabled).toBe(false)
    expect(reduce(h, { type: 'UNDO' })).toBe(h)
  })

  it('no-op actions do not create history entries', () => {
    const h = run(init)
    expect(reduce(h, { type: 'TOGGLE_BLOCK', name: 'Nope' })).toBe(h)
    expect(reduce(h, { type: 'BOGUS' })).toBe(h)
  })

  it('custom blocks: add creates enabled root state, remove cleans up', () => {
    const entry = customEntryFromCatalogue(CATALOGUE[0])
    let h = run(init, { type: 'ADD_CUSTOM_BLOCK', entry })
    expect(h.present.addConfigBlocks).toEqual([entry])
    expect(h.present.blocks.Tutorial.enabled).toBe(true)
    expect(reduce(h, { type: 'ADD_CUSTOM_BLOCK', entry: { ...entry, id: 'other' } })).toBe(h)
    h = reduce(h, { type: 'REMOVE_CUSTOM_BLOCK', id: entry.id })
    expect(h.present.addConfigBlocks).toEqual([])
    expect(h.present.blocks.Tutorial).toBeUndefined()
  })

  it('custom sub-blocks: remove strips state from parent instances', () => {
    const entry = customEntryFromCatalogue({ ...CATALOGUE[0], algName: 'JetTut', superBlocks: 'Jets' })
    let h = run(init, { type: 'ADD_CUSTOM_BLOCK', entry })
    expect(h.present.blocks.JetTut).toBeUndefined()
    const id = h.present.blocks.Jets.instances[0]._id
    h = reduce(h, { type: 'TOGGLE_SUB_BLOCK', blockName: 'Jets', instanceId: id, subName: 'JetTut' })
    expect(h.present.blocks.Jets.instances[0].subBlocks.JetTut.enabled).toBe(true)
    h = reduce(h, { type: 'REMOVE_CUSTOM_BLOCK', id: entry.id })
    expect(h.present.blocks.Jets.instances[0].subBlocks.JetTut).toBeUndefined()
  })

  it('LOAD replaces state and clears history', () => {
    let h = run(init, { type: 'TOGGLE_BLOCK', name: 'Jets' })
    h = reduce(h, { type: 'LOAD', state: { addConfigBlocks: [], blocks: {}, unknown: { X: 1 } } })
    expect(h.past).toEqual([])
    expect(h.present.unknown).toEqual({ X: 1 })
    h = reduce(h, { type: 'REMOVE_UNKNOWN_BLOCK', name: 'X' })
    expect(h.present.unknown).toEqual({})
  })
})
