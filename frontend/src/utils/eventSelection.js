/**
 * eventSelection.js
 *
 * Helpers for the `selectionCuts` option of EventSelection: a multi-line
 * string, one cut per line, interpreted by EventSelectionConfig.
 *
 * The keyword grammar is NOT hardcoded here.  When the schema carries a
 * keyword spec (`schema.keywords`, exported by EventSelectionConfig upstream)
 * lines are parsed into named arguments; otherwise every line is opaque text.
 *
 * Expected spec shape (to be matched by the upstream MR):
 *   {
 *     [KEYWORD]: {
 *       info: 'one-line description',
 *       freeText?: true,                         // e.g. EXPR: everything after the keyword
 *       args?: [ { name, type: 'str'|'float'|'int'|'sign'|'flag',
 *                  optional?: true, choices?: [...] } ],
 *     }
 *   }
 * Optional arguments are filled left-to-right in declaration order with the
 * tokens that exceed the number of required arguments (e.g. `EL_N [sel] ptmin sign count`).
 */

import { v4 as uuid } from 'uuid'

export const SIGNS = ['<', '>', '==', '>=', '<=']

/** Remove deprecated `SAVE` lines; reports whether any were present. */
export function stripSave(text) {
  const lines = String(text ?? '').split('\n')
  const kept = lines.filter(l => l.trim() !== 'SAVE')
  return { text: kept.join('\n'), hadSave: kept.length !== lines.length }
}

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

/**
 * Parse one line.  Returns { keyword, raw, spec, args, error } where `args` is
 * null when the keyword has no spec or the argument count does not fit.
 */
export function parseCutLine(raw, keywords) {
  const trimmed = String(raw ?? '').trim()
  if (!trimmed || trimmed.startsWith('#')) return { keyword: null, raw: trimmed, spec: null, args: null, error: null }
  const [kw, ...rest] = trimmed.split(/\s+/)
  const spec = keywordSpec(keywords, kw)
  if (!spec) return { keyword: kw, raw: trimmed, spec: null, args: null, error: keywords ? `Unknown keyword '${kw}'` : null }
  if (spec.freeText) return { keyword: kw, raw: trimmed, spec, args: { text: rest.join(' ') }, error: null }

  const argSpecs = spec.args || []
  const nRequired = argSpecs.filter(a => !a.optional).length
  if (rest.length < nRequired || rest.length > argSpecs.length) {
    return { keyword: kw, raw: trimmed, spec, args: null,
             error: `${kw} expects ${nRequired}${argSpecs.length > nRequired ? `–${argSpecs.length}` : ''} arguments, got ${rest.length}` }
  }
  let optionalBudget = rest.length - nRequired
  const args = {}
  let i = 0
  for (const a of argSpecs) {
    if (a.optional) {
      if (optionalBudget > 0) { args[a.name] = rest[i++]; optionalBudget-- } else args[a.name] = ''
    } else {
      args[a.name] = rest[i++]
    }
  }
  return { keyword: kw, raw: trimmed, spec, args, error: null }
}

/** Inverse of parseCutLine for a keyword with a spec. */
export function serializeCutLine(keyword, args, keywords) {
  const spec = keywordSpec(keywords, keyword)
  if (!spec) return keyword
  if (spec.freeText) return `${keyword} ${args?.text ?? ''}`.trim()
  const tokens = [keyword]
  for (const a of spec.args || []) {
    const v = args?.[a.name]
    if (a.optional && (v === '' || v === null || v === undefined)) continue
    tokens.push(v === null || v === undefined ? '' : String(v))
  }
  return tokens.join(' ').trim()
}

/** Default argument values for a keyword (for a freshly added cut). */
export function defaultArgs(keyword, keywords) {
  const spec = keywordSpec(keywords, keyword)
  if (!spec) return null
  if (spec.freeText) return { text: '' }
  return Object.fromEntries((spec.args || []).map(a => [a.name, a.type === 'sign' ? '>=' : '']))
}
