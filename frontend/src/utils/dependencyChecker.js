import { inferFieldType, getAutocompleteMode, DEFINING_BLOCK_TYPES } from './collectionRegistry.js'
import { buildSchemaLookup } from './schemaLookup.js'

/**
 * Looks like a container reference: starts with uppercase, CamelCase,
 * optionally followed by .selectionName.
 * Avoids flagging raw booleans, numbers, YAML keywords, etc.
 */
const CONTAINER_REF_RE = /^[A-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9_%]+)?$/

function looksLikeContainerRef(value) {
  if (!value || typeof value !== 'string') return false
  if (value === 'True' || value === 'False' || value === 'None') return false
  return CONTAINER_REF_RE.test(value)
}

function parseRef(value) {
  // "AnaJets.baselineJvt" → { container: "AnaJets", selection: "baselineJvt" }
  // "AnaJets"             → { container: "AnaJets", selection: null }
  const dot = value.indexOf('.')
  if (dot === -1) return { container: value, selection: null }
  return { container: value.slice(0, dot), selection: value.slice(dot + 1) }
}

/**
 * Check a single option value against the registry.
 * Returns an issue object or null.
 */
function checkValue(optName, value, path, registry, blockName, parentBlockName) {
  const mode = getAutocompleteMode(optName, blockName, parentBlockName)
  if (!mode) return null
  if (!looksLikeContainerRef(value)) return null

  const { container, selection } = parseRef(value)

  const knownContainer = registry.collections.find(c => c.name === container)
  if (!knownContainer) {
    return {
      path,
      severity: 'warning',
      message: `Container '${container}' is not defined by any enabled block`,
      kind: 'dependency',
    }
  }

  if (selection) {
    const knownSelection = registry.selections.find(
      s => s.container === container && s.name === selection
    )
    if (!knownSelection) {
      return {
        path,
        severity: 'warning',
        message: `Selection '${selection}' is not defined for container '${container}'`,
        kind: 'dependency',
      }
    }
  }

  return null
}

/**
 * Check a builder config state against a registry.
 * Returns array of dependency issues.
 */
export function checkDepsFromState(configState, registry, schema) {
  const issues = []
  const lookup = buildSchemaLookup(schema)

  for (const [blockName, blockState] of Object.entries(configState || {})) {
    if (!blockState?.enabled) continue
    const blockInfo = lookup[blockName]

    for (const [instIdx, inst] of (blockState.instances || []).entries()) {
      // Check top-level options
      for (const [optName, value] of Object.entries(inst.options || {})) {
        if (!value || value === '') continue
        const issue = checkValue(
          optName, value,
          `${blockName}[${instIdx}].${optName}`,
          registry, blockName, null
        )
        if (issue) issues.push(issue)
      }

      // Check sub-block options
      for (const [subName, subState] of Object.entries(inst.sub_blocks || {})) {
        if (!subState?.enabled) continue
        for (const [siIdx, si] of (subState.instances || []).entries()) {
          for (const [optName, value] of Object.entries(si.options || {})) {
            if (!value || value === '') continue
            const issue = checkValue(
              optName, value,
              `${blockName}[${instIdx}].${subName}[${siIdx}].${optName}`,
              registry, subName, blockName
            )
            if (issue) issues.push(issue)
          }
        }
      }
    }
  }

  return issues
}

/**
 * Check a parsed YAML config object against a registry.
 * Returns array of dependency issues (same shape as validator issues).
 */
export function checkDepsFromYaml(configObj, registry, schema) {
  const issues = []
  const lookup = buildSchemaLookup(schema)

  for (const [blockName, blockValue] of Object.entries(configObj || {})) {
    const instances = Array.isArray(blockValue) ? blockValue : [blockValue ?? {}]
    const blockInfo = lookup[blockName]

    for (const [instIdx, inst] of instances.entries()) {
      if (!inst || typeof inst !== 'object') continue

      for (const [key, value] of Object.entries(inst)) {
        // Sub-block?
        const subInfo = blockInfo?.subBlocksByName?.[key]
        if (subInfo) {
          const subInstances = Array.isArray(value) ? value : [value ?? {}]
          for (const [siIdx, si] of subInstances.entries()) {
            if (!si || typeof si !== 'object') continue
            for (const [optName, val] of Object.entries(si)) {
              if (!val || val === '') continue
              const issue = checkValue(
                optName, val,
                `${blockName}[${instIdx}].${key}[${siIdx}].${optName}`,
                registry, key, blockName
              )
              if (issue) issues.push(issue)
            }
          }
          continue
        }

        // Regular option
        if (!value || value === '') continue
        const issue = checkValue(
          key, value,
          `${blockName}[${instIdx}].${key}`,
          registry, blockName, null
        )
        if (issue) issues.push(issue)
      }
    }
  }

  return issues
}
