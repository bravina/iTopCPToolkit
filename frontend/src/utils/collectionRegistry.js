/**
 * collectionRegistry.js
 *
 * Registry of physics-object containers and named selections defined by a
 * config, consumed by CollectionField (autocomplete) and dependencyChecker.
 *
 * What an option *means* comes only from the upstream `meta.role` on the option
 * (container | containerRef | selection).  There is deliberately no name-based
 * fallback: option names are not a reliable signal (`Trigger.electronID` holds
 * a working point, `Jets.jetCollection` an input xAOD name), so an option the
 * upstream block does not annotate simply has no role, and neither autocomplete
 * nor reference checking applies to it.
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

// ── Object-type inference (types registry containers, filters suggestions) ────

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
 * (reads `container[.selection]`), 'selection' (defines a selection name), or
 * null.  A declared upstream `meta.role` always wins.
 *
 * Two name-based fallbacks apply to `containerName` only, and only when the
 * option is NOT annotated upstream:
 *
 *  - in a sub-block it is 'inherited': TextConfig propagates it from the
 *    parent instance rather than declaring it anew;
 *  - at root level it counts as 'container'.  This is a temporary bridge:
 *    AB 25.2.110 annotates the blocks that READ a container (Thinning,
 *    ObjectCutFlow, PtEtaSelection, PerEventSF, IFF/MCTC decorations) but not
 *    yet the object blocks that DEFINE one (Jets, Electrons, …), so without it
 *    every `containerName: AnaJets` would be reported as an undefined
 *    reference.  The fallback can only ADD definitions, i.e. silence a
 *    warning, never raise a false one.  Delete it once the object blocks carry
 *    `meta={'role':'container'}` upstream (see .claude/UPSTREAM_MRS.txt).
 *
 * There is deliberately no other name-based fallback — an option the upstream
 * block does not annotate gets no role, and is treated as an ordinary value.
 */
export function optionRole(opt, { isSub = false } = {}) {
  const declared = opt?.meta?.role
  if (typeof declared === 'string' && declared) return declared
  if (isSub && opt?.name === 'containerName') return 'inherited'
  if (!isSub && opt?.name === 'containerName') return 'container'   // temporary bridge, see above
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
    const roles = (def.options || []).map(o => [o, optionRole(o)])
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
          const role = optionRole(o, { isSub: true })
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
