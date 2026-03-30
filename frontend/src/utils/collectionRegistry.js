/**
 * collectionRegistry.js
 *
 * Builds a "registry" of known physics-object containers and their named
 * selections from either:
 *   - The builder's useConfig state (live editing mode)
 *   - A parsed YAML config object (reader mode)
 *
 * The registry is consumed by:
 *   - CollectionField      → autocomplete suggestions while typing
 *   - dependencyChecker    → warns when a referenced container/selection
 *                            doesn't exist
 *
 * Registry shape:
 *   {
 *     collections:    [{ name, type, blockName }],
 *     selections:     [{ name, container, type }],
 *     byType:         { jets: [{ name, blockName }], electrons: [...], ... },
 *     withSelections: ["AnaJets.baselineJvt", ...]   // convenience flat list
 *   }
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION MAPS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps GUI block names to the physics-object type string they produce.
 * null   → block is skipped (produces no container)
 * string → the type tag added to the registry entry
 *
 * Add an entry here when adding a new block that defines a new container.
 */
export const DEFINING_BLOCK_TYPES = {
  Jets:                     'jets',
  Electrons:                'electrons',
  Muons:                    'muons',
  Photons:                  'photons',
  TauJets:                  'taus',
  DiTauJets:                'ditaus',
  MissingET:                'met',
  JetReclustering:          'jets',
  ReclusteredJetCalibration:'jets',
  PL_Jets:                  'jets',
  PL_Electrons:             'electrons',
  PL_Muons:                 'muons',
  PL_Photons:               'photons',
  PL_Taus:                  'taus',
  PL_Neutrinos:             'neutrinos',
  PL_Resonances:            'resonances',
  InDetTracks:              'tracks',
  CommonServices:           null,   // produces no container; explicitly skipped
  EventInfo:                null,
}

/**
 * Sub-block names whose `selectionName` option defines a named selection on
 * the parent container (e.g. WorkingPoint adds a selection like "tight").
 */
const SELECTION_DEFINING_SUBBLOCKS = new Set([
  'WorkingPoint', 'JVT', 'PtEtaSelection', 'BJetCalib',
  'FlavourTagging', 'Uncertainties',
])

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA HELPERS (used to look up declared defaults)
// ─────────────────────────────────────────────────────────────────────────────

function getSchemaDefault(schema, blockName, optionName) {
  const block = schema.find(b => b.name === blockName)
  const opt = (block?.options || []).find(o => o.name === optionName)
  return opt?.default
}

function getSubSchemaDefault(schema, blockName, subName, optionName) {
  const block = schema.find(b => b.name === blockName)
  const sub = (block?.sub_blocks || []).find(s => s.name === subName)
  const opt = (sub?.options || []).find(o => o.name === optionName)
  return opt?.default
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shared logic for building the registry from a normalised list of instances.
 *
 * Each entry in `instances` has the shape:
 *   { containerName, selectionsBySubBlock, outputName, srcContainerName }
 *
 * This avoids duplicating the collection/selection accumulation logic between
 * the state-based and YAML-based entry points.
 */
function _buildRegistry(normalisedBlocks) {
  const collections = []
  const selections = []

  for (const { blockName, objType, instances } of normalisedBlocks) {
    if (objType === null) continue  // explicitly skipped block

    for (const { containerName, selectionsBySubBlock, outputName, srcContainerRef } of instances) {

      // Register the container produced by this block
      if (objType !== undefined && containerName) {
        if (!collections.find(c => c.name === containerName)) {
          collections.push({ name: containerName, type: objType, blockName })
        }

        // Register selections from enabled sub-blocks
        for (const { selectionName } of (selectionsBySubBlock || [])) {
          if (selectionName && !selections.find(s => s.name === selectionName && s.container === containerName)) {
            selections.push({ name: selectionName, container: containerName, type: objType })
          }
        }
      }

      // Thinning block: outputName creates an alias container
      if (outputName) {
        const srcEntry = collections.find(c => c.name === srcContainerRef?.split('.')[0])
        if (!collections.find(c => c.name === outputName)) {
          collections.push({ name: outputName, type: srcEntry?.type ?? 'any', blockName })
        }
      }
    }
  }

  return _finalise(collections, selections)
}

function _finalise(collections, selections) {
  // Index by type for fast lookup in CollectionField
  const byType = {}
  for (const c of collections) {
    if (c.type && c.type !== 'any') {
      if (!byType[c.type]) byType[c.type] = []
      byType[c.type].push(c)
    }
  }

  // Flat list of "container.selection" strings
  const withSelections = selections.map(s => `${s.container}.${s.name}`)

  return { collections, selections, byType, withSelections }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ENTRY POINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build registry from the builder's useConfig state + schema.
 * Called in App.jsx whenever the live config changes.
 */
export function buildRegistryFromState(configState, schema) {
  const normalisedBlocks = []

  for (const [blockName, blockState] of Object.entries(configState || {})) {
    if (!blockState?.enabled) continue
    const objType = DEFINING_BLOCK_TYPES[blockName]

    const instances = (blockState.instances || []).map(inst => {
      const containerName =
        (inst.options?.containerName || '') ||
        getSchemaDefault(schema, blockName, 'containerName')

      // Collect (selectionName) from enabled selection-defining sub-blocks
      const selectionsBySubBlock = []
      for (const [subName, subState] of Object.entries(inst.sub_blocks || {})) {
        if (!subState?.enabled || !SELECTION_DEFINING_SUBBLOCKS.has(subName)) continue
        for (const si of (subState.instances || [])) {
          const selectionName =
            (si.options?.selectionName || '') ||
            getSubSchemaDefault(schema, blockName, subName, 'selectionName')
          if (selectionName) selectionsBySubBlock.push({ selectionName })
        }

        // JVT always implicitly creates "baselineJvt"
        if (subName === 'JVT') {
          selectionsBySubBlock.push({ selectionName: 'baselineJvt' })
        }
      }

      return {
        containerName: typeof containerName === 'string' ? containerName : null,
        selectionsBySubBlock,
        // Thinning fields
        outputName: blockName === 'Thinning' ? (inst.options?.outputName || null) : null,
        srcContainerRef: blockName === 'Thinning' ? (inst.options?.containerName || null) : null,
      }
    })

    normalisedBlocks.push({ blockName, objType, instances })
  }

  return _buildRegistry(normalisedBlocks)
}

/**
 * Build registry from a parsed YAML config object + schema.
 * Called in ConfigReader when a file is loaded.
 */
export function buildRegistryFromYaml(configObj, schema) {
  const normalisedBlocks = []

  for (const [blockName, blockValue] of Object.entries(configObj || {})) {
    const objType = DEFINING_BLOCK_TYPES[blockName]
    const rawInstances = Array.isArray(blockValue) ? blockValue : [blockValue ?? {}]

    const instances = rawInstances.map(inst => {
      if (!inst || typeof inst !== 'object') return {}

      const containerName =
        inst.containerName ??
        getSchemaDefault(schema, blockName, 'containerName')

      // Collect selections from sub-block entries present in the YAML
      const selectionsBySubBlock = []
      for (const [subName, subVal] of Object.entries(inst)) {
        if (!SELECTION_DEFINING_SUBBLOCKS.has(subName)) continue
        const subInstances = Array.isArray(subVal) ? subVal : [subVal ?? {}]
        for (const si of subInstances) {
          const selectionName =
            si?.selectionName ??
            getSubSchemaDefault(schema, blockName, subName, 'selectionName')
          if (selectionName) selectionsBySubBlock.push({ selectionName })
        }
      }

      return {
        containerName: typeof containerName === 'string' ? containerName : null,
        selectionsBySubBlock,
        outputName: blockName === 'Thinning' ? (inst.outputName || null) : null,
        srcContainerRef: blockName === 'Thinning' ? (inst.containerName || null) : null,
      }
    })

    normalisedBlocks.push({ blockName, objType, instances })
  }

  return _buildRegistry(normalisedBlocks)
}

// ─────────────────────────────────────────────────────────────────────────────
// FIELD-LEVEL HELPERS (used by OptionField / CollectionField)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Infer the expected physics-object type from an option name.
 * Returns a type string matching the keys in DEFINING_BLOCK_TYPES, or null.
 *
 * Add patterns here if a new object type is introduced.
 */
export function inferFieldType(optName) {
  const n = optName.toLowerCase()
  if (/\bjet\b|jets\b|ljet|largerjet/.test(n)) return 'jets'
  if (/electron/.test(n))                       return 'electrons'
  if (/muon/.test(n))                           return 'muons'
  if (/photon/.test(n))                         return 'photons'
  if (/\btau\b/.test(n))                        return 'taus'
  if (/\bmet\b|missinget/.test(n))              return 'met'
  if (/\btrack/.test(n))                        return 'tracks'
  return null  // unknown → suggest all containers
}

/**
 * Decide whether an option field should show collection autocomplete.
 *
 * Returns 'collections+selections' when the field expects a container
 * (possibly with a selection suffix), null otherwise.
 *
 * Rules:
 *  - outputName fields are user-defined names, never references → no autocomplete
 *  - containerName in a block that DEFINES collections → no autocomplete
 *  - Any option name that implies a physics object type → autocomplete
 */
export function getAutocompleteMode(optName, blockName) {
  const n = optName.toLowerCase()

  if (n === 'outputname') return null

  // containerName inside a defining block is the name the user invents, not a reference
  if (n === 'containername' && blockName in DEFINING_BLOCK_TYPES) return null

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
