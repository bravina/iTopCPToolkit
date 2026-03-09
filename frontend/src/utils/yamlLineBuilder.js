import { buildSchemaLookup } from './schemaLookup.js'

export function formatScalar(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    // Quote strings that need it
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
 * Line types:
 *   blank          – empty line separator
 *   block-header   – top-level key (Jets:, Electrons:, ...)
 *   key-only       – key whose value is an object/list (continues below)
 *   kv             – key: value pair
 *
 * Each non-blank line has:
 *   key, indent, isListStart, optInfo, subInfo, blockDef, unknown, path
 *   For kv: also valueStr, rawValue
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
      // List block: content indent = 4 (dash at 2, key at 4)
      blockValue.forEach((inst, i) => {
        if (!inst || typeof inst !== 'object') return
        traverseObj(inst, blockInfo, 4, true, `${blockKey}[${i}]`, push)
      })
    } else if (typeof blockValue === 'object' && Object.keys(blockValue).length > 0) {
      // Dict block: content indent = 2
      traverseObj(blockValue, blockInfo, 2, false, blockKey, push)
    }
    // else: empty block {} — header only is sufficient
  })

  return lines
}

function traverseObj(obj, blockInfo, indent, isListItem, path, push) {
  const entries = Object.entries(obj || {})
  entries.forEach(([key, value], idx) => {
    // All keys in a list item share the same indent; only first gets '- ' prefix
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
        push({ ...base, type: 'kv', valueStr: `[${value.map(formatScalar).join(', ')}]`, rawValue: value })
      } else {
        push({ ...base, type: 'key-only' })
        // List sub-items: content indent = parent key indent + 4
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
        // Dict sub-items: content indent = parent key indent + 2
        traverseObj(value, subInfo || blockInfo, indent + 2, false, fullPath, push)
      }
      return
    }

    push({ ...base, type: 'kv', valueStr: formatScalar(value), rawValue: value })
  })
}

/**
 * Given indent + isListStart, return the visual prefix string.
 * isListStart → '  - ' style prefix placing dash at (indent-2)
 */
export function renderPrefix(indent, isListStart) {
  if (isListStart && indent >= 2) {
    return ' '.repeat(indent - 2) + '- '
  }
  return ' '.repeat(indent)
}

/**
 * Flatten a config object to { 'path.to.key': value } for diffing.
 */
export function flattenConfig(obj, prefix = '') {
  const result = {}
  if (obj === null || obj === undefined) {
    result[prefix] = obj
    return result
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      Object.assign(result, flattenConfig(item, `${prefix}[${i}]`))
    })
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
 * Returns { path: { status: 'added'|'removed'|'changed', valueA, valueB } }
 */
export function computeDiff(objA, objB) {
  const flatA = flattenConfig(objA)
  const flatB = flattenConfig(objB)
  const allPaths = new Set([...Object.keys(flatA), ...Object.keys(flatB)])
  const diff = {}
  for (const p of allPaths) {
    const inA = p in flatA
    const inB = p in flatB
    if (!inA) diff[p] = { status: 'added', valueA: undefined, valueB: flatB[p] }
    else if (!inB) diff[p] = { status: 'removed', valueA: flatA[p], valueB: undefined }
    else if (JSON.stringify(flatA[p]) !== JSON.stringify(flatB[p])) {
      diff[p] = { status: 'changed', valueA: flatA[p], valueB: flatB[p] }
    }
  }
  return diff
}
