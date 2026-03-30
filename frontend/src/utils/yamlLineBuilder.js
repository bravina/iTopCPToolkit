/**
 * yamlLineBuilder.js
 *
 * Converts a parsed YAML config object into a flat array of annotated "line"
 * objects.  Each line carries enough metadata (option schema info, sub-block
 * info, path, indent level) for AnnotatedYamlView to render it with colours,
 * ⓘ tooltips, and diff highlighting without needing to re-query the schema.
 *
 * This module is also used by yamlAnnotator.js to generate the downloadable
 * annotated YAML file.
 */

import { buildSchemaLookup } from './schemaLookup.js'

/**
 * Format a scalar value for YAML output.
 * Strings that contain YAML-special characters are single-quoted.
 */
export function formatScalar(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number')  return String(value)
  if (typeof value === 'string') {
    if (value === '' || /[:#{}&*!,[\]|>'"%@`]/.test(value) || value.includes("'")) {
      return `'${value.replace(/'/g, "''")}'`
    }
    return value
  }
  return String(value)
}

/**
 * Build a flat list of annotated line objects from a config object + schema.
 *
 * Line object fields:
 *   type        – 'blank' | 'block-header' | 'key-only' | 'kv'
 *   lineNum     – 1-based line number for display
 *   key         – YAML key string
 *   indent      – number of leading spaces
 *   isListStart – true if this is the first key of a YAML list item (gets "- " prefix)
 *   optInfo     – option schema definition, or null
 *   subInfo     – sub-block schema definition, or null
 *   blockDef    – top-level block definition (block-header lines only)
 *   unknown     – true when the key is not recognised in the schema
 *   path        – dot-notation path, e.g. "Jets[0].JVT.selectionName"
 *   valueStr    – formatted string for display (kv lines)
 *   rawValue    – raw JS value (kv lines)
 */
export function buildLines(configObj, schema) {
  const lookup = buildSchemaLookup(schema)
  const lines = []
  let lineNum = 1

  const push = (line) => lines.push({ ...line, lineNum: lineNum++ })

  const entries = Object.entries(configObj || {})
  entries.forEach(([blockKey, blockValue], blockIdx) => {
    if (blockIdx > 0) push({ type: 'blank', lineNum: lineNum++ })

    const blockInfo = lookup[blockKey]
    push({
      type: 'block-header',
      key: blockKey,
      indent: 0,
      isListStart: false,
      blockDef: blockInfo?.def ?? null,
      unknown: !blockInfo,
      path: blockKey,
    })

    if (blockValue === null || blockValue === undefined) return

    if (Array.isArray(blockValue)) {
      // List block: list item dash at indent 2, key-value pairs at indent 4
      blockValue.forEach((inst, i) => {
        if (!inst || typeof inst !== 'object') return
        traverseObj(inst, blockInfo, 4, true, `${blockKey}[${i}]`, push)
      })
    } else if (typeof blockValue === 'object' && Object.keys(blockValue).length > 0) {
      // Dict block: key-value pairs at indent 2
      traverseObj(blockValue, blockInfo, 2, false, blockKey, push)
    }
    // Empty block {} → header line is sufficient
  })

  return lines
}

/** Recursively walk an object and push line entries for each key. */
function traverseObj(obj, blockInfo, indent, isListItem, path, push) {
  const entries = Object.entries(obj || {})
  entries.forEach(([key, value], idx) => {
    // Only the first key in a list item gets the "- " prefix
    const isListStart = isListItem && idx === 0
    const optInfo = blockInfo?.optionsByName?.[key] ?? null
    const subInfo = blockInfo?.subBlocksByName?.[key] ?? null
    const unknown = !optInfo && !subInfo
    const fullPath = `${path}.${key}`

    const base = { key, indent, isListStart, optInfo, subInfo, unknown, path: fullPath }

    if (value === null || value === undefined) {
      push({ ...base, type: 'kv', valueStr: 'null', rawValue: null })
      return
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        push({ ...base, type: 'kv', valueStr: '[]', rawValue: [] })
      } else if (value.every(v => v === null || typeof v !== 'object')) {
        // Inline array of scalars
        push({ ...base, type: 'kv', valueStr: `[${value.map(formatScalar).join(', ')}]`, rawValue: value })
      } else {
        // Array of objects: emit header then recurse
        push({ ...base, type: 'key-only' })
        value.forEach((item, i) => {
          if (item && typeof item === 'object') {
            traverseObj(item, subInfo || blockInfo, indent + 4, true, `${fullPath}[${i}]`, push)
          }
        })
      }
      return
    }

    if (typeof value === 'object') {
      if (Object.keys(value).length === 0) {
        push({ ...base, type: 'kv', valueStr: '{}', rawValue: {} })
      } else {
        push({ ...base, type: 'key-only' })
        traverseObj(value, subInfo || blockInfo, indent + 2, false, fullPath, push)
      }
      return
    }

    push({ ...base, type: 'kv', valueStr: formatScalar(value), rawValue: value })
  })
}

/**
 * Convert an indent level and list-start flag to the visual prefix string.
 * List items get "  - " so the dash sits at (indent - 2) spaces.
 */
export function renderPrefix(indent, isListStart) {
  if (isListStart && indent >= 2) {
    return ' '.repeat(indent - 2) + '- '
  }
  return ' '.repeat(indent)
}

// ─────────────────────────────────────────────────────────────────────────────
// DIFF UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flatten a nested config object to { 'path.to.key': value }.
 * Array indices are represented as [0], [1], etc.
 */
export function flattenConfig(obj, prefix = '') {
  const result = {}
  if (obj === null || obj === undefined) {
    result[prefix] = obj
    return result
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => Object.assign(result, flattenConfig(item, `${prefix}[${i}]`)))
    return result
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const p = prefix ? `${prefix}.${k}` : k
      if (v !== null && typeof v === 'object') {
        Object.assign(result, flattenConfig(v, p))
      } else {
        result[p] = v
      }
    }
    return result
  }
  result[prefix] = obj
  return result
}

/**
 * Compute a structural diff between two config objects.
 * Returns { [path]: { status: 'added'|'removed'|'changed', valueA, valueB } }
 */
export function computeDiff(objA, objB) {
  const flatA = flattenConfig(objA)
  const flatB = flattenConfig(objB)
  const allPaths = new Set([...Object.keys(flatA), ...Object.keys(flatB)])
  const diff = {}
  for (const p of allPaths) {
    const inA = p in flatA
    const inB = p in flatB
    if (!inA) {
      diff[p] = { status: 'added',   valueA: undefined, valueB: flatB[p] }
    } else if (!inB) {
      diff[p] = { status: 'removed', valueA: flatA[p], valueB: undefined }
    } else if (JSON.stringify(flatA[p]) !== JSON.stringify(flatB[p])) {
      diff[p] = { status: 'changed', valueA: flatA[p], valueB: flatB[p] }
    }
  }
  return diff
}
