import { v4 as uuid } from 'uuid'
import { buildSchemaLookup } from './schemaLookup.js'

/**
 * Convert a parsed YAML config object to the builder's useConfig state format.
 * Blocks not present in the YAML are included as disabled.
 */
export function yamlToConfig(configObj, schema) {
  const lookup = buildSchemaLookup(schema)
  const state = {}

  // Start with all blocks disabled
  for (const block of schema) {
    state[block.name] = {
      enabled: false,
      instances: [emptyInstance(block)],
    }
  }

  // Populate enabled blocks from YAML
  for (const [blockKey, blockValue] of Object.entries(configObj || {})) {
    const blockInfo = lookup[blockKey]
    const raw = blockValue === null ? [{}] : (Array.isArray(blockValue) ? blockValue : [blockValue])

    state[blockKey] = {
      enabled: true,
      instances: raw.map(inst => convertInstance(inst, blockInfo, schema)),
    }
  }

  return state
}

function emptyInstance(blockDef) {
  return {
    _id: uuid(),
    options: {},
    sub_blocks: Object.fromEntries(
      (blockDef.sub_blocks || []).map(sb => [
        sb.name,
        { enabled: false, instances: [{ _id: uuid(), options: {} }] },
      ])
    ),
  }
}

function convertInstance(inst, blockInfo, schema) {
  const options = {}
  const sub_blocks = {}

  // Init all sub-blocks as disabled
  for (const sub of (blockInfo?.def?.sub_blocks || [])) {
    sub_blocks[sub.name] = { enabled: false, instances: [{ _id: uuid(), options: {} }] }
  }

  // Process each key in the YAML instance
  for (const [key, value] of Object.entries(inst || {})) {
    const subInfo = blockInfo?.subBlocksByName?.[key]

    if (subInfo) {
      // It's a sub-block
      const items = value === null ? [{}] : (Array.isArray(value) ? value : [value])
      sub_blocks[key] = {
        enabled: true,
        instances: items.map(item => ({
          _id: uuid(),
          options: item && typeof item === 'object' ? { ...item } : {},
        })),
      }
    } else {
      // It's an option (known or unknown)
      options[key] = value
    }
  }

  return { _id: uuid(), options, sub_blocks }
}
