import { useReducer, useCallback } from 'react'
import { v4 as uuid } from 'uuid'

function emptySubInstance() {
  return { _id: uuid(), options: {} }
}

function emptyInstance(blockDef) {
  return {
    _id: uuid(),
    options: {},
    sub_blocks: Object.fromEntries(
      (blockDef.sub_blocks || []).map(sb => [
        sb.name,
        { enabled: false, instances: [emptySubInstance()] },
      ])
    ),
  }
}

function initialState(schema) {
  const state = {}
  for (const block of schema) {
    state[block.name] = {
      enabled: false,
      instances: [emptyInstance(block)],
    }
  }
  return state
}

function reducer(state, action) {
  switch (action.type) {

    case 'INIT':
      return initialState(action.schema)

    case 'TOGGLE_BLOCK': {
      const { name } = action
      return { ...state, [name]: { ...state[name], enabled: !state[name].enabled } }
    }

    case 'SET_OPTION': {
      const { blockName, instanceId, key, value } = action
      const block = state[blockName]
      return {
        ...state,
        [blockName]: {
          ...block,
          instances: block.instances.map(inst =>
            inst._id === instanceId
              ? { ...inst, options: { ...inst.options, [key]: value } }
              : inst
          ),
        },
      }
    }

    case 'ADD_INSTANCE': {
      const { blockName, blockDef } = action
      const block = state[blockName]
      return {
        ...state,
        [blockName]: { ...block, instances: [...block.instances, emptyInstance(blockDef)] },
      }
    }

    case 'REMOVE_INSTANCE': {
      const { blockName, instanceId } = action
      const block = state[blockName]
      const instances = block.instances.filter(i => i._id !== instanceId)
      return { ...state, [blockName]: { ...block, instances: instances.length ? instances : block.instances } }
    }

    case 'TOGGLE_SUB_BLOCK': {
      const { blockName, instanceId, subName } = action
      const block = state[blockName]
      return {
        ...state,
        [blockName]: {
          ...block,
          instances: block.instances.map(inst => {
            if (inst._id !== instanceId) return inst
            const sub = inst.sub_blocks[subName]
            return { ...inst, sub_blocks: { ...inst.sub_blocks, [subName]: { ...sub, enabled: !sub.enabled } } }
          }),
        },
      }
    }

    case 'SET_SUB_OPTION': {
      const { blockName, instanceId, subName, subInstanceId, key, value } = action
      const block = state[blockName]
      return {
        ...state,
        [blockName]: {
          ...block,
          instances: block.instances.map(inst => {
            if (inst._id !== instanceId) return inst
            const sub = inst.sub_blocks[subName]
            return {
              ...inst,
              sub_blocks: {
                ...inst.sub_blocks,
                [subName]: {
                  ...sub,
                  instances: sub.instances.map(si =>
                    si._id === subInstanceId
                      ? { ...si, options: { ...si.options, [key]: value } }
                      : si
                  ),
                },
              },
            }
          }),
        },
      }
    }

    case 'ADD_SUB_INSTANCE': {
      const { blockName, instanceId, subName } = action
      const block = state[blockName]
      return {
        ...state,
        [blockName]: {
          ...block,
          instances: block.instances.map(inst => {
            if (inst._id !== instanceId) return inst
            const sub = inst.sub_blocks[subName]
            return {
              ...inst,
              sub_blocks: {
                ...inst.sub_blocks,
                [subName]: { ...sub, instances: [...sub.instances, emptySubInstance()] },
              },
            }
          }),
        },
      }
    }

    case 'REMOVE_SUB_INSTANCE': {
      const { blockName, instanceId, subName, subInstanceId } = action
      const block = state[blockName]
      return {
        ...state,
        [blockName]: {
          ...block,
          instances: block.instances.map(inst => {
            if (inst._id !== instanceId) return inst
            const sub = inst.sub_blocks[subName]
            const instances = sub.instances.filter(si => si._id !== subInstanceId)
            return {
              ...inst,
              sub_blocks: {
                ...inst.sub_blocks,
                [subName]: { ...sub, instances: instances.length ? instances : sub.instances },
              },
            }
          }),
        },
      }
    }

    default:
      return state
  }
}

export function useConfig() {
  const [config, dispatch] = useReducer(reducer, {})

  const init = useCallback((schema) => dispatch({ type: 'INIT', schema }), [])
  const toggleBlock = useCallback((name) => dispatch({ type: 'TOGGLE_BLOCK', name }), [])
  const setOption = useCallback((blockName, instanceId, key, value) =>
    dispatch({ type: 'SET_OPTION', blockName, instanceId, key, value }), [])
  const addInstance = useCallback((blockName, blockDef) =>
    dispatch({ type: 'ADD_INSTANCE', blockName, blockDef }), [])
  const removeInstance = useCallback((blockName, instanceId) =>
    dispatch({ type: 'REMOVE_INSTANCE', blockName, instanceId }), [])
  const toggleSubBlock = useCallback((blockName, instanceId, subName) =>
    dispatch({ type: 'TOGGLE_SUB_BLOCK', blockName, instanceId, subName }), [])
  const setSubOption = useCallback((blockName, instanceId, subName, subInstanceId, key, value) =>
    dispatch({ type: 'SET_SUB_OPTION', blockName, instanceId, subName, subInstanceId, key, value }), [])
  const addSubInstance = useCallback((blockName, instanceId, subName) =>
    dispatch({ type: 'ADD_SUB_INSTANCE', blockName, instanceId, subName }), [])
  const removeSubInstance = useCallback((blockName, instanceId, subName, subInstanceId) =>
    dispatch({ type: 'REMOVE_SUB_INSTANCE', blockName, instanceId, subName, subInstanceId }), [])

  return {
    config,
    init,
    toggleBlock,
    setOption,
    addInstance,
    removeInstance,
    toggleSubBlock,
    setSubOption,
    addSubInstance,
    removeSubInstance,
  }
}
