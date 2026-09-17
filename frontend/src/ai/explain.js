/**
 * explain.js — what an "Explain this" click actually sends.
 *
 * The popover knows exactly what was clicked, so the request travels as a
 * locator the app resolves — never as a selected string.  Resolution reads
 * the schema entry (type, default, choices, meta role, docstring) and the
 * config in hand (the value actually set, the rest of the block around it),
 * so the model starts from facts instead of spending a round trip fetching
 * them.
 *
 * Builder resolves against the YAML its state serialises to and Reader
 * against the file it loaded: the same shape, so one resolver serves both.
 */

import yaml from 'js-yaml'
import { buildSchemaLookup } from '../utils/schemaLookup.js'
import { isExpertOption, isRequiredOption, optionChoices, optionMaxChoices } from '../utils/schema.js'

const DOC_CHARS = 700
const SIBLING_LIMIT = 12
const MAX_FOLLOW_UPS = 3

// ── Locators ────────────────────────────────────────────────────────────────

export function blockLocator(blockName) {
  return { kind: 'block', blockName }
}

export function optionLocator({ blockName, optionName, subName = null, instance = 0, value }) {
  return {
    kind: 'option', blockName, optionName, subName, instance,
    ...(value === undefined ? {} : { value }),
  }
}

/**
 * A locator from an annotated-YAML path — 'Jets', 'Jets[0].minPt',
 * 'Jets[0].JVT[0].selectionName'.  The first segment is the block, the last
 * the option, and a segment between them is the sub-block.
 */
export function locatorFromPath(path) {
  const segments = String(path ?? '').split('.').filter(Boolean)
  if (!segments.length) return null
  const part = s => {
    const m = /^([^[]+)(?:\[(\d+)\])?$/.exec(s)
    return m ? { name: m[1], index: m[2] ? Number(m[2]) : 0 } : { name: s, index: 0 }
  }
  const head = part(segments[0])
  if (segments.length === 1) return blockLocator(head.name)
  const tail = part(segments[segments.length - 1])
  const middle = segments.length > 2 ? part(segments[segments.length - 2]) : null
  return optionLocator({
    blockName: head.name,
    optionName: tail.name,
    subName: middle ? middle.name : null,
    instance: head.index,
  })
}

// ── Resolution ──────────────────────────────────────────────────────────────

const isUnset = v => v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length)

function sameValue(a, b) {
  if (isUnset(a) && isUnset(b)) return true
  if (a === b) return true
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return String(a) === String(b)
}

function trim(text, max) {
  const s = String(text ?? '').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}

/** The values of one instance of a block in a plain YAML config object. */
function instanceValues(configObj, blockName, index) {
  const entry = configObj?.[blockName]
  if (!entry) return null
  const inst = Array.isArray(entry) ? entry[index] ?? entry[0] : entry
  return inst && typeof inst === 'object' ? inst : null
}

function describeBlock(def, name) {
  if (!def) return { name, known: false }
  return {
    name: def.name ?? name,
    label: def.label ?? def.name ?? name,
    factoryName: def.factoryName ?? def.name ?? name,
    category: def.category ?? null,
    known: true,
    classes: (def.classes || []).map(c => (typeof c === 'string' ? c : c?.cls)).filter(Boolean),
    docstring: trim((def.classes || [])
      .map(c => (typeof c === 'string' ? '' : c?.docstring))
      .filter(Boolean).join('\n\n'), DOC_CHARS),
  }
}

function describeOption(opt) {
  const choices = optionChoices(opt)
  return {
    name: opt.name,
    declaredBy: opt.origin ?? null,
    type: opt.type ?? null,
    default: opt.default ?? null,
    factoryDefault: opt.factoryDefault ?? null,
    choices: choices ?? null,
    maxChoices: choices ? optionMaxChoices(opt) : null,
    unit: opt.physicalUnit ?? null,
    required: isRequiredOption(opt),
    expert: isExpertOption(opt),
    role: opt.meta?.role ?? null,
    docstring: trim(opt.info, DOC_CHARS),
  }
}

/**
 * Resolve a locator into the facts the assistant is given.
 *
 * `blocks` are the effective blocks (base + AddConfigBlocks) and `configObj`
 * a plain YAML config object — Builder's serialised state or Reader's file.
 */
export function buildExplainTarget({ locator, blocks, configObj }) {
  if (!locator?.blockName) return null
  const lookup = buildSchemaLookup(blocks)
  const entry = lookup[locator.blockName]
  const block = describeBlock(entry?.def, locator.blockName)

  if (locator.kind === 'block') {
    const values = instanceValues(configObj, locator.blockName, 0)
    return {
      kind: 'block',
      block,
      sub: null,
      option: null,
      value: null,
      siblings: values ? setOptions(values) : [],
      inConfig: !!values,
      path: locator.blockName,
    }
  }

  const subEntry = locator.subName ? entry?.subBlocksByName?.[locator.subName] : null
  const owner = subEntry ?? entry
  const opt = owner?.optionsByName?.[locator.optionName] ?? null

  const blockValues = instanceValues(configObj, locator.blockName, locator.instance ?? 0)
  const subValues = locator.subName
    ? instanceValues(blockValues ?? {}, locator.subName, 0)
    : null
  const values = (locator.subName ? subValues : blockValues) ?? null

  const raw = locator.value !== undefined ? locator.value : values?.[locator.optionName]
  const set = !isUnset(raw)

  return {
    kind: 'option',
    block,
    sub: subEntry ? { name: subEntry.def.name, label: subEntry.def.label ?? subEntry.def.name } : null,
    option: opt ? describeOption(opt) : { name: locator.optionName, known: false },
    known: !!opt,
    value: {
      set,
      current: set ? raw : null,
      matchesDefault: set ? sameValue(raw, opt?.default) : true,
    },
    siblings: values ? setOptions(values).filter(o => o.name !== locator.optionName) : [],
    inConfig: !!values,
    path: explainPath(locator),
  }
}

/** The options actually written in one instance, sub-block mappings aside. */
function setOptions(values) {
  const isNested = v => (Array.isArray(v)
    ? v.some(item => item && typeof item === 'object')
    : !!v && typeof v === 'object')
  return Object.entries(values)
    .filter(([, v]) => !isUnset(v))
    .filter(([, v]) => !isNested(v))
    .slice(0, SIBLING_LIMIT)
    .map(([name, value]) => ({ name, value }))
}

function explainPath(locator) {
  return [locator.blockName, locator.subName, locator.optionName].filter(Boolean).join('.')
}

// ── The turn that gets sent ─────────────────────────────────────────────────

/** Short label for the transcript — the fact sheet itself is the tooltip. */
export function explainLabel(target) {
  if (!target) return 'Explain this'
  return target.kind === 'block'
    ? `Explain the ${target.block.name} block`
    : `Explain ${target.path}`
}

function factSheet(target) {
  const facts = { block: target.block.name }
  if (target.block.label && target.block.label !== target.block.name) facts.blockLabel = target.block.label
  if (target.block.classes?.length) facts.configBlockClasses = target.block.classes
  if (!target.block.known) facts.notInThisRelease = true
  if (target.block.docstring) facts.blockDocstring = target.block.docstring

  if (target.kind === 'option') {
    if (target.sub) facts.subBlock = target.sub.name
    const o = target.option
    facts.option = o.name
    if (o.known === false) {
      facts.notInThisRelease = true
    } else {
      if (o.declaredBy) facts.declaredBy = o.declaredBy
      facts.type = o.type
      facts.default = o.default
      if (o.factoryDefault !== null) facts.factoryDefault = o.factoryDefault
      if (o.choices) facts.choices = o.choices
      if (o.maxChoices) facts.maxChoices = o.maxChoices
      if (o.unit) facts.unit = o.unit
      if (o.required) facts.required = true
      if (o.expert) facts.expertOnly = true
      if (o.role) facts.metaRole = o.role
      facts.docstring = o.docstring || '(the upstream option has no docstring)'
    }
    facts.valueSetHere = target.value.set
    if (target.value.set) {
      facts.currentValue = target.value.current
      facts.differsFromDefault = !target.value.matchesDefault
    }
  }

  if (target.siblings.length) {
    facts.alsoSetInThisBlock = Object.fromEntries(target.siblings.map(s => [s.name, s.value]))
  } else if (!target.inConfig) {
    facts.notInTheUsersConfig = true
  }
  return facts
}

/**
 * The user turn: a plain request, plus everything the app already resolved so
 * the model does not have to look it up (it still may, for anything else).
 */
export function explainQuestion(target) {
  if (!target) return 'Explain this.'
  const ask = target.kind === 'block'
    ? `Explain the \`${target.block.name}\` block — what is it for?`
    : `Explain the \`${target.option.name}\` option of \`${target.path.split('.').slice(0, -1).join('.')}\` — what is it for?`
  const dumped = yaml.dump(factSheet(target), { lineWidth: 100, noRefs: true }).trimEnd()
  return `${ask}\n\nResolved by the app from this release's schema and my config:\n\n\`\`\`yaml\n${dumped}\n\`\`\``
}

// ── Follow-ups ──────────────────────────────────────────────────────────────

const FOLLOWUP_HEADING = /^\s*(?:#{1,6}\s*)?\*{0,2}_?follow[\s-]?ups?_?\*{0,2}\s*:?\s*$/i
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*\S)\s*$/

/**
 * Split a trailing "Follow-ups:" list off an answer.
 *
 * A convention rather than a structured field: a tool call would cost another
 * provider round trip, and JSON mode differs per provider where the four
 * adapters share one transcript.  When the model ignores it we simply get no
 * chips and the text renders as written.
 */
export function splitFollowUps(text) {
  const lines = String(text ?? '').split('\n')
  let i = lines.length - 1
  while (i >= 0 && !lines[i].trim()) i--
  const items = []
  while (i >= 0) {
    const line = lines[i]
    if (!line.trim()) { i--; continue }
    const item = LIST_ITEM.exec(line)
    if (item) { items.unshift(stripMarkup(item[1])); i--; continue }
    if (items.length && FOLLOWUP_HEADING.test(line)) {
      return {
        body: lines.slice(0, i).join('\n').trimEnd(),
        followUps: items.filter(Boolean).slice(0, MAX_FOLLOW_UPS),
      }
    }
    break
  }
  return { body: String(text ?? ''), followUps: [] }
}

function stripMarkup(s) {
  return s.replace(/^\*\*(.*)\*\*$/, '$1').replace(/^"(.*)"$/, '$1').trim()
}
