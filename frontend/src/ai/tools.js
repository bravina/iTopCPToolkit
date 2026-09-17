/**
 * tools.js — the assistant's view of what the app already knows.
 *
 * Every tool is answered from memory: the introspected schema, the config the
 * user is editing, the serializer, the validator and the dependency checker.
 * Nothing here talks to the backend except `read_example`, which reads a
 * reference config through the endpoint the Builder already uses.
 *
 * `createTools(ctx)` returns the definitions to send to the model plus a
 * `run(name, input)` that executes one call; results are plain JSON.
 *
 * The two `propose_*` tools are the only ones that touch the config — and they
 * do not: they compile a proposal (see proposals.js) and hand it back on the
 * outcome, for the chat panel to offer the user.  Applying is the user's act.
 * In Reader they are not offered at all: `readOnly` leaves them out of `defs`
 * and out of `run`, so there is nothing to refuse.
 *
 * The config itself comes in two shapes — Builder's reducer state and Reader's
 * parsed YAML object.  `configView` is the only place that knows the
 * difference; validation runs once, on the YAML object either shape yields.
 */

import { buildSchemaLookup } from '../utils/schemaLookup.js'
import {
  ADD_CONFIG_BLOCKS, isExpertOption, isRequiredOption, optionChoices, optionMaxChoices,
} from '../utils/schema.js'
import { buildYamlObject, objectToYaml, toYamlString } from '../utils/yamlSerializer.js'
import { normalizeAddConfigBlocks } from '../utils/yamlToConfig.js'
import { validateConfig } from '../utils/yamlValidator.js'
import { checkDepsFromState, checkDepsFromYaml } from '../utils/dependencyChecker.js'
import { fetchExample } from '../api.js'
import { GLOSSARY_FIELDS, glossaryVersion, matchConcept } from './glossary.js'
import { OP_TYPES, proposalForModel, proposeConfig, proposeOperations } from './proposals.js'

const INFO_CHARS = 400
const EXAMPLE_CHARS = 20000
const LIST_LIMIT = 200

export const TOOL_DEFS = [
  {
    name: 'list_blocks',
    description:
      'List the configuration blocks this release accepts, with a one-line summary each. '
      + 'Use it to find the block that owns a feature before describing it.',
    parameters: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Case-insensitive substring matched against block name, category and summary.' },
        category: { type: 'string', description: 'Restrict to one sidebar category, e.g. Objects, Selection, Output.' },
        enabledOnly: { type: 'boolean', description: 'Only blocks enabled in the config being edited.' },
      },
      required: [],
    },
  },
  {
    name: 'describe_block',
    description:
      'Every option of one block: type, default, whether it is required or expert-only, allowed choices, '
      + 'unit, and the upstream docstring — plus its sub-blocks and dependencies. Add `option` to get that '
      + 'one option instead, in its block\'s context. Address things with the separate `block`, `subBlock` '
      + 'and `option` fields rather than joining them with a dot: "CommonServices.runSystematics" is an '
      + 'option of a block, not a sub-block, and only the fields say which you mean. '
      + 'This is the authority on option names and defaults; never state them from memory.',
    parameters: {
      type: 'object',
      properties: {
        block: { type: 'string', description: 'The block, e.g. Jets or CommonServices. A block name on its own, with no dots.' },
        subBlock: { type: 'string', description: 'A sub-block of that block, e.g. JVT. The block description lists them.' },
        option: {
          type: 'string',
          description: 'One option of the block (or of subBlock), e.g. runSystematics or minPt. Omit to describe '
            + 'the whole block. An option asked for by name is returned even when it is a generic one.',
        },
        includeGeneric: { type: 'boolean', description: 'Whole-block description only: include the generic options every block has (skipOnData, groupName, …). Default false.' },
        name: {
          type: 'string',
          description: 'Legacy: one dotted string ("Jets.JVT", "CommonServices.runSystematics"). Accepted, but the '
            + 'fields above say what you mean; the result reports how a dotted string was read.',
        },
      },
      required: ['block'],
    },
  },
  {
    name: 'list_examples',
    description: 'List the TopCPToolkit reference configs available in this image.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'read_example',
    description: 'The YAML of one reference config, with its includes already resolved.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'A path from list_examples.' } },
      required: ['path'],
    },
  },
  {
    name: 'current_config',
    description: "The user's configuration as it stands: the YAML it serialises to, the enabled blocks and any custom blocks declared through AddConfigBlocks.",
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'validate_config',
    description:
      'Run the app\'s own checks over the current config: schema validation (unknown blocks and options, '
      + 'type and choice mismatches, missing required options, expert-mode rules) and unresolved container '
      + 'or selection references. Use it before claiming a config is correct.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'explain_concept',
    description:
      'Look up a concept — JVT, pileup, b-tagging, an option name like jvtWP, a block name — in this '
      + "app's curated glossary: short, hand-written explainers of the physics the schema cannot carry. "
      + 'Each entry carries `reviewed`. An entry with reviewed=false has NOT been checked by a physicist: '
      + 'you may use it, but say that it is provisional. An empty field means nobody has written it yet — '
      + 'do not fill it in and attribute it to the glossary. When nothing matches, the result offers near '
      + 'misses; answer from describe_block plus your own knowledge, marking the latter as background to '
      + 'verify.',
    parameters: {
      type: 'object',
      properties: {
        concept: {
          type: 'string',
          description: 'The concept, option name or block name to look up, e.g. "JVT", "jvtWP", "b-tagging".',
        },
      },
      required: ['concept'],
    },
  },
  {
    name: 'propose_edits',
    description:
      'Offer the user a set of targeted edits to the config they are editing. Nothing changes when you call '
      + 'this: the app shows the user a review card with the YAML diff, and they press Apply or Reject. '
      + 'Call it only when the user has asked for a change. Operations run in order, each one seeing what the '
      + 'previous ones left behind: enable a block before setting its options, and toggle a sub-block on '
      + 'before setting its options. If an operation names something this release does not have, the call '
      + 'fails with the reason and nothing is offered — fix it and call again. The result carries the '
      + 'validator\'s verdict on what the edits produce: a proposal that leaves a required option unset is '
      + 'incomplete — set it and call again rather than offering it to the user.',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'One line, shown as the title of the review card, e.g. "Enable Jets with the AntiKt4 container".',
        },
        operations: {
          type: 'array',
          description: 'The edits, in the order they should be applied.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: OP_TYPES, description: 'Which edit to perform.' },
              name: { type: 'string', description: 'Block name — TOGGLE_BLOCK and SET_BLOCK_ENABLED.' },
              enabled: { type: 'boolean', description: 'SET_BLOCK_ENABLED only.' },
              blockName: { type: 'string', description: 'Block name — every other operation.' },
              instanceId: {
                type: 'string',
                description: 'Which instance of the block, as a 0-based index ("0"). Omit when the block has one instance.',
              },
              subName: { type: 'string', description: 'Sub-block name, e.g. JVT — the *_SUB_* operations.' },
              subInstanceId: { type: 'string', description: 'Which sub-block instance, as a 0-based index.' },
              key: { type: 'string', description: 'Option name — SET_OPTION, UNSET_OPTION, SET_SUB_OPTION.' },
              value: {
                type: 'string',
                description: 'The value as it would be written in the YAML: AnaJets, 25000, true, [10000, 20000]. '
                  + 'It is read with the option\'s declared type, so quoting a string is unnecessary.',
              },
              entry: {
                type: 'object',
                description: 'ADD_CUSTOM_BLOCK only: a block from the TopCPToolkit catalogue.',
                properties: {
                  algName: { type: 'string' },
                  modulePath: { type: 'string' },
                  functionName: { type: 'string' },
                },
              },
            },
            required: ['type'],
          },
        },
      },
      required: ['summary', 'operations'],
    },
  },
  {
    name: 'propose_config',
    description:
      'Offer the user a complete configuration as YAML — for "build me a config for X", where editing block '
      + 'by block would be absurd. It is read exactly as loading a file is, so applying it replaces the whole '
      + 'config and clears the undo history; prefer propose_edits for anything smaller. Nothing changes when '
      + 'you call this: the user reviews the diff and presses Apply or Reject.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One line, shown as the title of the review card.' },
        yaml: {
          type: 'string',
          description: 'The whole config: top-level block names mapping to their options, as a TopCPToolkit '
            + 'YAML file. Start from the closest reference config (read_example) where one fits.',
        },
      },
      required: ['summary', 'yaml'],
    },
  },
]

function trim(text, max) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** First non-empty class docstring, reduced to its first line. */
function summarize(def) {
  const doc = (def.classes || []).map(c => (typeof c === 'string' ? '' : c?.docstring)).find(Boolean)
  if (!doc) return def.error ? `Not introspectable: ${trim(def.error, 120)}` : ''
  return trim(String(doc).trim().split(/\n\s*\n/)[0].replace(/\s+/g, ' '), 200)
}

function describeOption(opt) {
  const out = {
    name: opt.name,
    type: opt.type ?? null,
    default: opt.default ?? null,
    required: isRequiredOption(opt),
  }
  if (opt.factoryDefault !== null && opt.factoryDefault !== undefined) out.factoryDefault = opt.factoryDefault
  const choices = optionChoices(opt)
  if (choices) {
    out.choices = choices
    const max = optionMaxChoices(opt)
    if (max) out.maxChoices = max
  }
  if (opt.physicalUnit) out.unit = opt.physicalUnit
  if (isExpertOption(opt)) out.expertMode = true
  if (opt.meta?.role) out.role = opt.meta.role
  if (opt.origin) out.declaredBy = opt.origin
  if (opt.info) out.info = trim(String(opt.info).replace(/\s+/g, ' ').trim(), INFO_CHARS)
  return out
}

function describeBlockDef(def, { includeGeneric = false } = {}) {
  const options = (def.options || []).filter(o => includeGeneric || !o.generic)
  return {
    name: def.name,
    factoryName: def.factoryName ?? def.name,
    category: def.category ?? null,
    kind: def.kind ?? 'class',
    summary: summarize(def),
    custom: !!def.custom,
    dependencies: (def.dependencies || []).map(d => ({ block: d.blockName, required: !!d.required })),
    subBlocks: (def.subBlocks || []).map(s => s.name),
    options: options.map(describeOption),
    genericOptionsOmitted: includeGeneric ? 0 : (def.options || []).length - options.length,
    ...(def.error ? { error: def.error } : {}),
  }
}

/** Names close enough to a miss to be worth offering back. */
function nearMisses(needle, names, limit = 8) {
  const q = String(needle ?? '').toLowerCase()
  if (!q) return []
  return names.filter(n => {
    const l = n.toLowerCase()
    return l.includes(q) || q.includes(l) || l.slice(0, 3) === q.slice(0, 3)
  }).slice(0, limit)
}

/** The key as the schema spells it, matching case-insensitively as a fallback. */
function canonicalKey(map, needle) {
  if (!needle || !map) return null
  if (Object.hasOwn(map, needle)) return needle
  const l = String(needle).toLowerCase()
  return Object.keys(map).find(k => k.toLowerCase() === l) ?? null
}

function segments(value) {
  return String(value ?? '').split('.').map(s => s.trim()).filter(Boolean)
}

const sameName = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase()

/**
 * The address one describe_block call carries.
 *
 * The structured fields say what the caller means; a dotted string says only
 * that there are more segments, which the block itself has to disambiguate —
 * `Jets.JVT` is a sub-block, `CommonServices.runSystematics` an option, and
 * nothing in the string tells them apart.
 */
function parseAddress(input) {
  const chain = segments(input.block ?? input.name ?? input.blockName ?? input.path)
  const subSegs = segments(input.subBlock ?? input.subName ?? input.sub)
  const optSegs = segments(input.option ?? input.optionName ?? input.key)
  const dotted = [input.block, input.name, input.blockName, input.path, input.subBlock, input.option]
    .find(v => typeof v === 'string' && v.includes('.')) ?? null
  return {
    block: chain[0] ?? null,
    pending: chain.slice(1),
    subBlock: subSegs.at(-1) ?? (optSegs.length > 2 ? optSegs.at(-2) : null),
    option: optSegs.at(-1) ?? null,
    from: dotted,
  }
}

/**
 * A name that matched nothing.  The old error listed sub-blocks alone, so a
 * model that addressed an option got back what reads like proof the option
 * does not exist; both namespaces answer here, near misses first.
 */
function unknownMemberError(parent, blockName, needle, sub = null) {
  const owner = sub ? parent.subBlocksByName[sub] : parent
  const subs = Object.keys(parent.subBlocksByName)
  const opts = Object.keys(owner.optionsByName)
  const nearOpts = nearMisses(needle, opts)
  const nearSubs = sub ? [] : nearMisses(needle, subs)
  const parts = [sub
    ? `Sub-block '${blockName}.${sub}' has no option named '${needle}'.`
    : `Block '${blockName}' has no sub-block and no option named '${needle}'.`]
  if (nearOpts.length) parts.push(`Options like it: ${nearOpts.join(', ')}.`)
  if (nearSubs.length) parts.push(`Sub-blocks like it: ${nearSubs.join(', ')}.`)
  if (!sub) parts.push(`Its sub-blocks: ${subs.join(', ') || 'none'}.`)
  parts.push(`Call describe_block({ block: '${blockName}'${sub ? `, subBlock: '${sub}'` : ''}, `
    + 'includeGeneric: true }) for the full option list before concluding anything is missing.')
  return new Error(parts.join(' '))
}

/** Builder state, recognised by its map of block states. */
function isBuilderState(config) {
  return !!config && typeof config === 'object'
    && !!config.blocks && typeof config.blocks === 'object' && !Array.isArray(config.blocks)
}

/**
 * One interface over the two config shapes: Builder's reducer state and
 * Reader's parsed YAML object.  Both answer "is this block on", "what YAML
 * object is this" and "what do the reference checks say" — the validator then
 * runs once, on the object.
 */
function configView(ctx, blocks) {
  const shape = ctx.configShape ?? (isBuilderState(ctx.config) ? 'state' : 'yaml')

  if (shape === 'state') {
    return {
      shape,
      isEnabled: name => !!ctx.config?.blocks?.[name]?.enabled,
      yamlObject: () => buildYamlObject(ctx.config, ctx.schema),
      depIssues: () => checkDepsFromState(ctx.config, ctx.registry, blocks()),
      summary: () => ({
        yaml: toYamlString(ctx.config, ctx.schema),
        enabledBlocks: Object.entries(ctx.config?.blocks || {}).filter(([, s]) => s?.enabled).map(([n]) => n),
        customBlocks: (ctx.config?.addConfigBlocks || []).map(e => ({
          algName: e.algName, modulePath: e.modulePath, functionName: e.functionName,
        })),
        unknownBlocks: Object.keys(ctx.config?.unknown || {}),
      }),
    }
  }

  const obj = () => (ctx.config && typeof ctx.config === 'object' ? ctx.config : {})
  return {
    shape: 'yaml',
    isEnabled: name => name in obj(),
    yamlObject: obj,
    depIssues: () => checkDepsFromYaml(obj(), ctx.registry, blocks()),
    summary: () => {
      const known = new Set(blocks().map(b => b.name))
      const names = Object.keys(obj()).filter(n => n !== ADD_CONFIG_BLOCKS)
      return {
        yaml: Object.keys(obj()).length ? objectToYaml(obj()) : '# No config loaded\n',
        enabledBlocks: names,
        customBlocks: normalizeAddConfigBlocks(obj()[ADD_CONFIG_BLOCKS]).map(e => ({
          algName: e.algName, modulePath: e.modulePath, functionName: e.functionName,
        })),
        unknownBlocks: names.filter(n => !known.has(n)),
      }
    },
  }
}

/**
 * ctx: { schema, config, blocks, registry, readExample?, readOnly?, configShape? }
 *   blocks      — effective blocks (base + AddConfigBlocks), as App computes them
 *   registry    — container/selection registry for the dependency checker, built
 *                 from whichever config shape is being passed
 *   readOnly    — Reader: the propose_* tools are absent, not refusing
 *   configShape — 'state' (Builder) or 'yaml' (Reader's loaded object); detected
 *                 from the config when omitted
 */
export function createTools(ctx) {
  const readExample = ctx.readExample ?? fetchExample

  function blocks() { return ctx.blocks || [] }

  const view = configView(ctx, blocks)
  const canPropose = !ctx.readOnly && view.shape === 'state'

  function listBlocks({ filter, category, enabledOnly } = {}) {
    const needle = String(filter ?? '').toLowerCase()
    const rows = blocks()
      .filter(def => !enabledOnly || view.isEnabled(def.name))
      .filter(def => !category || (def.category || 'Others').toLowerCase() === String(category).toLowerCase())
      .map(def => ({
        name: def.name,
        category: def.category ?? null,
        enabled: view.isEnabled(def.name),
        options: (def.options || []).filter(o => !o.generic).length,
        subBlocks: (def.subBlocks || []).map(s => s.name),
        summary: summarize(def),
      }))
      .filter(row => !needle
        || row.name.toLowerCase().includes(needle)
        || (row.category || '').toLowerCase().includes(needle)
        || row.summary.toLowerCase().includes(needle))
    return {
      blocks: rows.slice(0, LIST_LIMIT),
      total: rows.length,
      truncated: rows.length > LIST_LIMIT,
    }
  }

  /**
   * One block, one sub-block or one option, addressed by field.
   *
   * A dotted string is still accepted — the Explain label is `Block.option`
   * and models send it — and resolved sub-block first, then option, because
   * `Parent.SubBlock` is what the tool used to document.  Every result carries
   * `interpreted`, so a reading the caller did not mean is visible in the
   * transcript rather than silent.
   */
  function describeBlock(input = {}) {
    const { includeGeneric } = input
    const addr = parseAddress(input)
    if (!addr.block) {
      throw new Error("describe_block needs a block: { block: 'Jets' } for the whole block, "
        + "{ block: 'Jets', option: 'minPt' } for one option.")
    }

    const lookup = buildSchemaLookup(blocks())
    const blockName = canonicalKey(lookup, addr.block)
    if (!blockName) {
      const near = nearMisses(addr.block, Object.keys(lookup))
      throw new Error(`No block named '${addr.block}'.${near.length ? ` Did you mean: ${near.join(', ')}?` : ' Use list_blocks.'}`)
    }
    const parent = lookup[blockName]
    const notes = []
    let subName = addr.subBlock
    let optName = addr.option
    let optFromPath = false

    // Whatever the dots left over: a sub-block if the block has one by that
    // name, an option otherwise — and say so when both readings existed.
    for (const seg of addr.pending) {
      if (sameName(seg, subName) || sameName(seg, optName)) continue
      const asSub = subName ? null : canonicalKey(parent.subBlocksByName, seg)
      if (asSub) {
        subName = asSub
        if (canonicalKey(parent.optionsByName, seg)) {
          notes.push(`'${blockName}' has both a sub-block and an option named '${asSub}'; read as the sub-block. `
            + `Call describe_block({ block: '${blockName}', option: '${asSub}' }) for the option.`)
        }
        continue
      }
      if (!optName) { optName = seg; optFromPath = true; continue }
      notes.push(`Ignored the trailing segment '${seg}'.`)
    }

    if (subName) {
      const key = canonicalKey(parent.subBlocksByName, subName)
      if (!key) {
        const asOpt = optName ? null : canonicalKey(parent.optionsByName, subName)
        if (!asOpt) throw unknownMemberError(parent, blockName, subName)
        notes.push(`'${blockName}' has no sub-block '${subName}', but it has an option of that name: `
          + 'described as the option.')
        optName = asOpt
        subName = null
      } else {
        subName = key
      }
    }

    const owner = subName ? parent.subBlocksByName[subName] : parent
    const interpreted = target => ({
      target,
      block: blockName,
      subBlock: subName ?? null,
      option: optName ?? null,
      ...(addr.from ? { from: addr.from } : {}),
    })
    const withNotes = result => (notes.length ? { ...result, note: notes.join(' ') } : result)

    if (optName) {
      const key = canonicalKey(owner.optionsByName, optName)
      if (!key) {
        // An option name that is really a sub-block: answer it, do not refuse.
        const asSub = subName ? null : canonicalKey(parent.subBlocksByName, optName)
        if (!asSub) throw unknownMemberError(parent, blockName, optName, subName)
        notes.push(`'${blockName}' has no option '${optName}', but it has a sub-block of that name: `
          + 'described as the sub-block.')
        subName = asSub
        optName = null
        return withNotes({
          interpreted: interpreted('subBlock'),
          parent: blockName,
          ...describeBlockDef(parent.subBlocksByName[asSub].def, { includeGeneric }),
        })
      }
      const opt = owner.optionsByName[key]
      optName = key
      if (optFromPath) {
        notes.push(`Read '${addr.from}' as the option '${key}' of ${subName ? `sub-block '${blockName}.${subName}'` : `block '${blockName}'`}`
          + ' — there is no sub-block of that name. Address options as { block, option } to be unambiguous.')
      }
      // Generic options are omitted from a whole-block listing, never from an
      // answer to someone who asked for one by name.
      if (opt.generic) {
        notes.push(`'${key}' is one of the generic options every block accepts; whole-block descriptions omit `
          + 'them unless includeGeneric is set.')
      }
      return withNotes({
        interpreted: interpreted('option'),
        block: blockName,
        ...(subName ? { subBlock: subName } : {}),
        blockSummary: summarize(owner.def),
        option: describeOption(opt),
        ...(opt.generic ? { generic: true } : {}),
      })
    }

    if (subName) {
      return withNotes({
        interpreted: interpreted('subBlock'),
        parent: blockName,
        ...describeBlockDef(owner.def, { includeGeneric }),
      })
    }
    return withNotes({
      interpreted: interpreted('block'),
      ...describeBlockDef(parent.def, { includeGeneric }),
    })
  }

  function listExamples() {
    const examples = (ctx.schema?.examples || []).map(e => ({ path: e.path, name: e.name, source: e.source ?? null }))
    return { examples, total: examples.length }
  }

  async function readExampleTool({ path }) {
    if (!path) throw new Error('read_example needs a path from list_examples')
    const known = (ctx.schema?.examples || []).some(e => e.path === path)
    if (!known) throw new Error(`Unknown example '${path}'. Call list_examples first.`)
    const text = await readExample(path)
    return { path, yaml: trim(text, EXAMPLE_CHARS), truncated: String(text).length > EXAMPLE_CHARS }
  }

  function currentConfig() {
    return { ...view.summary(), readOnly: !canPropose }
  }

  function validate() {
    const issues = [
      ...validateConfig(view.yamlObject(), blocks()),
      ...view.depIssues(),
    ]
    const shape = i => ({ path: i.path, message: i.message, ...(i.kind ? { kind: i.kind } : {}) })
    const errors = issues.filter(i => i.severity === 'error').map(shape)
    const warnings = issues.filter(i => i.severity !== 'error').map(shape)
    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * The glossary answer, `reviewed` and all.  A miss is a result, not an
   * error: the model is told what is near and how to proceed without it.
   */
  function explainConcept({ concept }) {
    const query = String(concept ?? '').trim()
    if (!query) throw new Error('explain_concept needs a concept, e.g. "JVT" or "jvtWP"')
    const { matches, suggestions } = matchConcept(query)
    const base = { concept: query, glossaryVersion: glossaryVersion() }

    if (!matches.length) {
      return {
        ...base,
        matches: [],
        suggestions: suggestions.map(e => ({ id: e.id, title: e.title })),
        note: 'The glossary has no entry for this. Answer from describe_block and from your own knowledge, '
          + 'and mark the latter as background for the user to verify.',
      }
    }

    const unreviewed = matches.filter(e => !e.reviewed).map(e => e.id)
    return {
      ...base,
      matches: matches.map(e => ({
        id: e.id,
        title: e.title,
        aliases: e.aliases,
        ...Object.fromEntries(GLOSSARY_FIELDS.map(f => [f, e[f]])),
        see_also: e.see_also,
        refs: e.refs,
        reviewed: e.reviewed,
      })),
      unreviewed,
      ...(unreviewed.length
        ? {
          note: `Not yet reviewed by a physicist: ${unreviewed.join(', ')}. You may use these, but tell the `
            + 'user they are provisional. An empty field is deliberate — nobody has written it yet, so do '
            + 'not fill it in and attribute it to the glossary.',
        }
        : {}),
    }
  }

  function proposeEdits({ operations, summary }) {
    const proposal = proposeOperations({
      operations, summary, config: ctx.config, blocks: blocks(), schema: ctx.schema,
    })
    return { __proposal: proposal, ...proposalForModel(proposal) }
  }

  function proposeWholeConfig({ yaml, summary }) {
    const proposal = proposeConfig({ yaml, summary, config: ctx.config, schema: ctx.schema })
    return { __proposal: proposal, ...proposalForModel(proposal) }
  }

  const impl = {
    list_blocks: listBlocks,
    describe_block: describeBlock,
    list_examples: listExamples,
    read_example: readExampleTool,
    current_config: currentConfig,
    validate_config: validate,
    explain_concept: explainConcept,
    ...(canPropose ? { propose_edits: proposeEdits, propose_config: proposeWholeConfig } : {}),
  }

  const defs = TOOL_DEFS.filter(d => d.name in impl)

  return {
    defs,
    names: defs.map(t => t.name),
    readOnly: !canPropose,
    configShape: view.shape,
    /**
     * Never throws: a failed call is a result the model can read and retry.
     * A proposal rides on the outcome rather than in the result the model
     * sees — the panel needs the whole state, the model does not.
     */
    async run(name, input) {
      const fn = impl[name]
      if (!fn) return { ok: false, error: `Unknown tool '${name}'. Available: ${Object.keys(impl).join(', ')}` }
      try {
        const out = await fn(input || {})
        if (out && out.__proposal) {
          const { __proposal, ...result } = out
          return { ok: true, result, proposal: __proposal }
        }
        return { ok: true, result: out }
      } catch (err) {
        return { ok: false, error: err?.message || String(err) }
      }
    },
  }
}
