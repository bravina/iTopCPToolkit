/**
 * proposals.js — the assistant proposes, the user applies.
 *
 * A proposal is compiled here and never dispatched.  The operations are
 * replayed onto a copy of the builder state with the very reducer the UI
 * uses, so the diff the user reviews is exactly what Apply will do.
 *
 * Two shapes:
 *   - `edits`  — reducer actions (TOGGLE_BLOCK, SET_OPTION, …), applied later
 *                as one undoable step via APPLY_OPS.
 *   - `config` — a whole YAML config, routed through yamlToConfig, the path
 *                YamlLoader already takes, and therefore a file load.
 *
 * Compilation is strict: a block, option, sub-block or instance that does not
 * exist, a value of the wrong type, an operation with no effect, or a sub-block
 * instance left with no options set, is a hard error handed back to the model.
 * Everything the validator merely dislikes (missing required option, unknown
 * choice, unresolved reference) rides along on the proposal as an issue for the
 * user to judge — with unset *required* options also named to the model, whose
 * job it was to set them.
 */

import yaml from 'js-yaml'
import { v4 as uuid } from 'uuid'
import { _reducer as configReducer } from '../hooks/useConfig.js'
import { buildSchemaLookup } from '../utils/schemaLookup.js'
import { getSubState } from '../utils/configState.js'
import { blocksForConfig, customEntryFromCatalogue, superBlockList } from '../utils/schema.js'
import { buildYamlObject, objectToYaml } from '../utils/yamlSerializer.js'
import { typeMismatch, validateConfig } from '../utils/yamlValidator.js'
import { checkDepsFromState } from '../utils/dependencyChecker.js'
import { buildRegistryFromState } from '../utils/collectionRegistry.js'
import { yamlToConfigSync } from '../utils/yamlToConfig.js'
import { computeDiff } from '../utils/yamlLineBuilder.js'

export const OP_TYPES = [
  'TOGGLE_BLOCK', 'SET_BLOCK_ENABLED', 'SET_OPTION', 'UNSET_OPTION',
  'ADD_INSTANCE', 'REMOVE_INSTANCE', 'TOGGLE_SUB_BLOCK', 'SET_SUB_OPTION',
  'ADD_SUB_INSTANCE', 'REMOVE_SUB_INSTANCE', 'ADD_CUSTOM_BLOCK',
]

const MAX_OPS = 200
const YAML_PREVIEW_CHARS = 20000

/** An operation the state cannot express: the model gets this back and retries. */
class OpError extends Error {}

function kindOf(v) {
  if (Array.isArray(v)) return 'a list'
  if (v === null) return 'null'
  if (typeof v === 'string') return `a string (${JSON.stringify(v)})`
  return typeof v
}

/** Names close enough to be worth suggesting after a miss. */
function near(names, needle) {
  const q = String(needle ?? '').toLowerCase()
  return names.filter(n => {
    const l = n.toLowerCase()
    return l.includes(q) || q.includes(l) || l.slice(0, 3) === q.slice(0, 3)
  }).slice(0, 8)
}

function suggest(names, needle) {
  const hits = near(names, needle)
  return hits.length ? ` Did you mean: ${hits.join(', ')}?` : ''
}

function quote(v) {
  if (typeof v === 'string') return `'${v}'`
  return JSON.stringify(v)
}

// ── Operation compilation ────────────────────────────────────────────────────

/** `instanceId` may be a real _id or a 0-based index; both resolve to an _id. */
function resolveInstance(instances, ref, label) {
  const list = instances || []
  if (ref === undefined || ref === null || ref === '') {
    if (list.length === 1) return list[0]._id
    throw new OpError(`${label} has ${list.length} instances — set instanceId to an index between 0 and ${list.length - 1}`)
  }
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    const i = Number(ref)
    if (!list[i]) throw new OpError(`${label} has ${list.length} instance(s); there is no index ${i}`)
    return list[i]._id
  }
  const found = list.find(x => x._id === ref)
  if (!found) throw new OpError(`${label} has no instance with id '${ref}'`)
  return found._id
}

function requireBlock(state, lookup, name) {
  if (!name) throw new OpError('this operation needs a block name')
  if (!state.blocks[name]) {
    const known = Object.keys(state.blocks)
    throw new OpError(`No block named '${name}' in this release.${suggest(known, name)}`)
  }
  return lookup[name]
}

function requireEnabled(state, name) {
  if (!state.blocks[name].enabled) {
    throw new OpError(`Block '${name}' is not enabled — a disabled block is not written to the YAML. `
      + `Put { "type": "SET_BLOCK_ENABLED", "name": "${name}", "enabled": true } before this operation.`)
  }
}

function requireOption(info, key, blockName) {
  if (!key) throw new OpError(`this operation needs an option name for block '${blockName}'`)
  if (info.def.opaque) return                       // options unknown; nothing to check against
  if (info.optionsByName[key]) return
  if (info.subBlocksByName?.[key]) {
    throw new OpError(`'${key}' is a sub-block of '${blockName}', not an option — `
      + 'use TOGGLE_SUB_BLOCK and SET_SUB_OPTION.')
  }
  const known = Object.keys(info.optionsByName)
  throw new OpError(`Option '${key}' is not used by block '${blockName}'.${suggest(known, key)}`)
}

/**
 * The model writes a value the way the YAML file does, so read it that way:
 * a string option keeps its text, anything else is parsed as the YAML scalar
 * it is (25000, true, [10000, 20000]).  A value that already arrived typed is
 * left alone.
 */
function coerceValue(opt, raw) {
  if (typeof raw !== 'string' || opt?.type === 'str') return raw
  try {
    const parsed = yaml.load(raw)
    return parsed === undefined ? raw : parsed
  } catch {
    return raw
  }
}

function requireValueType(opt, key, value, blockName) {
  if (!opt || value === null || value === undefined) return
  if (typeMismatch(opt.type, value)) {
    throw new OpError(`Option '${blockName}.${key}' is ${opt.type}; got ${kindOf(value)}.`)
  }
}

function requireSubBlock(info, subName, blockName) {
  if (!subName) throw new OpError(`this operation needs a sub-block name for block '${blockName}'`)
  const sub = info.subBlocksByName?.[subName]
  if (sub) return sub
  if (info.optionsByName?.[subName]) {
    throw new OpError(`'${subName}' is an option of '${blockName}', not a sub-block — `
      + 'use SET_OPTION.')
  }
  const known = Object.keys(info.subBlocksByName || {})
  throw new OpError(`Block '${blockName}' has no sub-block '${subName}'. `
    + `It has: ${known.join(', ') || 'none'}`)
}

function catalogueEntry(schema, op) {
  const entry = op.entry || {}
  const catalogue = schema?.catalogue || []
  const found = catalogue.find(c =>
    (entry.modulePath && entry.functionName
      && c.modulePath === entry.modulePath && c.functionName === entry.functionName)
    || (!entry.modulePath && entry.algName && c.algName === entry.algName))
  if (!found) {
    const known = catalogue.map(c => c.algName)
    throw new OpError(`No catalogue entry for '${entry.algName ?? entry.functionName ?? '?'}'. `
      + `Only blocks TopCPToolkit already registers can be added: ${known.join(', ') || 'none in this image'}.`)
  }
  return customEntryFromCatalogue({ ...found, ...(entry.algName ? { algName: entry.algName } : {}) })
}

/** Position of an instance in its list — the index the validator's paths use. */
function indexOf(list, id) {
  const i = (list || []).findIndex(x => x._id === id)
  return i < 0 ? 0 : i
}

function instanceOf(state, blockName, instanceId) {
  return state.blocks?.[blockName]?.instances.find(i => i._id === instanceId)
}

/**
 * One human-readable line per operation, for the review card.  Locations are
 * spelled the way the validator spells them — `Block[i].Sub[j].option` — so a
 * change and an issue about it read as the same place.
 */
function labelFor(action, state, next) {
  const block = state.blocks?.[action.blockName]
  const at = `${action.blockName}[${indexOf(block?.instances, action.instanceId)}]`
  const subs = (s) => getSubState(instanceOf(s, action.blockName, action.instanceId), action.subName).instances
  const subAt = () => `${at}.${action.subName}[${indexOf(subs(state), action.subInstanceId)}]`
  switch (action.type) {
    case 'TOGGLE_BLOCK': return `toggle block ${action.name}`
    case 'SET_BLOCK_ENABLED': return `${action.enabled ? 'enable' : 'disable'} block ${action.name}`
    case 'SET_OPTION': return `${at}.${action.key} = ${quote(action.value)}`
    case 'UNSET_OPTION': return `unset ${at}.${action.key}`
    case 'ADD_INSTANCE': return `add ${action.blockName}[${next.blocks[action.blockName].instances.length - 1}]`
    case 'REMOVE_INSTANCE': return `remove ${at}`
    case 'TOGGLE_SUB_BLOCK': return `toggle ${at}.${action.subName}`
    case 'SET_SUB_OPTION': return `${subAt()}.${action.key} = ${quote(action.value)}`
    case 'ADD_SUB_INSTANCE': return `add ${at}.${action.subName}[${subs(next).length - 1}]`
    case 'REMOVE_SUB_INSTANCE': return `remove ${subAt()}`
    case 'ADD_CUSTOM_BLOCK': return `declare custom block ${action.entry.algName}`
    default: return action.type
  }
}

/**
 * A sub-block instance with no options set writes an empty `- {}` into the
 * YAML: a second working point, or a second selection, running on defaults
 * nobody asked for.  It only ever comes from an ADD_SUB_INSTANCE the model then
 * failed to fill in, so it is a hard error like any other operation that does
 * not do what it says.  Only sub-blocks this proposal touched are judged; what
 * the user already had is theirs.
 */
function emptySubInstances(state, touched) {
  const errors = []
  for (const key of touched) {
    const [blockName, instanceId, subName] = key.split('\u0000')
    const inst = instanceOf(state, blockName, instanceId)
    const sub = inst && getSubState(inst, subName)
    if (!sub?.enabled || sub.instances.length < 2) continue      // a lone empty instance is "on, with defaults"
    const at = `${blockName}[${indexOf(state.blocks[blockName].instances, instanceId)}].${subName}`
    sub.instances.forEach((si, i) => {
      if (Object.keys(si.options || {}).length) return
      errors.push(`${at}[${i}] would be left with no options set — remove the ADD_SUB_INSTANCE `
        + `that created it, or set its options with SET_SUB_OPTION on subInstanceId "${i}".`)
    })
  }
  return errors
}

/** One operation → one reducer action, checked against the state it will hit. */
function compileOne(op, state, lookup, schema) {
  const type = String(op.type ?? '').trim().toUpperCase()
  if (!OP_TYPES.includes(type)) {
    throw new OpError(`Unknown operation '${op.type}'. Use one of: ${OP_TYPES.join(', ')}.`)
  }
  const name = op.blockName ?? op.name

  if (type === 'ADD_CUSTOM_BLOCK') {
    const entry = catalogueEntry(schema, op)
    if (state.addConfigBlocks.some(e => e.algName === entry.algName)) {
      throw new OpError(`Custom block '${entry.algName}' is already declared in AddConfigBlocks.`)
    }
    if (!superBlockList(entry.superBlocks).length && state.blocks[entry.algName]) {
      throw new OpError(`'${entry.algName}' already exists as a block; enable it instead.`)
    }
    return { type, entry }
  }

  const info = requireBlock(state, lookup, name)

  if (type === 'TOGGLE_BLOCK') return { type, name }
  if (type === 'SET_BLOCK_ENABLED') {
    if (typeof op.enabled !== 'boolean') throw new OpError("SET_BLOCK_ENABLED needs 'enabled' as a boolean.")
    return { type, name, enabled: op.enabled }
  }

  requireEnabled(state, name)
  const block = state.blocks[name]

  if (type === 'ADD_INSTANCE') return { type, blockName: name, blockDef: info.def }

  const instanceId = resolveInstance(block.instances, op.instanceId, `Block '${name}'`)

  if (type === 'REMOVE_INSTANCE') {
    if (block.instances.length < 2) {
      throw new OpError(`Block '${name}' has a single instance, which cannot be removed — `
        + 'disable the block instead.')
    }
    return { type, blockName: name, instanceId }
  }

  if (type === 'SET_OPTION' || type === 'UNSET_OPTION') {
    requireOption(info, op.key, name)
    if (type === 'UNSET_OPTION') return { type, blockName: name, instanceId, key: op.key }
    const value = coerceValue(info.optionsByName?.[op.key], op.value)
    requireValueType(info.optionsByName?.[op.key], op.key, value, name)
    return { type, blockName: name, instanceId, key: op.key, value }
  }

  const sub = requireSubBlock(info, op.subName, name)
  const subName = op.subName
  if (type === 'TOGGLE_SUB_BLOCK') return { type, blockName: name, instanceId, subName }

  const inst = block.instances.find(i => i._id === instanceId)
  const subState = getSubState(inst, subName)
  if (!subState.enabled) {
    throw new OpError(`Sub-block '${name}.${subName}' is not enabled. Put `
      + `{ "type": "TOGGLE_SUB_BLOCK", "blockName": "${name}", "subName": "${subName}" } before this operation.`)
  }
  if (type === 'ADD_SUB_INSTANCE') return { type, blockName: name, instanceId, subName }

  const subInstanceId = resolveInstance(subState.instances, op.subInstanceId, `Sub-block '${name}.${subName}'`)
  if (type === 'REMOVE_SUB_INSTANCE') {
    if (subState.instances.length < 2) {
      throw new OpError(`Sub-block '${name}.${subName}' has a single instance, which cannot be removed — `
        + 'toggle the sub-block off instead.')
    }
    return { type, blockName: name, instanceId, subName, subInstanceId }
  }

  // SET_SUB_OPTION
  requireOption(sub, op.key, `${name}.${subName}`)
  const subOpt = sub.optionsByName?.[op.key]
  const value = coerceValue(subOpt, op.value)
  requireValueType(subOpt, op.key, value, `${name}.${subName}`)
  return { type, blockName: name, instanceId, subName, subInstanceId, key: op.key, value }
}

/**
 * Compile a list of operations against `config`, each one checked on the state
 * the previous ones leave behind.  Returns { actions, labels, state, errors };
 * a failing operation is skipped so the model gets every problem at once.
 */
export function compileOperations(operations, { config, blocks, schema }) {
  const ops = Array.isArray(operations) ? operations : [operations]
  const actions = []
  const labels = []
  const errors = []
  const touchedSubs = new Set()
  let state = config
  let lookup = buildSchemaLookup(schema?.blocks ? blocksForConfig(schema, state) : blocks)

  ops.forEach((op, i) => {
    if (!op || typeof op !== 'object') {
      errors.push(`operation ${i}: expected an object with a 'type', got ${kindOf(op)}`)
      return
    }
    try {
      const action = compileOne(op, state, lookup, schema)
      const next = configReducer(state, action)
      if (next === state) {
        errors.push(`operation ${i} (${action.type}): had no effect on the config`)
        return
      }
      actions.push(action)
      labels.push(labelFor(action, state, next))
      if (action.subName) touchedSubs.add([action.blockName, action.instanceId, action.subName].join('\u0000'))
      state = next
      if (action.type === 'ADD_CUSTOM_BLOCK') {
        lookup = buildSchemaLookup(schema?.blocks ? blocksForConfig(schema, state) : blocks)
      }
    } catch (err) {
      if (!(err instanceof OpError)) throw err
      errors.push(`operation ${i} (${op.type ?? '?'}): ${err.message}`)
    }
  })

  errors.push(...emptySubInstances(state, touchedSubs))
  return { actions, labels, state, errors }
}

/** Replay compiled actions — the same fold APPLY_OPS performs in the reducer. */
export function applyOperations(state, actions) {
  return configReducer(state, { type: 'APPLY_OPS', actions })
}

// ── Proposals ────────────────────────────────────────────────────────────────

function issuesOf(state, schema, configObj) {
  const blocks = blocksForConfig(schema, state)
  const raw = [
    ...validateConfig(configObj, blocks),
    ...checkDepsFromState(state, buildRegistryFromState(state, blocks), blocks),
  ]
  const shape = i => ({ path: i.path, message: i.message, ...(i.kind ? { kind: i.kind } : {}) })
  return {
    errors: raw.filter(i => i.severity === 'error').map(shape),
    warnings: raw.filter(i => i.severity !== 'error').map(shape),
  }
}

function finish({ kind, summary, labels, actions, state, config, schema }) {
  const baseConfigObj = buildYamlObject(config, schema)
  const configObj = buildYamlObject(state, schema)
  const diff = computeDiff(baseConfigObj, configObj)
  const stats = { added: 0, removed: 0, changed: 0 }
  for (const d of Object.values(diff)) stats[d.status] += 1
  return {
    id: uuid(),
    kind,
    summary: String(summary || '').trim() || 'Proposed change',
    labels,
    actions,
    state,
    configObj,
    baseConfigObj,
    baseKey: JSON.stringify(baseConfigObj),
    yaml: objectToYaml(configObj),
    stats,
    issues: issuesOf(state, schema, configObj),
  }
}

/** Build an `edits` proposal. Throws (hard error) if the state cannot be built. */
export function proposeOperations({ operations, summary, config, blocks, schema }) {
  const list = Array.isArray(operations) ? operations : (operations ? [operations] : [])
  if (!list.length) throw new Error('propose_edits needs at least one operation.')
  if (list.length > MAX_OPS) throw new Error(`Too many operations (${list.length}); the limit is ${MAX_OPS}.`)

  const { actions, labels, state, errors } = compileOperations(list, { config, blocks, schema })
  if (errors.length) {
    throw new Error(`The proposal was rejected, nothing was offered to the user. Fix and call again:\n- ${errors.join('\n- ')}`)
  }
  if (!actions.length) throw new Error('The operations leave the config unchanged.')
  return finish({ kind: 'edits', summary, labels, actions, state, config, schema })
}

/** Build a `config` proposal from YAML text — the YamlLoader path. */
export function proposeConfig({ yaml: text, summary, config, schema }) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('propose_config needs the YAML of a complete config.')
  if (text.length > YAML_PREVIEW_CHARS) throw new Error(`The YAML is ${text.length} characters; the limit is ${YAML_PREVIEW_CHARS}.`)
  let parsed
  try {
    parsed = yaml.load(text)
  } catch (err) {
    throw new Error(`YAML parse error: ${err?.reason || err?.message || err}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The YAML must be a mapping of block names to their options.')
  }
  const state = yamlToConfigSync(parsed, schema)
  return finish({ kind: 'config', summary, labels: Object.keys(parsed), actions: [], state, config, schema })
}

/** Validator warnings that say the proposal never set an option the block needs. */
function unsetRequired(issues) {
  return (issues.warnings || []).filter(i => /^Required option /.test(i.message)).map(i => i.path)
}

/** What the model is told: never the state, only what it needs to judge. */
export function proposalForModel(proposal) {
  const missing = unsetRequired(proposal.issues)
  return {
    proposalId: proposal.id,
    kind: proposal.kind,
    summary: proposal.summary,
    changes: proposal.labels,
    diff: proposal.stats,
    validation: proposal.issues,
    ...(missing.length ? {
      incomplete: `This proposal is INCOMPLETE: it leaves ${missing.length} required option(s) unset `
        + `(${missing.join(', ')}). Set them and propose again — do not ask the user to apply it as it stands.`,
    } : {}),
    status: 'awaiting the user — the config has NOT changed; the user must press Apply in the review card.',
    ...(proposal.kind === 'config'
      ? { note: 'Applying this replaces the whole config and clears the undo history.' }
      : {}),
  }
}
