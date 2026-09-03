/**
 * yamlToConfig.js
 *
 * Parsed YAML object → builder state (utils/configState.js shape).
 *
 * Mirrors TextConfig.loadConfig: `AddConfigBlocks` is processed first so the
 * custom blocks it declares are known when the rest of the file is read.
 * Custom blocks are resolved against the catalogue; anything else is handed
 * to `resolveBlock(entry)` (a call to POST /api/introspect) when provided.
 * Blocks and options the schema does not know are preserved verbatim.
 */

import { v4 as uuid } from 'uuid'
import { buildSchemaLookup } from './schemaLookup.js'
import { emptySubState, initialConfig } from './configState.js'
import {
  ADD_CONFIG_BLOCKS, customEntryFromCatalogue, effectiveBlocks, opaqueBlock,
} from './schema.js'

/** Normalise the list or dict form of AddConfigBlocks into a list of entries. */
export function normalizeAddConfigBlocks(value) {
  let raw = []
  if (Array.isArray(value)) raw = value
  else if (value && typeof value === 'object') {
    raw = Object.entries(value).map(([algName, opts]) => ({ ...(opts || {}), algName }))
  }
  return raw.filter(e => e && typeof e === 'object').map(e => ({
    modulePath: e.modulePath, functionName: e.functionName, algName: e.algName,
    pos: e.pos ?? null, superBlocks: e.superBlocks ?? null,
  }))
}

export function isValidEntry(e) {
  return ['modulePath', 'functionName', 'algName'].every(k => typeof e?.[k] === 'string' && e[k])
}

export function findInCatalogue(schema, entry) {
  return (schema?.catalogue || []).find(c =>
    c.modulePath === entry.modulePath && c.functionName === entry.functionName) || null
}

/** A block may be a list, a dict, or null (TextConfig accepts all three). */
export function normalizeInstances(value) {
  if (value === null || value === undefined) return [{}]
  if (Array.isArray(value)) return value.map(v => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {})
  if (typeof value === 'object') return [value]
  return [{}]
}

function convertInstance(inst, blockInfo) {
  const options = {}
  const subBlocks = {}
  for (const sub of (blockInfo?.def?.subBlocks || [])) subBlocks[sub.name] = emptySubState()

  for (const [key, value] of Object.entries(inst || {})) {
    if (blockInfo?.subBlocksByName?.[key]) {
      subBlocks[key] = {
        enabled: true,
        instances: normalizeInstances(value).map(item => ({ _id: uuid(), options: { ...item } })),
      }
    } else {
      options[key] = value
    }
  }
  return { _id: uuid(), options, subBlocks }
}

/**
 * Resolve the AddConfigBlocks entries of a YAML object into custom-block
 * state entries.  Synchronous when only the catalogue is needed; pass an
 * async `resolveBlock` to introspect unknown entries.
 */
export function resolveCustomEntriesSync(configObj, schema) {
  return normalizeAddConfigBlocks(configObj?.[ADD_CONFIG_BLOCKS])
    .filter(isValidEntry)
    .map(e => {
      const cat = findInCatalogue(schema, e)
      return customEntryFromCatalogue({ ...e, block: cat?.block ?? opaqueBlock(e) })
    })
}

export async function resolveCustomEntries(configObj, schema, resolveBlock) {
  const entries = resolveCustomEntriesSync(configObj, schema)
  if (!resolveBlock) return entries
  for (const entry of entries) {
    if (!entry.block?.opaque) continue
    try {
      const block = await resolveBlock(entry)
      if (block) entry.block = block
    } catch (err) {
      entry.block = opaqueBlock(entry, `Introspection failed: ${err?.message ?? err}`)
    }
  }
  return entries
}

/** Build the state given already-resolved custom entries. */
export function yamlToConfigWithEntries(configObj, schema, customEntries) {
  const blocks = effectiveBlocks(schema?.blocks, customEntries)
  const lookup = buildSchemaLookup(blocks)
  const config = initialConfig(blocks)
  config.addConfigBlocks = customEntries

  for (const [key, value] of Object.entries(configObj || {})) {
    if (key === ADD_CONFIG_BLOCKS) continue
    const info = lookup[key]
    if (!info) { config.unknown[key] = value; continue }
    config.blocks[key] = {
      enabled: true,
      instances: normalizeInstances(value).map(inst => convertInstance(inst, info)),
    }
  }
  return config
}

export function yamlToConfigSync(configObj, schema) {
  return yamlToConfigWithEntries(configObj, schema, resolveCustomEntriesSync(configObj, schema))
}

export async function yamlToConfig(configObj, schema, resolveBlock) {
  const entries = await resolveCustomEntries(configObj, schema, resolveBlock)
  return yamlToConfigWithEntries(configObj, schema, entries)
}
