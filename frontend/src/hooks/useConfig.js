/**
 * useConfig.js
 *
 * useReducer-based store for the builder state (see utils/configState.js for
 * the shape) with undo/redo.  Consecutive edits of the same option are
 * coalesced into one history entry so typing does not produce one undo step
 * per keystroke.
 */

import { useReducer, useMemo } from 'react'
import {
  emptyBlockState, emptyInstance, emptySubInstance, emptySubState, initialConfig,
} from '../utils/configState.js'
import { customEntryToBlock, superBlockList } from '../utils/schema.js'

const HISTORY_LIMIT = 100

// ── Core reducer on the "present" state ───────────────────────────────────────

function updateBlock(state, blockName, fn) {
  const block = state.blocks[blockName]
  if (!block) return state
  return { ...state, blocks: { ...state.blocks, [blockName]: fn(block) } }
}

function updateInstance(state, blockName, instanceId, fn) {
  return updateBlock(state, blockName, block => ({
    ...block,
    instances: block.instances.map(inst => (inst._id === instanceId ? fn(inst) : inst)),
  }))
}

function updateSub(state, blockName, instanceId, subName, fn) {
  return updateInstance(state, blockName, instanceId, inst => ({
    ...inst,
    subBlocks: { ...inst.subBlocks, [subName]: fn(inst.subBlocks?.[subName] ?? emptySubState()) },
  }))
}

function reducer(state, action) {
  switch (action.type) {

    case 'INIT':
      return initialConfig(action.blocks)

    case 'LOAD':
      return action.state

    // An AI proposal: every operation replayed onto `present`, so the history
    // wrapper below records the whole set as a single undoable entry.
    case 'APPLY_OPS':
      return (action.actions || []).reduce((s, a) => reducer(s, a), state)

    case 'TOGGLE_BLOCK':
      return updateBlock(state, action.name, b => ({ ...b, enabled: !b.enabled }))

    case 'SET_BLOCK_ENABLED':
      return updateBlock(state, action.name, b => ({ ...b, enabled: !!action.enabled }))

    case 'SET_OPTION':
      return updateInstance(state, action.blockName, action.instanceId, inst => ({
        ...inst, options: { ...inst.options, [action.key]: action.value },
      }))

    case 'UNSET_OPTION':
      return updateInstance(state, action.blockName, action.instanceId, inst => {
        const options = { ...inst.options }
        delete options[action.key]
        return { ...inst, options }
      })

    case 'ADD_INSTANCE':
      return updateBlock(state, action.blockName, b => ({
        ...b, instances: [...b.instances, emptyInstance(action.blockDef)],
      }))

    case 'REMOVE_INSTANCE':
      return updateBlock(state, action.blockName, b => {
        const instances = b.instances.filter(i => i._id !== action.instanceId)
        return { ...b, instances: instances.length ? instances : b.instances }
      })

    case 'TOGGLE_SUB_BLOCK':
      return updateSub(state, action.blockName, action.instanceId, action.subName,
        sub => ({ ...sub, enabled: !sub.enabled }))

    case 'SET_SUB_OPTION':
      return updateSub(state, action.blockName, action.instanceId, action.subName, sub => ({
        ...sub,
        instances: sub.instances.map(si =>
          si._id === action.subInstanceId
            ? { ...si, options: { ...si.options, [action.key]: action.value } }
            : si),
      }))

    case 'ADD_SUB_INSTANCE':
      return updateSub(state, action.blockName, action.instanceId, action.subName,
        sub => ({ ...sub, instances: [...sub.instances, emptySubInstance()] }))

    case 'REMOVE_SUB_INSTANCE':
      return updateSub(state, action.blockName, action.instanceId, action.subName, sub => {
        const instances = sub.instances.filter(si => si._id !== action.subInstanceId)
        return { ...sub, instances: instances.length ? instances : sub.instances }
      })

    case 'ADD_CUSTOM_BLOCK': {
      const entry = action.entry
      if (state.addConfigBlocks.some(e => e.algName === entry.algName)) return state
      const next = { ...state, addConfigBlocks: [...state.addConfigBlocks, entry] }
      if (superBlockList(entry.superBlocks).length === 0) {
        if (state.blocks[entry.algName]) return state
        next.blocks = { ...state.blocks, [entry.algName]: emptyBlockState(customEntryToBlock(entry), true) }
      }
      return next
    }

    case 'REMOVE_CUSTOM_BLOCK': {
      const entry = state.addConfigBlocks.find(e => e.id === action.id)
      if (!entry) return state
      const next = { ...state, addConfigBlocks: state.addConfigBlocks.filter(e => e.id !== action.id) }
      const parents = superBlockList(entry.superBlocks)
      if (parents.length === 0) {
        next.blocks = { ...state.blocks }
        delete next.blocks[entry.algName]
      } else {
        next.blocks = { ...state.blocks }
        for (const p of parents) {
          if (!next.blocks[p]) continue
          next.blocks[p] = {
            ...next.blocks[p],
            instances: next.blocks[p].instances.map(inst => {
              const subBlocks = { ...inst.subBlocks }
              delete subBlocks[entry.algName]
              return { ...inst, subBlocks }
            }),
          }
        }
      }
      return next
    }

    case 'REMOVE_UNKNOWN_BLOCK': {
      const unknown = { ...state.unknown }
      delete unknown[action.name]
      return { ...state, unknown }
    }

    default:
      return state
  }
}

// ── History wrapper ───────────────────────────────────────────────────────────

const RESET_ACTIONS = new Set(['INIT', 'LOAD'])
const COALESCE_ACTIONS = new Set(['SET_OPTION', 'SET_SUB_OPTION'])

function coalesceKey(action) {
  if (!COALESCE_ACTIONS.has(action.type)) return null
  return [action.type, action.blockName, action.instanceId, action.subName, action.subInstanceId, action.key].join('|')
}

function historyReducer(h, action) {
  if (action.type === 'UNDO') {
    if (!h.past.length) return h
    return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1],
             future: [h.present, ...h.future], lastKey: null }
  }
  if (action.type === 'REDO') {
    if (!h.future.length) return h
    return { past: [...h.past, h.present], present: h.future[0],
             future: h.future.slice(1), lastKey: null }
  }
  const present = reducer(h.present, action)
  if (present === h.present) return h
  if (RESET_ACTIONS.has(action.type)) return { past: [], present, future: [], lastKey: null }
  const key = coalesceKey(action)
  if (key && key === h.lastKey) return { ...h, present, future: [] }
  return {
    past: [...h.past.slice(-(HISTORY_LIMIT - 1)), h.present],
    present, future: [], lastKey: key,
  }
}

const EMPTY_HISTORY = { past: [], present: initialConfig([]), future: [], lastKey: null }

export function useConfig() {
  const [history, dispatch] = useReducer(historyReducer, EMPTY_HISTORY)

  const actions = useMemo(() => ({
    init: (blocks) => dispatch({ type: 'INIT', blocks }),
    load: (state) => dispatch({ type: 'LOAD', state }),
    applyOps: (actions) => dispatch({ type: 'APPLY_OPS', actions }),
    toggleBlock: (name) => dispatch({ type: 'TOGGLE_BLOCK', name }),
    setBlockEnabled: (name, enabled) => dispatch({ type: 'SET_BLOCK_ENABLED', name, enabled }),
    setOption: (blockName, instanceId, key, value) =>
      dispatch({ type: 'SET_OPTION', blockName, instanceId, key, value }),
    unsetOption: (blockName, instanceId, key) =>
      dispatch({ type: 'UNSET_OPTION', blockName, instanceId, key }),
    addInstance: (blockName, blockDef) => dispatch({ type: 'ADD_INSTANCE', blockName, blockDef }),
    removeInstance: (blockName, instanceId) => dispatch({ type: 'REMOVE_INSTANCE', blockName, instanceId }),
    toggleSubBlock: (blockName, instanceId, subName) =>
      dispatch({ type: 'TOGGLE_SUB_BLOCK', blockName, instanceId, subName }),
    setSubOption: (blockName, instanceId, subName, subInstanceId, key, value) =>
      dispatch({ type: 'SET_SUB_OPTION', blockName, instanceId, subName, subInstanceId, key, value }),
    addSubInstance: (blockName, instanceId, subName) =>
      dispatch({ type: 'ADD_SUB_INSTANCE', blockName, instanceId, subName }),
    removeSubInstance: (blockName, instanceId, subName, subInstanceId) =>
      dispatch({ type: 'REMOVE_SUB_INSTANCE', blockName, instanceId, subName, subInstanceId }),
    addCustomBlock: (entry) => dispatch({ type: 'ADD_CUSTOM_BLOCK', entry }),
    removeCustomBlock: (id) => dispatch({ type: 'REMOVE_CUSTOM_BLOCK', id }),
    removeUnknownBlock: (name) => dispatch({ type: 'REMOVE_UNKNOWN_BLOCK', name }),
    undo: () => dispatch({ type: 'UNDO' }),
    redo: () => dispatch({ type: 'REDO' }),
  }), [])

  return {
    config: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    ...actions,
  }
}

// Exported for tests
export const _reducer = reducer
export const _historyReducer = historyReducer
export const _emptyHistory = EMPTY_HISTORY
