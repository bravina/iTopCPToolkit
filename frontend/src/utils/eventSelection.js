/**
 * eventSelection.js
 *
 * Helpers for the `selectionCuts` option of EventSelection: a multi-line
 * string, one cut per line, interpreted by EventSelectionConfig.
 *
 * The keyword grammar is NOT hardcoded here.  It comes from `schema.keywords`,
 * which the backend exports verbatim from
 * `EventSelectionConfig.keywordSpecs()` (AnalysisBase 25.2.110 and later) —
 * the very table Athena's own parser uses, so the two cannot drift.  Without
 * it every line stays opaque text.
 *
 * Spec shape (mirrors the upstream docstring):
 *   {
 *     [KEYWORD]: {
 *       info: 'one-line description',
 *       args?:  [ argSpec ],        // arguments in token order
 *       forms?: [ [ argSpec ] ],    // alternative shapes, tried in order
 *       freeText?: true,            // EXPR: everything after the keyword
 *       grammar?: { collections, variables },   // EXPR vocabulary
 *       deprecated?: true,          // SAVE
 *     }
 *   }
 * where argSpec is
 *   { name, type: 'str'|'float'|'int'|'sign'|'region'|'flag'|'container',
 *     optional?: true, choices?: [...], pattern?: 'regex', signed?: true }
 *
 * Argument filling reproduces upstream `parseArgs` / `_match_form` exactly:
 *   1. `flag` arguments are lifted out of the token list first, matched
 *      case-insensitively against the argument name, wherever they appear;
 *      their value is a boolean.
 *   2. Of the remaining tokens, required arguments are matched first; optional
 *      ones are filled left-to-right with the surplus tokens, skipping an
 *      optional whose `pattern` the candidate token does not match.
 *   3. With `forms`, the first form whose token count and patterns fit wins.
 */

import { v4 as uuid } from 'uuid'

export const SIGNS = ['<', '>', '==', '>=', '<=']

/** Non-empty lines with stable ids for list rendering. */
export function splitCutLines(text) {
  return String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean).map(raw => ({ id: uuid(), raw }))
}

export function joinCutLines(lines) {
  return (lines || []).map(l => (l.raw ?? '').trim()).filter(Boolean).join('\n')
}

export function keywordSpec(keywords, kw) {
  return keywords && kw && Object.prototype.hasOwnProperty.call(keywords, kw) ? keywords[kw] : null
}

/** Keyword names offered when adding a cut — deprecated ones are left out. */
export function keywordNames(keywords, { includeDeprecated = false } = {}) {
  return Object.keys(keywords || {}).filter(kw => includeDeprecated || !keywords[kw]?.deprecated)
}

/**
 * Drop lines whose keyword upstream marks `deprecated` (currently `SAVE`,
 * emitted automatically by Athena since AB 25.2.110).  Falls back to SAVE when
 * no spec is available.  Returns { text, dropped: [keyword, ...] }.
 */
export function stripDeprecated(text, keywords) {
  const deprecated = keywords
    ? new Set(Object.keys(keywords).filter(kw => keywords[kw]?.deprecated))
    : new Set(['SAVE'])
  const dropped = []
  const kept = String(text ?? '').split('\n').filter(line => {
    const kw = line.trim().split(/\s+/)[0]
    if (deprecated.has(kw)) { dropped.push(kw); return false }
    return true
  })
  return { text: kept.join('\n'), dropped }
}

/** The argument forms of a keyword, as a list of argSpec lists. */
export function specForms(spec) {
  if (!spec) return []
  if (Array.isArray(spec.forms) && spec.forms.length) return spec.forms
  return [spec.args || []]
}

/** Upstream `_extract_flags`: pull flag tokens out, wherever they sit. */
function extractFlags(form, tokens) {
  const rest = [...tokens]
  const values = {}
  for (const arg of form) {
    if (arg.type !== 'flag') continue
    values[arg.name] = false
    const i = rest.findIndex(t => t.toLowerCase() === arg.name.toLowerCase())
    if (i !== -1) { rest.splice(i, 1); values[arg.name] = true }
  }
  return { rest, values }
}

/** Upstream `_match_form`: values for one form, or null when it does not fit. */
function matchForm(form, tokens) {
  const { rest, values } = extractFlags(form, tokens)
  const positional = form.filter(a => a.type !== 'flag')
  const nRequired = positional.filter(a => !a.optional).length
  if (rest.length < nRequired || rest.length > positional.length) return null

  let budget = rest.length - nRequired
  let cursor = 0
  for (const arg of positional) {
    if (!arg.optional) {
      values[arg.name] = rest[cursor++]
      continue
    }
    const fits = budget > 0 && (!arg.pattern || new RegExp(`^(?:${arg.pattern})$`).test(rest[cursor]))
    if (fits) { values[arg.name] = rest[cursor++]; budget-- }
    else values[arg.name] = ''
  }
  return cursor === rest.length ? values : null
}

/**
 * Parse one line into { keyword, raw, spec, form, args, error }.  `args` is
 * null when the keyword has no spec or no form fits; `form` is the argSpec
 * list that matched, which is what the editor renders.
 */
export function parseCutLine(raw, keywords) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed || trimmed.startsWith('#')) {
    return { keyword: null, raw: trimmed, spec: null, form: null, args: null, error: null }
  }
  const [kw, ...rest] = trimmed.split(/\s+/)
  const spec = keywordSpec(keywords, kw)
  if (!spec) {
    return { keyword: kw, raw: trimmed, spec: null, form: null, args: null,
             error: keywords ? `Unknown keyword '${kw}'` : null }
  }
  if (spec.freeText) {
    return { keyword: kw, raw: trimmed, spec, form: null, args: { text: rest.join(' ') }, error: null }
  }

  for (const form of specForms(spec)) {
    const values = matchForm(form, rest)
    if (values) return { keyword: kw, raw: trimmed, spec, form, args: values, error: null }
  }
  return { keyword: kw, raw: trimmed, spec, form: null, args: null,
           error: `${kw} does not accept ${rest.length} argument${rest.length === 1 ? '' : 's'}` }
}

/** Inverse of parseCutLine.  `form` defaults to the keyword's first form. */
export function serializeCutLine(keyword, args, keywords, form = null) {
  const spec = keywordSpec(keywords, keyword)
  if (!spec) return keyword
  if (spec.freeText) return `${keyword} ${args?.text ?? ''}`.trim()
  const tokens = [keyword]
  for (const a of form || specForms(spec)[0]) {
    const v = args?.[a.name]
    if (a.type === 'flag') {
      if (v === true || (typeof v === 'string' && v.toLowerCase() === a.name.toLowerCase())) tokens.push(a.name)
      continue
    }
    if (v === '' || v === null || v === undefined) continue
    tokens.push(String(v))
  }
  // A required argument with no value yet simply is not written: the text
  // cannot express "empty", which is exactly why a row being edited keeps a
  // draft (see below) rather than being re-read from its own text.
  return tokens.join(' ').trim()
}

// ── Drafts ───────────────────────────────────────────────────────────────────
//
// A cut line cannot express "this argument exists but is still empty": an empty
// value serialises to nothing, so `EL_N` with nothing filled in would come back
// as the unparsable `EL_N  >=`.  While a row is being edited the editor
// therefore keeps a DRAFT — { keyword, form, args } — and derives the text from
// it, instead of re-parsing the text on every keystroke.  The text stays what
// is written to the YAML, and the parser stays as strict as Athena's.

/** A fresh draft for a keyword, with every argument at its default. */
export function newDraft(keyword, keywords, form = null) {
  const spec = keywordSpec(keywords, keyword)
  if (!spec) return null
  const chosen = spec.freeText ? null : (form || specForms(spec)[0])
  return { keyword, form: chosen, args: defaultArgs(keyword, keywords, chosen) }
}

/** The draft an already-parsed line corresponds to, or null if it did not parse. */
export function draftFromParsed(parsed) {
  if (!parsed?.spec || !parsed.args) return null
  return { keyword: parsed.keyword, form: parsed.form, args: parsed.args }
}

/** Move a draft onto another of its keyword's forms, keeping values by name. */
export function withForm(draft, form, keywords) {
  if (!draft) return null
  const fresh = defaultArgs(draft.keyword, keywords, form)
  const args = Object.fromEntries(Object.entries(fresh).map(([name, value]) => [
    name,
    Object.prototype.hasOwnProperty.call(draft.args || {}, name) ? draft.args[name] : value,
  ]))
  return { ...draft, form, args }
}

/** The line a draft writes. */
export function draftToLine(draft, keywords) {
  return draft ? serializeCutLine(draft.keyword, draft.args, keywords, draft.form) : ''
}

/**
 * Required arguments still waiting for a value — what keeps a row incomplete.
 * Flags are never missing (absent means false) and neither are signs, which
 * default to '>='.
 */
export function missingArgs(form, args) {
  return (form || [])
    .filter(a => !a.optional && a.type !== 'flag')
    .filter(a => {
      const v = args?.[a.name]
      return v === '' || v === null || v === undefined
    })
    .map(a => a.name)
}

/** Default argument values for a keyword (for a freshly added cut). */
export function defaultArgs(keyword, keywords, form = null) {
  const spec = keywordSpec(keywords, keyword)
  if (!spec) return null
  if (spec.freeText) return { text: '' }
  return Object.fromEntries((form || specForms(spec)[0]).map(a => {
    if (a.type === 'flag') return [a.name, false]
    if (a.type === 'sign') return [a.name, '>=']
    return [a.name, '']
  }))
}
