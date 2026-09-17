/**
 * glossary.js — the curated concept glossary and how a query finds it.
 *
 * The schema says what an option is; the glossary says what it is for.  It is
 * a hand-written YAML file in this repository (see glossary.yaml), loaded once
 * and matched lexically: exact keys, then key-inside-query, then shared words.
 * No embeddings, no network, no ranking that changes between two identical
 * calls — the same question always returns the same entries.
 *
 * Nothing here judges the physics.  Every entry carries `reviewed`, and the
 * caller is expected to pass it on: an unreviewed entry is a draft, not an
 * authority.
 */

import yaml from 'js-yaml'
import GLOSSARY_YAML from './glossary.yaml?raw'

/** Prose fields, in the order an answer walks through them. */
export const GLOSSARY_FIELDS = ['what', 'why', 'choosing', 'pitfalls']

const ID_RE = /^[a-z0-9][a-z0-9-]*$/

// Words too common to carry a match on their own.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'does', 'for', 'from', 'how', 'i', 'in',
  'is', 'it', 'me', 'my', 'of', 'on', 'option', 'or', 'set', 'should', 'that', 'the', 'this', 'to',
  'use', 'used', 'what', 'when', 'which', 'why', 'with',
])

const EXACT = 100     // the query is one of the entry's keys
const CONTAINS = 60   // a key appears whole inside the query
const SHARED = 20     // the query and a key share words
const MATCH_MIN = 30  // below this a hit is a suggestion, not a match

const TITLE_WEIGHT = 0.9

/** 'runNNJvtUpdate' → ['run', 'nn', 'jvt', 'update']; '%SYS%' → ['sys']. */
export function conceptWords(text) {
  return String(text ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const compact = text => conceptWords(text).join('')

function key(text, weight) {
  const words = conceptWords(text)
  return { words, compact: words.join(''), weight }
}

/** `needle` appearing as a run of consecutive words in `hay`. */
function containsRun(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false
  for (let i = 0; i <= hay.length - needle.length; i++) {
    if (needle.every((w, j) => hay[i + j] === w)) return true
  }
  return false
}

function asStrings(value) {
  return Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()) : null
}

function asText(value) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function validateEntry(raw, index, seen, problems) {
  const where = `entries[${index}]`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push(`${where}: not a mapping`)
    return null
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!ID_RE.test(id)) {
    problems.push(`${where}: id '${raw.id}' must be lower-case words joined by '-'`)
    return null
  }
  if (seen.has(id)) {
    problems.push(`${where}: duplicate id '${id}'`)
    return null
  }
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (!title) {
    problems.push(`${where} (${id}): a title is required`)
    return null
  }
  const aliases = raw.aliases === undefined ? [] : asStrings(raw.aliases)
  if (!aliases) {
    problems.push(`${where} (${id}): aliases must be a list of strings`)
    return null
  }
  const seeAlso = raw.see_also === undefined ? [] : asStrings(raw.see_also)
  if (!seeAlso) {
    problems.push(`${where} (${id}): see_also must be a list of ids`)
    return null
  }
  if (typeof raw.reviewed !== 'boolean') {
    problems.push(`${where} (${id}): reviewed must be true or false — an entry nobody has checked is false`)
    return null
  }
  const refs = []
  for (const ref of Array.isArray(raw.refs) ? raw.refs : []) {
    if (!ref || typeof ref !== 'object' || !ref.url) {
      problems.push(`${where} (${id}): every ref needs a url`)
      return null
    }
    refs.push({ title: asText(ref.title) || String(ref.url), url: String(ref.url) })
  }

  const entry = { id, title, aliases, see_also: seeAlso, refs, reviewed: raw.reviewed }
  for (const field of GLOSSARY_FIELDS) entry[field] = asText(raw[field])
  seen.add(id)
  return entry
}

/**
 * Parse and validate a glossary document.  Malformed entries are dropped and
 * reported rather than thrown: one bad entry must not take the assistant down.
 */
export function parseGlossary(text) {
  const problems = []
  let doc
  try {
    doc = yaml.load(text)
  } catch (err) {
    return { version: null, entries: [], problems: [`unparseable YAML: ${err?.message || err}`] }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { version: null, entries: [], problems: ['the document must be a mapping with version and entries'] }
  }
  const version = doc.version ?? null
  if (typeof version !== 'number') problems.push('version must be a number')
  if (!Array.isArray(doc.entries)) {
    return { version, entries: [], problems: [...problems, 'entries must be a list'] }
  }

  const seen = new Set()
  const entries = []
  doc.entries.forEach((raw, i) => {
    const entry = validateEntry(raw, i, seen, problems)
    if (entry) entries.push(entry)
  })
  for (const entry of entries) {
    for (const ref of entry.see_also) {
      if (!seen.has(ref)) problems.push(`${entry.id}: see_also points at unknown entry '${ref}'`)
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return { version, entries, problems }
}

let loaded = null

/** The bundled glossary, parsed on first use and kept. */
export function loadGlossary() {
  if (!loaded) {
    loaded = parseGlossary(GLOSSARY_YAML)
    const { entries, problems } = loaded
    loaded.byId = Object.fromEntries(entries.map(e => [e.id, e]))
    loaded.keys = new Map(entries.map(e => [
      e.id,
      [key(e.id, 1), ...e.aliases.map(a => key(a, 1)), key(e.title, TITLE_WEIGHT)].filter(k => k.words.length),
    ]))
    if (problems.length && typeof console !== 'undefined') {
      console.warn(`glossary.yaml: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`)
    }
  }
  return loaded
}

export function glossaryEntries() { return loadGlossary().entries }
export function glossaryProblems() { return loadGlossary().problems }
export function glossaryVersion() { return loadGlossary().version }
export function getEntry(id) { return loadGlossary().byId[String(id ?? '').trim()] ?? null }

/** Best score of one entry against one already-tokenised query. */
function scoreEntry(entry, qWords, qCompact) {
  const qSet = new Set(qWords)
  let best = 0
  for (const k of loadGlossary().keys.get(entry.id)) {
    let score = 0
    if (k.compact && k.compact === qCompact) score = EXACT
    else if (containsRun(qWords, k.words)) score = CONTAINS
    else {
      const hits = k.words.filter(w => w.length > 1 && !STOPWORDS.has(w) && qSet.has(w)).length
      if (hits) score = SHARED * (1 + hits / k.words.length)
    }
    best = Math.max(best, score * k.weight)
  }
  return best
}

/** A miss worth offering: the query is a fragment of a key, or vice versa. */
function nearScore(entry, qCompact) {
  if (qCompact.length < 3) return 0
  let best = 0
  for (const k of loadGlossary().keys.get(entry.id)) {
    if (!k.compact) continue
    if (k.compact.includes(qCompact) || qCompact.includes(k.compact)) {
      const overlap = Math.min(k.compact.length, qCompact.length) / Math.max(k.compact.length, qCompact.length)
      best = Math.max(best, overlap * k.weight)
    }
  }
  return best
}

/**
 * Match a query — a concept word, an option name, a block name or a whole
 * question — against the glossary.  `query` may also be a list of strings
 * (the Explain target's option name, block name and type, say), in which case
 * an entry scores on its best one.
 *
 * Returns matches above the threshold, and near misses to offer when there are
 * none.  Ties break on id, so the order never wobbles.
 */
export function matchConcept(query, { limit = 3, suggestionLimit = 5 } = {}) {
  const queries = (Array.isArray(query) ? query : [query])
    .map(q => String(q ?? '').trim())
    .filter(Boolean)
  const entries = glossaryEntries()
  if (!queries.length) return { matches: [], suggestions: [] }

  const tokenised = queries.map(q => ({ words: conceptWords(q), compact: compact(q) }))
  const scored = entries.map(entry => ({
    entry,
    score: Math.max(...tokenised.map(t => scoreEntry(entry, t.words, t.compact))),
    near: Math.max(...tokenised.map(t => nearScore(entry, t.compact))),
  }))
  const rank = (a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)

  const matches = scored.filter(s => s.score >= MATCH_MIN).sort(rank).slice(0, limit)
  if (matches.length) return { matches: matches.map(s => s.entry), suggestions: [] }

  const near = scored
    .filter(s => s.near > 0 || s.score > 0)
    .sort((a, b) => (b.near + b.score / EXACT) - (a.near + a.score / EXACT) || a.entry.id.localeCompare(b.entry.id))
    .slice(0, suggestionLimit)
  return { matches: [], suggestions: near.map(s => s.entry) }
}
