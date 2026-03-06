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

function stripEmpty(obj) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) { if (v !== '') out[k] = v }
  return out
}

function serializeInstance(inst, blockDef) {
  const opts = stripEmpty(inst?.options || {})
  for (const subDef of (blockDef.sub_blocks || [])) {
    const subState = inst?.sub_blocks?.[subDef.name]
    if (!subState?.enabled) continue
    if (subDef.repeatable) {
      opts[subDef.name] = subState.instances.map(si => {
        const sopts = stripEmpty(si.options || {})
        return Object.keys(sopts).length ? sopts : null
      })
    } else {
      const sopts = stripEmpty(subState.instances[0]?.options || {})
      opts[subDef.name] = Object.keys(sopts).length ? sopts : null
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
  return yaml.dump(replaceNulls(obj), { lineWidth: 120, sortKeys: false, quotingType: "'", noRefs: true })
}
