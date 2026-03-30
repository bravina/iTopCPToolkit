/**
 * yamlSerializer.js
 *
 * Converts the builder's useConfig state into a plain JS object suitable for
 * YAML serialisation, then serialises it to a YAML string.
 *
 * The key concern here is omitting options that still hold their default values
 * so the output YAML stays minimal and readable.
 */

import yaml from 'js-yaml'

/**
 * Build a plain JS object from the current builder config state.
 * Only enabled blocks are included; options at their default value are omitted.
 */
export function buildYamlObject(configState, schema) {
  if (!schema || !Object.keys(configState).length) return {}
  const result = {}
  for (const blockDef of schema) {
    const blockState = configState[blockDef.name]
    if (!blockState?.enabled) continue
    if (blockDef.repeatable) {
      result[blockDef.name] = blockState.instances.map(inst => serializeInstance(inst, blockDef))
    } else {
      result[blockDef.name] = serializeInstance(blockState.instances[0], blockDef)
    }
  }
  return result
}

/**
 * Loose equality check for option defaults.
 * Treats '' and undefined as "unset" (treated as default).
 * Uses JSON.stringify for arrays/objects to compare by value.
 */
function isDefault(value, defaultVal) {
  if (value === '' || value === undefined) return true
  if (defaultVal === null || defaultVal === undefined) return false
  if (typeof defaultVal === 'object') {
    return JSON.stringify(value) === JSON.stringify(defaultVal)
  }
  return value === defaultVal || String(value) === String(defaultVal)
}

/**
 * Serialise a single block or sub-block instance.
 * Returns a plain object of non-default options plus any enabled sub-blocks,
 * or null if everything is at its default (so the block renders as {}).
 */
function serializeInstance(inst, blockDef) {
  const optDefaults = Object.fromEntries((blockDef.options || []).map(o => [o.name, o.default]))
  const opts = {}

  for (const [k, v] of Object.entries(inst?.options || {})) {
    if (isDefault(v, optDefaults[k])) continue
    opts[k] = v
  }

  for (const subDef of (blockDef.sub_blocks || [])) {
    const subState = inst?.sub_blocks?.[subDef.name]
    if (!subState?.enabled) continue
    if (subDef.repeatable) {
      opts[subDef.name] = subState.instances.map(si => serializeInstance(si, subDef))
    } else {
      opts[subDef.name] = serializeInstance(subState.instances[0], subDef)
    }
  }

  return Object.keys(opts).length ? opts : null
}

/**
 * Replace null values (empty blocks) with {} so the YAML output shows "MyBlock: {}"
 * instead of "MyBlock: null".
 */
function replaceNulls(v) {
  if (v === null) return {}
  if (Array.isArray(v)) return v.map(replaceNulls)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, replaceNulls(val)]))
  }
  return v
}

/**
 * Serialise the builder config state to a YAML string.
 * Each top-level block is dumped separately and joined with blank lines
 * to make the output easy to read.
 */
export function toYamlString(configState, schema) {
  const obj = buildYamlObject(configState, schema)
  if (!Object.keys(obj).length) return '# No blocks enabled yet\n'

  const blocks = Object.entries(replaceNulls(obj)).map(([key, value]) =>
    yaml.dump({ [key]: value }, { lineWidth: 120, sortKeys: false, quotingType: "'", noRefs: true })
  )
  return blocks.join('\n')
}
