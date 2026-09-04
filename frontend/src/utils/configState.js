/**
 * configState.js
 *
 * Shape of the builder state and the helpers that create empty pieces of it.
 * Shared by useConfig (live editing) and yamlToConfig (import) so the two can
 * never disagree about the structure.
 *
 *   {
 *     addConfigBlocks: [ { id, modulePath, functionName, algName, pos, superBlocks, block } ],
 *     blocks: {
 *       [algName]: {
 *         enabled: bool,
 *         instances: [ { _id, options: {…}, subBlocks: { [subName]: { enabled, instances: [ { _id, options } ] } } } ],
 *       },
 *     },
 *     unknown: { [blockName]: rawYamlValue },   // blocks not in the schema, kept verbatim
 *   }
 *
 * Every block may have several instances (Athena accepts a list for any
 * block); the YAML serializer writes a list, except that a single fully
 * default instance is written as `Block: {}`.
 */

import { v4 as uuid } from 'uuid'

export function emptySubInstance() {
  return { _id: uuid(), options: {} }
}

export function emptySubState() {
  return { enabled: false, instances: [emptySubInstance()] }
}

export function emptyInstance(blockDef) {
  return {
    _id: uuid(),
    options: {},
    subBlocks: Object.fromEntries(
      (blockDef?.subBlocks || []).map(sb => [sb.name, emptySubState()])
    ),
  }
}

export function emptyBlockState(blockDef, enabled = false) {
  return { enabled, instances: [emptyInstance(blockDef)] }
}

export function emptyConfig() {
  return { addConfigBlocks: [], blocks: {}, unknown: {} }
}

/** Fresh state with every schema block present and disabled. */
export function initialConfig(blocks) {
  const config = emptyConfig()
  for (const b of blocks || []) config.blocks[b.name] = emptyBlockState(b)
  return config
}

/** Sub-block state of an instance, tolerating sub-blocks added after the instance was created. */
export function getSubState(inst, subName) {
  return inst?.subBlocks?.[subName] ?? emptySubState()
}
