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
 *     regions:        ["SR", "CR_ttbar", ...],   // EventSelection selectionNames
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
 * (reads `container[.selection]`), 'selection' (names a selection on the
 * block's own container), or null.  A declared upstream `meta.role` always
 * wins.
 *
 * A 'selection' option both defines and reuses: the CP algorithms create the
 * decoration when the name is new and overwrite it with the new selection item
 * when it already exists.  So a name that appears nowhere else is not an
 * error — nothing may reference a selection for it to be valid — and an
 * existing name is a deliberate choice the editor should make easy to pick.
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
 * One more temporary bridge, for a role upstream does not have yet:
 * EventSelection's `selectionName` defines a REGION, which is what the IMPORT
 * keyword's `region` argument refers to.  Until upstream can express that
 * (`meta={'role':'region'}`, agreed as a follow-up), it is recognised here by
 * block and option name so the cuts editor can offer a region picker.
 *
 * Every OTHER 'region' option is a reference, never a definition: only
 * EventSelection's `selectionName` creates a region.  That includes
 * EventSelection's own `preselection`, which starts a selection from the flag
 * another one produced.  What a referencing option holds is not the bare name
 * but the selection decoration the algorithms read,
 * `pass_<region>_%SYS%,as_char` — the same string EventSelection's own IMPORT
 * keyword builds.  See regionSelectionExpr().
 *
 * There is deliberately no other name-based fallback — an option the upstream
 * block does not annotate gets no role, and is treated as an ordinary value.
 */
export function optionRole(opt, { isSub = false, blockName = null } = {}) {
  const declared = opt?.meta?.role
  if (typeof declared === 'string' && declared) return declared
  if (blockName === 'EventSelection' && opt?.name === 'selectionName') return 'region'
  if (isSub && opt?.name === 'containerName') return 'inherited'
  if (!isSub && opt?.name === 'containerName') return 'container'   // temporary bridge, see above
  return null
}

/**
 * Whether a 'region' option DEFINES the region rather than referencing one.
 * Only EventSelection's `selectionName` does; the block's own `preselection`
 * references, so the block name alone is not enough to tell them apart.
 */
export function definesRegion(opt, { blockName = null } = {}) {
  return blockName === 'EventSelection' && opt?.name === 'selectionName'
}

/**
 * The value a region-consuming option holds: the event filter decoration the
 * CP algorithms read, not the bare region name.  Values are free text and may
 * combine several of these with `||`, `&&` and `!`, so this only builds the
 * single-region form the picker inserts.
 */
export function regionSelectionExpr(region) {
  return `pass_${region}_%SYS%,as_char`
}

/**
 * Autocomplete mode for an option: 'collections+selections' for a reference,
 * 'selections' for a name that may create or reuse one, 'regions' for an event
 * filter naming a region defined elsewhere, or null.
 */
export function getAutocompleteMode(opt, ctx) {
  const role = optionRole(opt, ctx)
  if (role === 'containerRef') return 'collections+selections'
  if (role === 'selection') return 'selections'
  if (role === 'region' && !definesRegion(opt, ctx)) return 'regions'
  return null
}

/**
 * Selection names already defined on `container`, for the reuse half of a
 * 'selection' option.  Every known name when the container is unknown: an
 * unscoped suggestion is still better than none, and the value is free text.
 */
export function selectionsFor(registry, container) {
  const c = typeof container === 'string' ? container.split('.')[0] : null
  const names = (registry?.selections ?? [])
    .filter(s => !c || s.container === c)
    .map(s => s.name)
  return [...new Set(names)]
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
  const regions = []
  const addCollection = (name, type, blockName) => {
    if (typeof name !== 'string' || !name) return
    if (!collections.some(c => c.name === name)) collections.push({ name, type: type ?? 'any', blockName })
  }
  const addSelection = (name, container, type) => {
    if (typeof name !== 'string' || !name || typeof container !== 'string' || !container) return
    const c = container.split('.')[0]
    if (!selections.some(s => s.name === name && s.container === c)) selections.push({ name, container: c, type: type ?? 'any' })
  }
  const addRegion = (name) => {
    if (typeof name !== 'string' || !name) return
    if (!regions.includes(name)) regions.push(name)
  }

  for (const { def, instances } of walked) {
    const objType = inferFieldType(def.name)
    const roles = (def.options || []).map(o => [o, optionRole(o, { blockName: def.name })])
    const containerOpt = (def.options || []).find(o => o.name === 'containerName')

    for (const { options, subs } of instances) {
      for (const [opt, role] of roles) {
        if (role === 'container') addCollection(valueOrDefault(options, opt), objType, def.name)
        else if (role === 'region' && definesRegion(opt, { blockName: def.name })) addRegion(valueOrDefault(options, opt))
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
  return {
    collections, selections, byType, regions,
    withSelections: selections.map(s => `${s.container}.${s.name}`),
  }
}

export const EMPTY_REGISTRY = Object.freeze({
  collections: [], selections: [], byType: {}, regions: [], withSelections: [],
})

/** Registry from the builder state; `blocks` is the effective block list. */
export function buildRegistryFromState(config, blocks) {
  return buildRegistry(walkState(config, blocks))
}

/** Registry from a parsed YAML object; `blocks` is the effective block list. */
export function buildRegistryFromYaml(configObj, blocks) {
  return buildRegistry(walkYaml(configObj, blocks))
}
