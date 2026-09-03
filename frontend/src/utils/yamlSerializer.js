/**
 * yamlSerializer.js
 *
 * Builder state → plain JS object → YAML string.
 *
 * Rules (mirroring what TextConfig accepts):
 *   - every block is written as a YAML list, even with one instance
 *   - options equal to their (factory-merged) default are omitted
 *   - `AddConfigBlocks` is written first, and only for custom blocks that are
 *     actually used in the config
 *   - blocks unknown to the schema (kept from an imported file) are written
 *     back verbatim, so nothing is lost on a Reader → Builder → export round-trip
 */

import yaml from 'js-yaml'
import { ADD_CONFIG_BLOCKS, ADD_CONFIG_BLOCKS_KEYS, blocksForConfig, superBlockList } from './schema.js'

/**
 * Loose default comparison.  '' / null / undefined count as "unset".
 * Arrays and objects are compared by value.
 */
export function isDefault(value, defaultVal) {
  if (value === '' || value === null || value === undefined) return true
  if (defaultVal === null || defaultVal === undefined) return false
  if (typeof defaultVal === 'object') return JSON.stringify(value) === JSON.stringify(defaultVal)
  return value === defaultVal || String(value) === String(defaultVal)
}

/** Serialise one block or sub-block instance to a plain object (possibly {}). */
export function serializeInstance(inst, blockDef) {
  const byName = Object.fromEntries((blockDef?.options || []).map(o => [o.name, o]))
  const out = {}
  for (const [k, v] of Object.entries(inst?.options || {})) {
    const def = byName[k]
    if (def ? isDefault(v, def.default) : isDefault(v, undefined)) continue
    out[k] = v
  }
  for (const subDef of (blockDef?.subBlocks || [])) {
    const subState = inst?.subBlocks?.[subDef.name]
    if (!subState?.enabled) continue
    out[subDef.name] = subState.instances.map(si => serializeInstance(si, subDef))
  }
  return out
}

/** Custom entries whose block is enabled somewhere in the config. */
export function usedCustomEntries(config) {
  const used = []
  for (const entry of config?.addConfigBlocks || []) {
    const parents = superBlockList(entry.superBlocks)
    if (parents.length === 0) {
      if (config.blocks[entry.algName]?.enabled) used.push(entry)
      continue
    }
    const active = parents.some(p => {
      const st = config.blocks[p]
      return st?.enabled && st.instances.some(inst => inst.subBlocks?.[entry.algName]?.enabled)
    })
    if (active) used.push(entry)
  }
  return used
}

function compactEntry(entry) {
  const out = {}
  for (const k of ADD_CONFIG_BLOCKS_KEYS) {
    if (entry[k] !== null && entry[k] !== undefined && entry[k] !== '') out[k] = entry[k]
  }
  return out
}

/**
 * Plain object for the whole config.  `schema` is the /api/schema document
 * (only `blocks` is used); custom blocks come from the config itself.
 */
export function buildYamlObject(config, schema) {
  const result = {}
  if (!config || !schema) return result
  const blocks = blocksForConfig(schema, config)

  const used = usedCustomEntries(config)
  if (used.length) result[ADD_CONFIG_BLOCKS] = used.map(compactEntry)

  for (const def of blocks) {
    const st = config.blocks[def.name]
    if (!st?.enabled) continue
    result[def.name] = st.instances.map(inst => serializeInstance(inst, def))
  }
  for (const [name, raw] of Object.entries(config.unknown || {})) {
    if (!(name in result)) result[name] = raw
  }
  return result
}

/** Dump each top-level block separately, joined by blank lines. */
export function objectToYaml(obj) {
  const keys = Object.keys(obj)
  if (!keys.length) return '# No blocks enabled yet\n'
  return keys.map(key =>
    yaml.dump({ [key]: obj[key] }, { lineWidth: 120, sortKeys: false, quotingType: "'", noRefs: true })
  ).join('\n')
}

export function toYamlString(config, schema) {
  return objectToYaml(buildYamlObject(config, schema))
}
