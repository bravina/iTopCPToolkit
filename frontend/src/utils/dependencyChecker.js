/**
 * dependencyChecker.js
 *
 * Checks that every option value that looks like a container/selection reference
 * (e.g. "AnaJets", "AnaJets.baselineJvt") actually exists in the current
 * collection registry.
 *
 * Issues are shown as ⊘ "reference" warnings in both the Builder and Reader.
 *
 * The checker is intentionally conservative: it only flags values that match
 * the CONTAINER_REF_RE pattern (CamelCase, optional .suffix), so free-form
 * strings, booleans and numbers are never flagged.
 */

import { getAutocompleteMode } from './collectionRegistry.js'
import { buildSchemaLookup } from './schemaLookup.js'

// Matches CamelCase container names, optionally followed by .selectionName
// Examples: "AnaJets", "AnaJets.baselineJvt", "AnaElectrons.tight_%SYS%"
const CONTAINER_REF_RE = /^[A-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9_%]+)?$/

/** Returns true if the value looks like it could be a container reference. */
function looksLikeContainerRef(value) {
  if (!value || typeof value !== 'string') return false
  if (value === 'True' || value === 'False' || value === 'None') return false
  return CONTAINER_REF_RE.test(value)
}

/** Split "AnaJets.baselineJvt" into { container, selection }. */
function parseRef(value) {
  const dot = value.indexOf('.')
  if (dot === -1) return { container: value, selection: null }
  return { container: value.slice(0, dot), selection: value.slice(dot + 1) }
}

/**
 * Check a single option value against the registry.
 * Returns an issue object, or null if no problem found.
 */
function checkValue(optName, value, path, registry, blockName) {
  // Only check fields that are expected to hold container references
  if (!getAutocompleteMode(optName, blockName)) return null
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
 * Check the builder's useConfig state against the registry.
 * Returns an array of dependency issues.
 */
export function checkDepsFromState(configState, registry, schema) {
  const issues = []

  for (const [blockName, blockState] of Object.entries(configState || {})) {
    if (!blockState?.enabled) continue

    for (const [instIdx, inst] of (blockState.instances || []).entries()) {
      // Check top-level options
      for (const [optName, value] of Object.entries(inst.options || {})) {
        if (!value) continue
        const issue = checkValue(optName, value, `${blockName}[${instIdx}].${optName}`, registry, blockName)
        if (issue) issues.push(issue)
      }

      // Check sub-block options
      for (const [subName, subState] of Object.entries(inst.sub_blocks || {})) {
        if (!subState?.enabled) continue
        for (const [siIdx, si] of (subState.instances || []).entries()) {
          for (const [optName, value] of Object.entries(si.options || {})) {
            if (!value) continue
            // Pass subName as blockName so getAutocompleteMode gets the right context
            const issue = checkValue(
              optName, value,
              `${blockName}[${instIdx}].${subName}[${siIdx}].${optName}`,
              registry, subName
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
 * Check a parsed YAML config object against the registry.
 * Returns an array of dependency issues (same shape as validator issues).
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
        // Detect sub-blocks by consulting the schema lookup
        const subInfo = blockInfo?.subBlocksByName?.[key]
        if (subInfo) {
          const subInstances = Array.isArray(value) ? value : [value ?? {}]
          for (const [siIdx, si] of subInstances.entries()) {
            if (!si || typeof si !== 'object') continue
            for (const [optName, val] of Object.entries(si)) {
              if (!val) continue
              const issue = checkValue(
                optName, val,
                `${blockName}[${instIdx}].${key}[${siIdx}].${optName}`,
                registry, key
              )
              if (issue) issues.push(issue)
            }
          }
          continue
        }

        // Regular option
        if (!value) continue
        const issue = checkValue(key, value, `${blockName}[${instIdx}].${key}`, registry, blockName)
        if (issue) issues.push(issue)
      }
    }
  }

  return issues
}
