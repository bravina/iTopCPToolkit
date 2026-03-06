import yaml from 'js-yaml'

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

/** Loose equality check for option defaults (handles null, '', numbers, booleans). */
function isDefault(value, defaultVal) {
  if (value === '' || value === undefined) return true
  if (defaultVal === null || defaultVal === undefined) return false
  // Compare by value for primitives; JSON-stringify for arrays/objects
  if (typeof defaultVal === 'object') {
    return JSON.stringify(value) === JSON.stringify(defaultVal)
  }
  // Coerce to the same type for comparison (e.g. "25000" vs 25000)
  return value === defaultVal || String(value) === String(defaultVal)
}

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
      opts[subDef.name] = subState.instances.map(si => {
        const sopts = serializeInstance(si, subDef)
        return sopts !== null ? sopts : null
      })
    } else {
      opts[subDef.name] = serializeInstance(subState.instances[0], subDef)
    }
  }

  return Object.keys(opts).length ? opts : null
}

function replaceNulls(v) {
  if (v === null) return {}
  if (Array.isArray(v)) return v.map(replaceNulls)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, replaceNulls(val)]))
  return v
}

export function toYamlString(configState, schema) {
  const obj = buildYamlObject(configState, schema)
  if (!Object.keys(obj).length) return '# No blocks enabled yet\n'

  // Dump each top-level block separately and join with blank lines for readability
  const blocks = Object.entries(replaceNulls(obj)).map(([key, value]) =>
    yaml.dump({ [key]: value }, { lineWidth: 120, sortKeys: false, quotingType: "'", noRefs: true })
  )
  return blocks.join('\n')
}