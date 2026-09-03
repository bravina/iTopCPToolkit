/**
 * configWalk.js
 *
 * One normalised view over "a config", whether it is the builder state or a
 * parsed YAML object, so the registry and dependency checker are written once:
 *
 *   [ { def, instances: [ { idx, options, subs: [ { def, idx, options } ] } ] } ]
 *
 * Only blocks the (effective) schema knows are yielded; enabled state is
 * respected for the builder, everything present is yielded for YAML.
 */

import { ADD_CONFIG_BLOCKS } from './schema.js'
import { buildSchemaLookup } from './schemaLookup.js'
import { normalizeInstances } from './yamlToConfig.js'

export function walkState(config, blocks) {
  const out = []
  for (const def of blocks || []) {
    const st = config?.blocks?.[def.name]
    if (!st?.enabled) continue
    out.push({
      def,
      instances: st.instances.map((inst, idx) => ({
        idx,
        options: inst.options || {},
        subs: (def.subBlocks || []).flatMap(sd => {
          const ss = inst.subBlocks?.[sd.name]
          if (!ss?.enabled) return []
          return ss.instances.map((si, sidx) => ({ def: sd, idx: sidx, options: si.options || {} }))
        }),
      })),
    })
  }
  return out
}

export function walkYaml(configObj, blocks) {
  const lookup = buildSchemaLookup(blocks)
  const out = []
  for (const [name, value] of Object.entries(configObj || {})) {
    if (name === ADD_CONFIG_BLOCKS) continue
    const info = lookup[name]
    if (!info) continue
    out.push({
      def: info.def,
      instances: normalizeInstances(value).map((inst, idx) => {
        const options = {}
        const subs = []
        for (const [k, v] of Object.entries(inst)) {
          const sub = info.subBlocksByName[k]
          if (sub) normalizeInstances(v).forEach((si, sidx) => subs.push({ def: sub.def, idx: sidx, options: si }))
          else options[k] = v
        }
        return { idx, options, subs }
      }),
    })
  }
  return out
}
