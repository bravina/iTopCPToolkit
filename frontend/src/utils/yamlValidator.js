/**
 * yamlValidator.js
 *
 * Validates a parsed YAML config object against the schema.
 * Produces issues of shape: { path, severity: 'error'|'warning', message }
 *
 * Checks performed:
 *   - Unknown top-level block names
 *   - Unknown option/sub-block keys within a block instance
 *   - Unknown option keys within a sub-block instance
 *   - Type mismatches (bool/int/float/list)
 *   - Missing required options
 */

import { buildSchemaLookup } from './schemaLookup.js'

/** Validate a full parsed config object against the schema. */
export function validateConfig(configObj, schema) {
  const lookup = buildSchemaLookup(schema)
  const issues = []

  for (const [blockKey, blockValue] of Object.entries(configObj || {})) {
    const blockInfo = lookup[blockKey]
    if (!blockInfo) {
      issues.push({ path: blockKey, severity: 'error', message: `Unknown block '${blockKey}'` })
      continue
    }

    const instances = Array.isArray(blockValue) ? blockValue : [blockValue]
    instances.forEach((inst, i) => {
      if (!inst || typeof inst !== 'object') return
      validateInstance(inst, blockInfo, `${blockKey}[${i}]`, issues)
    })
  }

  return issues
}

/** Validate a single block instance (or sub-block instance). */
function validateInstance(inst, blockInfo, path, issues) {
  for (const [key, value] of Object.entries(inst || {})) {
    const optInfo = blockInfo.optionsByName[key]
    const subInfo = blockInfo.subBlocksByName[key]

    if (optInfo) {
      validateValue(key, value, optInfo, path, issues)
    } else if (subInfo) {
      // Recurse into sub-block instances
      const subInstances = value === null ? [] : (Array.isArray(value) ? value : [value])
      subInstances.forEach((si, i) => {
        if (!si || typeof si !== 'object') return
        for (const [sk, sv] of Object.entries(si)) {
          const sOpt = subInfo.optionsByName[sk]
          if (!sOpt) {
            issues.push({
              path: `${path}.${key}[${i}].${sk}`,
              severity: 'error',
              message: `Unknown option '${sk}' in sub-block '${key}'`,
            })
          } else {
            validateValue(sk, sv, sOpt, `${path}.${key}[${i}]`, issues)
          }
        }
      })
    } else {
      issues.push({
        path: `${path}.${key}`,
        severity: 'error',
        message: `Unknown key '${key}' (not an option or sub-block of '${path.split('[')[0]}')`,
      })
    }
  }

  // Warn about required options that are completely absent from the instance
  for (const opt of Object.values(blockInfo.optionsByName)) {
    if (opt.required && !(opt.name in inst)) {
      issues.push({
        path: `${path}.${opt.name}`,
        severity: 'warning',
        message: `Required option '${opt.name}' is not set`,
      })
    }
  }
}

/** Check a single value against the expected type from the schema. */
function validateValue(key, value, opt, path, issues) {
  if (value === null || value === undefined || value === '') return
  const expected = opt.type
  const isArray = Array.isArray(value)
  const actual = isArray ? 'list' : typeof value

  if (expected === 'bool' && actual !== 'boolean') {
    issues.push({ path: `${path}.${key}`, severity: 'warning', message: `Expected bool, got ${actual}` })
  } else if (expected === 'int' && actual !== 'number') {
    issues.push({ path: `${path}.${key}`, severity: 'warning', message: `Expected int, got ${actual}` })
  } else if (expected === 'float' && actual !== 'number') {
    issues.push({ path: `${path}.${key}`, severity: 'warning', message: `Expected float, got ${actual}` })
  } else if (expected === 'list' && actual !== 'list') {
    issues.push({ path: `${path}.${key}`, severity: 'warning', message: `Expected list, got ${actual}` })
  }
}

/**
 * Build a map from path → [issues] for O(1) per-line lookup in AnnotatedYamlView.
 */
export function buildIssueMap(issues) {
  const map = {}
  for (const issue of issues) {
    if (!map[issue.path]) map[issue.path] = []
    map[issue.path].push(issue)
  }
  return map
}
