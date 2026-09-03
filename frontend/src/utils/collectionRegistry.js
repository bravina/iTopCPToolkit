/**
 * collectionRegistry.js
 *
 * Registry of physics-object containers and named selections defined by a
 * config, consumed by CollectionField (autocomplete) and dependencyChecker.
 *
 * What an option *means* comes from the upstream `meta.role` on the option
 * (container | containerRef | selection) when the block declares it.  Until
 * every block does, `optionRole` falls back to naming conventions — the
 * fallback is deliberately the only place such heuristics live.
 *
 * Registry shape:
 *   {
 *     collections:    [{ name, type, blockName }],
 *     selections:     [{ name, container, type }],
 *     byType:         { jets: [...], electrons: [...], ... },
 *     withSelections: ["AnaJets.baselineJvt", ...]
 *   }
 */

import { walkState, walkYaml } from './configWalk.js'

// ── Object-type inference (fallback only, used to filter suggestions) ─────────

const TYPE_PATTERNS = [
  ['taus',      /^tau|taus?\b|ditau/],
  ['jets',      /jets?\b|ljet|fatjet|largerjet/],
  ['electrons', /electron/],
  ['muons',     /muon/],
  ['photons',   /photon/],
  ['met',       /^met$|\bmet\b|missinget/],
  ['tracks',    /track/],
]

/** Physics-object type implied by an option or block name, or null. */
export function inferFieldType(name) {
  const n = String(name || '').toLowerCase()
  for (const [type, re] of TYPE_PATTERNS) if (re.test(n)) return type
  return null
}

// ── Option roles ──────────────────────────────────────────────────────────────

/**
 * Role of an option: 'container' (defines a container name), 'containerRef'
 * (reads `container[.selection]`), 'selection' (defines a selection name),
 * 'inherited' (containerName in a sub-block, propagated from the parent) or null.
 */
export function optionRole(opt, { isSub = false, blockDef = null } = {}) {
  const declared = opt?.meta?.role
  if (declared) return declared
  const name = opt?.name || ''
  if (name === 'containerName') {
    if (isSub) return 'inherited'
    const names = new Set((blockDef?.options || []).map(o => o.name))
    // A root block that also names an output or a selection reads its container
    return (names.has('outputName') || names.has('selectionName')) ? 'containerRef' : 'container'
  }
  if (name === 'outputName') return 'container'
  if (name === 'selectionName') return 'selection'
  if (name === 'selection' || name === 'preselection') return null
  const n = name.toLowerCase()
  if (inferFieldType(n) || /container|particles/.test(n)) return 'containerRef'
  return null
}

/** Autocomplete mode for an option: 'collections+selections' or null. */
export function getAutocompleteMode(opt, ctx) {
  return optionRole(opt, ctx) === 'containerRef' ? 'collections+selections' : null
}

// ── Registry construction ─────────────────────────────────────────────────────

function valueOrDefault(options, opt) {
  const v = options?.[opt.name]
  if (v !== undefined && v !== null && v !== '') return v
  return opt.default
}

function buildRegistry(walked) {
  const collections = []
  const selections = []
  const addCollection = (name, type, blockName) => {
    if (typeof name !== 'string' || !name) return
    if (!collections.some(c => c.name === name)) collections.push({ name, type: type ?? 'any', blockName })
  }
  const addSelection = (name, container, type) => {
    if (typeof name !== 'string' || !name || typeof container !== 'string' || !container) return
    const c = container.split('.')[0]
    if (!selections.some(s => s.name === name && s.container === c)) selections.push({ name, container: c, type: type ?? 'any' })
  }

  for (const { def, instances } of walked) {
    const objType = inferFieldType(def.name)
    const roles = (def.options || []).map(o => [o, optionRole(o, { blockDef: def })])
    const containerOpt = (def.options || []).find(o => o.name === 'containerName')

    for (const { options, subs } of instances) {
      for (const [opt, role] of roles) {
        if (role === 'container') addCollection(valueOrDefault(options, opt), objType, def.name)
      }
      const container = containerOpt ? valueOrDefault(options, containerOpt) : null
      for (const [opt, role] of roles) {
        if (role === 'selection' && container) addSelection(valueOrDefault(options, opt), container, objType)
      }
      for (const { def: sd, options: so } of subs) {
        const subContainer = (so.containerName && String(so.containerName)) || container
        for (const o of sd.options || []) {
          const role = optionRole(o, { isSub: true, blockDef: sd })
          if (role === 'selection' && subContainer) addSelection(valueOrDefault(so, o), subContainer, objType)
          else if (role === 'container') addCollection(valueOrDefault(so, o), objType, sd.name)
        }
      }
    }
  }

  const byType = {}
  for (const c of collections) {
    if (c.type && c.type !== 'any') (byType[c.type] ??= []).push(c)
  }
  return { collections, selections, byType, withSelections: selections.map(s => `${s.container}.${s.name}`) }
}

export const EMPTY_REGISTRY = Object.freeze({ collections: [], selections: [], byType: {}, withSelections: [] })

/** Registry from the builder state; `blocks` is the effective block list. */
export function buildRegistryFromState(config, blocks) {
  return buildRegistry(walkState(config, blocks))
}

/** Registry from a parsed YAML object; `blocks` is the effective block list. */
export function buildRegistryFromYaml(configObj, blocks) {
  return buildRegistry(walkYaml(configObj, blocks))
}
