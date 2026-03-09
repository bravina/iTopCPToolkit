/**
 * Builds a registry of defined collections and selections from either:
 *   - The builder config state (+ schema for defaults)
 *   - A parsed YAML object (+ schema for defaults)
 *
 * Registry shape:
 *   collections: [{ name, type, blockName }]
 *   selections:  [{ name, container, type }]
 *   byType:      { jets: [{ name, blockName }], ... }
 *   withSelections: ["AnaJets.baselineJvt", ...]  (container.selection pairs)
 */

// Blocks whose `containerName` option DEFINES a new collection (not consumes one)
export const DEFINING_BLOCK_TYPES = {
  Jets: 'jets',
  Electrons: 'electrons',
  Muons: 'muons',
  Photons: 'photons',
  TauJets: 'taus',
  DiTauJets: 'ditaus',
  MissingET: 'met',
  JetReclustering: 'jets',
  ReclusteredJetCalibration: 'jets',
  PL_Jets: 'jets',
  PL_Electrons: 'electrons',
  PL_Muons: 'muons',
  PL_Photons: 'photons',
  PL_Taus: 'taus',
  PL_Neutrinos: 'neutrinos',
  PL_Resonances: 'resonances',
  InDetTracks: 'tracks',
  CommonServices: null,   // skip
  EventInfo: null,
}

// Sub-block names whose `selectionName` option defines a selection on the parent container
const SELECTION_DEFINING_SUBBLOCKS = new Set([
  'WorkingPoint', 'JVT', 'PtEtaSelection', 'BJetCalib',
  'FlavourTagging', 'Uncertainties',
])

// Option names that define a selection name
const SELECTION_OPTION_NAMES = new Set(['selectionName'])

// Option names that define an output/thinned container
const OUTPUT_NAME_OPTIONS = new Set(['outputName'])

function getSchemaDefault(schema, blockName, optionName) {
  const block = schema.find(b => b.name === blockName)
  if (!block) return undefined
  const opt = (block.options || []).find(o => o.name === optionName)
  return opt?.default
}

function getSubSchemaDefault(schema, blockName, subName, optionName) {
  const block = schema.find(b => b.name === blockName)
  if (!block) return undefined
  const sub = (block.sub_blocks || []).find(s => s.name === subName)
  const opt = (sub?.options || []).find(o => o.name === optionName)
  return opt?.default
}

/** Build registry from builder useConfig state + schema */
export function buildRegistryFromState(configState, schema) {
  const collections = []
  const selections = []

  for (const [blockName, blockState] of Object.entries(configState || {})) {
    if (!blockState?.enabled) continue
    const objType = DEFINING_BLOCK_TYPES[blockName]
    if (objType === null) continue  // explicitly skipped

    for (const inst of (blockState.instances || [])) {
      if (objType !== undefined) {
        // This block defines a collection
        const containerName =
          (inst.options?.containerName && inst.options.containerName !== '')
            ? inst.options.containerName
            : getSchemaDefault(schema, blockName, 'containerName')

        if (containerName && typeof containerName === 'string') {
          if (!collections.find(c => c.name === containerName)) {
            collections.push({ name: containerName, type: objType, blockName })
          }

          // Collect selections from sub-blocks
          for (const [subName, subState] of Object.entries(inst.sub_blocks || {})) {
            if (!subState?.enabled) continue
            if (!SELECTION_DEFINING_SUBBLOCKS.has(subName)) continue

            for (const si of (subState.instances || [])) {
              const selName =
                (si.options?.selectionName && si.options.selectionName !== '')
                  ? si.options.selectionName
                  : getSubSchemaDefault(schema, blockName, subName, 'selectionName')

              if (selName && typeof selName === 'string') {
                if (!selections.find(s => s.name === selName && s.container === containerName)) {
                  selections.push({ name: selName, container: containerName, type: objType })
                }
              }
            }
          }

          // Also check JVT-style built-in selection names baked in the schema
          // e.g. JVT always adds "baselineJvt"
          _addImplicitSelections(selections, blockName, containerName, objType, schema, inst)
        }
      }

      // Thinning block defines outputName as a new container alias
      if (blockName === 'Thinning') {
        const outputName = inst.options?.outputName
        const srcContainer = inst.options?.containerName
        if (outputName && outputName !== '') {
          // Infer type from source container
          const srcEntry = collections.find(c => c.name === srcContainer?.split('.')[0])
          collections.push({ name: outputName, type: srcEntry?.type ?? 'any', blockName: 'Thinning' })
        }
      }
    }
  }

  return _finalise(collections, selections)
}

/** Build registry from a parsed YAML config object + schema */
export function buildRegistryFromYaml(configObj, schema) {
  const collections = []
  const selections = []

  for (const [blockName, blockValue] of Object.entries(configObj || {})) {
    const objType = DEFINING_BLOCK_TYPES[blockName]
    if (objType === null) continue

    const instances = Array.isArray(blockValue) ? blockValue : [blockValue ?? {}]

    for (const inst of instances) {
      if (!inst || typeof inst !== 'object') continue

      if (objType !== undefined) {
        const containerName =
          inst.containerName ??
          getSchemaDefault(schema, blockName, 'containerName')

        if (containerName && typeof containerName === 'string') {
          if (!collections.find(c => c.name === containerName)) {
            collections.push({ name: containerName, type: objType, blockName })
          }

          // Sub-blocks
          for (const [subName, subVal] of Object.entries(inst)) {
            if (!SELECTION_DEFINING_SUBBLOCKS.has(subName)) continue
            const subInstances = Array.isArray(subVal) ? subVal : [subVal ?? {}]
            for (const si of subInstances) {
              const selName =
                si?.selectionName ??
                getSubSchemaDefault(schema, blockName, subName, 'selectionName')
              if (selName && typeof selName === 'string') {
                if (!selections.find(s => s.name === selName && s.container === containerName)) {
                  selections.push({ name: selName, container: containerName, type: objType })
                }
              }
            }
          }
        }
      }

      // Thinning
      if (blockName === 'Thinning') {
        const outputName = inst.outputName
        const srcContainer = inst.containerName
        if (outputName) {
          const srcEntry = collections.find(c => c.name === srcContainer?.split('.')[0])
          collections.push({ name: outputName, type: srcEntry?.type ?? 'any', blockName: 'Thinning' })
        }
      }
    }
  }

  return _finalise(collections, selections)
}

function _addImplicitSelections(selections, blockName, containerName, objType, schema, inst) {
  // JVT sub-block always creates "baselineJvt" selection  
  const jvtState = inst.sub_blocks?.JVT
  if (jvtState?.enabled) {
    const sel = 'baselineJvt'
    if (!selections.find(s => s.name === sel && s.container === containerName)) {
      selections.push({ name: sel, container: containerName, type: objType })
    }
  }
}

function _finalise(collections, selections) {
  // Build byType index
  const byType = {}
  for (const c of collections) {
    if (c.type && c.type !== 'any') {
      if (!byType[c.type]) byType[c.type] = []
      byType[c.type].push(c)
    }
  }

  // Build container.selection pairs
  const withSelections = []
  for (const s of selections) {
    withSelections.push(`${s.container}.${s.name}`)
  }

  return { collections, selections, byType, withSelections }
}

// ── Type inference for option fields ────────────────────────────────────────

/**
 * Infer the expected physics object type from an option name.
 * Returns a type string (matching DEFINING_BLOCK_TYPES values) or null for generic.
 */
export function inferFieldType(optName) {
  const n = optName.toLowerCase()
  if (/\bjet\b|jets\b|ljet|largerjet/.test(n)) return 'jets'
  if (/electron/.test(n)) return 'electrons'
  if (/muon/.test(n)) return 'muons'
  if (/photon/.test(n)) return 'photons'
  if (/\btau\b/.test(n)) return 'taus'
  if (/\bmet\b|missinget/.test(n)) return 'met'
  if (/\btrack/.test(n)) return 'tracks'
  return null  // generic: suggest all
}

/**
 * Decide whether an option field should show collection autocomplete.
 * Returns: 'collections' | 'collections+selections' | null
 *
 * Conditions:
 *  - Option type is str (or untyped)
 *  - Option name implies a physics object type, OR it's a containerName in a consuming block
 *  - Not a defining block's containerName
 */
export function getAutocompleteMode(optName, blockName, parentBlockName) {
  const n = optName.toLowerCase()

  // outputName fields are pure user-defined names, not references
  if (n === 'outputname') return null

  // containerName in a block that DEFINES collections → skip autocomplete
  if (n === 'containername' && (blockName in DEFINING_BLOCK_TYPES || parentBlockName in DEFINING_BLOCK_TYPES)) {
    return null
  }

  // Fields that typically hold container+selection references
  if (
    /\bjet\b|jets\b|ljet|largerjet/.test(n) ||
    /electron/.test(n) ||
    /muon/.test(n) ||
    /photon/.test(n) ||
    /\btau\b/.test(n) ||
    /\bmet\b|missinget/.test(n) ||
    /\btrack/.test(n) ||
    /container/.test(n) ||
    /particles/.test(n)
  ) {
    return 'collections+selections'
  }

  return null
}
