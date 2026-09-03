/**
 * schema.js
 *
 * Helpers around the schema document served by GET /api/schema:
 *
 *   { blocks, catalogue, examples, keywords, categories, versions, source }
 *
 * The *effective* schema seen by the editor is the base `blocks` plus any
 * custom blocks the user has declared through AddConfigBlocks — exactly how
 * TextConfig extends its factory when it reads the YAML.
 */

import { v4 as uuid } from 'uuid'

export const ADD_CONFIG_BLOCKS = 'AddConfigBlocks'
export const TCT_CATEGORY = 'TopCPToolkit'
export const GENERIC_SECTION_LABEL = 'Generic block options'
export const EXPERT_FLAG_HINT = 'CommonServices.enableExpertMode'

/** Keys of one AddConfigBlocks entry, in the order TextConfig documents them. */
export const ADD_CONFIG_BLOCKS_KEYS = ['modulePath', 'functionName', 'algName', 'pos', 'superBlocks']

/**
 * Synthetic schema entry for the AddConfigBlocks pseudo-block so the Reader
 * can annotate and validate it like any other block.
 */
export const ADD_CONFIG_BLOCKS_DEF = Object.freeze({
  name: ADD_CONFIG_BLOCKS,
  factoryName: ADD_CONFIG_BLOCKS,
  kind: 'class',
  category: 'Core',
  label: 'Add Config Blocks',
  synthetic: true,
  classes: [],
  dependencies: [],
  subBlocks: [],
  parents: [],
  error: null,
  options: [
    { name: 'modulePath', type: 'str', default: '', required: true, noneAction: 'ignore',
      info: 'Python module containing the config block, e.g. `TopCPToolkit.KLFitterConfig`.' },
    { name: 'functionName', type: 'str', default: '', required: true, noneAction: 'ignore',
      info: 'Name of the ConfigBlock class (or `@groupBlocks` function) inside the module.' },
    { name: 'algName', type: 'str', default: '', required: true, noneAction: 'ignore',
      info: 'Name under which the block is used in this YAML file.' },
    { name: 'pos', type: 'str', default: null, required: false, noneAction: 'ignore',
      info: 'Schedule the block before this existing block (e.g. `Output`).' },
    { name: 'superBlocks', type: 'str', default: null, required: false, noneAction: 'ignore',
      info: 'Register as a sub-block of this parent block instead of at the top level.' },
  ].map(o => ({ factoryDefault: null, expertMode: null, physicalUnit: null, generic: false,
                origin: ADD_CONFIG_BLOCKS, meta: null, ...o })),
})

// ── Labels ────────────────────────────────────────────────────────────────────

/** 'PileupReweighting' → 'Pileup Reweighting', 'PL_Jets' → 'PL Jets' (mirrors backend label_for). */
export function labelFor(name) {
  return String(name)
    .replace(/_/g, ' ')
    .replace(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/g, ' ')
    .trim()
}

// ── Option predicates ─────────────────────────────────────────────────────────

export function isGenericOption(opt) { return !!opt?.generic }
export function isExpertOption(opt)  { return Array.isArray(opt?.expertMode) && opt.expertMode.length > 0 }
export function isRequiredOption(opt) { return !!opt?.required || opt?.noneAction === 'error' }
export function optionChoices(opt) {
  const c = opt?.meta?.choices
  return Array.isArray(c) && c.length ? c : null
}

/** Group a block's non-generic options by the ConfigBlock class that declares them. */
export function optionsByOrigin(block) {
  const groups = []
  for (const opt of block?.options || []) {
    if (opt.generic) continue
    let g = groups.find(x => x.origin === opt.origin)
    if (!g) { g = { origin: opt.origin, options: [] }; groups.push(g) }
    g.options.push(opt)
  }
  return groups
}

// ── Custom (AddConfigBlocks) blocks ───────────────────────────────────────────

export function superBlockList(superBlocks) {
  if (!superBlocks) return []
  return Array.isArray(superBlocks) ? superBlocks.filter(Boolean) : [superBlocks]
}

/** Turn a catalogue entry (or a POST /api/introspect result) into a state entry. */
export function customEntryFromCatalogue(entry) {
  return {
    id: uuid(),
    modulePath: entry.modulePath,
    functionName: entry.functionName,
    algName: entry.algName,
    pos: entry.pos ?? null,
    superBlocks: entry.superBlocks ?? null,
    block: entry.block ?? null,
  }
}

/** Placeholder block for a custom entry that could not be introspected. */
export function opaqueBlock(entry, error) {
  return {
    name: entry.algName, factoryName: entry.algName, kind: 'class',
    category: TCT_CATEGORY, label: labelFor(entry.algName), classes: [],
    options: [], dependencies: [], subBlocks: [], parents: [],
    error: error || 'This custom block could not be introspected; its options are unknown.',
    opaque: true,
  }
}

/** The block definition an AddConfigBlocks entry contributes to the effective schema. */
export function customEntryToBlock(entry) {
  const base = entry.block ?? opaqueBlock(entry)
  return {
    ...base,
    name: entry.algName,
    factoryName: entry.algName,
    label: labelFor(entry.algName),
    category: base.category ?? TCT_CATEGORY,
    custom: true,
    customId: entry.id,
    subBlocks: [...(base.subBlocks || [])],
  }
}

/**
 * Base blocks + custom entries → the block list the editor works with.
 * Custom entries with `superBlocks` are attached under each named parent;
 * the rest are appended at the root.  Never mutates its inputs.
 */
export function effectiveBlocks(baseBlocks, customEntries = []) {
  const roots = (baseBlocks || []).map(b => ({ ...b, subBlocks: [...(b.subBlocks || [])] }))
  for (const entry of customEntries) {
    const blk = customEntryToBlock(entry)
    const parents = superBlockList(entry.superBlocks)
    if (parents.length === 0) {
      if (!roots.some(r => r.name === blk.name)) roots.push(blk)
      continue
    }
    for (const p of parents) {
      const root = roots.find(r => r.name === p)
      if (!root) continue
      if (root.subBlocks.some(s => s.name === blk.name)) continue
      root.subBlocks.push({ ...blk, factoryName: `${p}.${blk.name}`, category: null, parents })
    }
  }
  return roots
}

/** Convenience: effective blocks for a builder config. */
export function blocksForConfig(schema, config) {
  return effectiveBlocks(schema?.blocks, config?.addConfigBlocks)
}

// ── Sidebar grouping ──────────────────────────────────────────────────────────

/** [{ category, blocks }] in the schema's category order; unknown categories go last. */
export function categorize(blocks, categoryOrder = []) {
  const groups = new Map()
  for (const c of categoryOrder) groups.set(c, [])
  for (const b of blocks || []) {
    const c = b.category || 'Others'
    if (!groups.has(c)) groups.set(c, [])
    groups.get(c).push(b)
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length)
    .map(([category, list]) => ({ category, blocks: list }))
}
