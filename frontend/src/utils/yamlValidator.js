/**
 * yamlValidator.js
 *
 * Static validation of a parsed YAML object against the effective schema —
 * a replication of the checks TextConfig._configureAlg performs when it reads
 * a file (no dry-run is possible without an input file):
 *
 *   - AddConfigBlocks entries must carry modulePath / functionName / algName
 *   - unknown top-level blocks (error)
 *   - keys that are neither an option nor a sub-block of the block (error;
 *     Athena: "There are options set that are not used for <block>")
 *   - type mismatches and values outside declared `choices` (warning)
 *   - required options (required=True or noneAction='error') absent (warning);
 *     containerName and the skip* options are inherited by sub-blocks and
 *     therefore never required there
 *   - required block dependencies not present (warning)
 *   - values that trip an expert-mode rule (warning, names the runtime flag)
 *   - deprecated SAVE lines in selectionCuts (warning)
 *
 * Issues: { path, severity: 'error'|'warning', message }
 */

import { buildSchemaLookup } from './schemaLookup.js'
import { ADD_CONFIG_BLOCKS, EXPERT_FLAG_HINT, isRequiredOption, optionChoices, optionMaxChoices } from './schema.js'
import { normalizeAddConfigBlocks, isValidEntry } from './yamlToConfig.js'
import { isDefault } from './yamlSerializer.js'

const INHERITED_IN_SUB_BLOCKS = new Set([
  'containerName', 'skipOnData', 'skipOnMC', 'skipWithSystematics', 'onlyForDSIDs',
])

export function validateConfig(configObj, blocks) {
  const lookup = buildSchemaLookup(blocks)
  const issues = []
  const present = new Set(Object.keys(configObj || {}))

  for (const [blockKey, blockValue] of Object.entries(configObj || {})) {
    if (blockKey === ADD_CONFIG_BLOCKS) {
      validateAddConfigBlocks(blockValue, issues)
      continue
    }
    const info = lookup[blockKey]
    if (!info) {
      issues.push({ path: blockKey, severity: 'error',
        message: `Unknown block '${blockKey}' — not in the factory and not declared in AddConfigBlocks` })
      continue
    }
    if (info.def.error && !info.def.opaque) {
      issues.push({ path: blockKey, severity: 'warning',
        message: `Block could not be introspected: ${info.def.error}` })
    }
    for (const dep of info.def.dependencies || []) {
      if (dep.required && dep.blockName !== blockKey && !present.has(dep.blockName)) {
        issues.push({ path: blockKey, severity: 'warning',
          message: `'${blockKey}' requires block '${dep.blockName}', which is not present` })
      }
    }

    const instances = Array.isArray(blockValue) ? blockValue : [blockValue]
    instances.forEach((inst, i) => {
      const path = `${blockKey}[${i}]`
      if (inst === null || inst === undefined) return
      if (typeof inst !== 'object' || Array.isArray(inst)) {
        issues.push({ path, severity: 'error', message: `Block instance must be a mapping, got ${describe(inst)}` })
        return
      }
      validateInstance(inst, info, path, issues, false)
    })
  }
  return issues
}

function validateAddConfigBlocks(value, issues) {
  if (value !== null && !Array.isArray(value) && typeof value !== 'object') {
    issues.push({ path: ADD_CONFIG_BLOCKS, severity: 'error', message: 'AddConfigBlocks must be a list or a mapping' })
    return
  }
  normalizeAddConfigBlocks(value).forEach((e, i) => {
    if (!isValidEntry(e)) {
      issues.push({ path: `${ADD_CONFIG_BLOCKS}[${i}]`, severity: 'error',
        message: 'AddConfigBlocks entry needs modulePath, functionName and algName' })
    }
  })
}

function validateInstance(inst, info, path, issues, isSub) {
  if (info.def.opaque) {
    issues.push({ path, severity: 'warning',
      message: `Options of custom block '${info.def.name}' cannot be checked — introspection unavailable` })
    return
  }
  for (const [key, value] of Object.entries(inst)) {
    const opt = info.optionsByName[key]
    const sub = info.subBlocksByName?.[key]
    if (opt) {
      validateValue(key, value, opt, path, issues)
    } else if (sub) {
      const subInstances = value === null ? [] : (Array.isArray(value) ? value : [value])
      subInstances.forEach((si, i) => {
        const subPath = `${path}.${key}[${i}]`
        if (si === null || si === undefined) return
        if (typeof si !== 'object' || Array.isArray(si)) {
          issues.push({ path: subPath, severity: 'error', message: `Sub-block instance must be a mapping, got ${describe(si)}` })
          return
        }
        validateInstance(si, sub, subPath, issues, true)
      })
    } else {
      issues.push({ path: `${path}.${key}`, severity: 'error',
        message: `Option '${key}' is not used by block '${info.def.name}'` })
    }
  }
  for (const opt of Object.values(info.optionsByName)) {
    if (!isRequiredOption(opt) || opt.generic || opt.name in inst) continue
    if (isSub && INHERITED_IN_SUB_BLOCKS.has(opt.name)) continue
    issues.push({ path: `${path}.${opt.name}`, severity: 'warning',
      message: `Required option '${opt.name}' is not set` })
  }
}

function describe(v) {
  return Array.isArray(v) ? 'a list' : v === null ? 'null' : typeof v
}

export function typeMismatch(expected, value) {
  switch (expected) {
    case 'bool':  return typeof value !== 'boolean'
    case 'int':   return typeof value !== 'number' || !Number.isInteger(value)
    case 'float': return typeof value !== 'number'
    case 'list':  return !Array.isArray(value)
    case 'dict':  return typeof value !== 'object' || value === null || Array.isArray(value)
    default:      return false
  }
}

export function matchesExpertRule(rule, value, opt) {
  if (rule === true) return !isDefault(value, opt?.default)
  if (rule === 'nonemptystring') return typeof value === 'string' && value !== ''
  if (rule === 'nonemptylist') return Array.isArray(value) && value.length > 0
  if (rule === 'positiveint') return Number.isInteger(value) && value > 0
  return value === rule || String(value) === String(rule)
}

function validateValue(key, value, opt, path, issues) {
  if (value === null || value === undefined || value === '') return
  const p = `${path}.${key}`
  if (typeMismatch(opt.type, value)) {
    issues.push({ path: p, severity: 'warning', message: `Expected ${opt.type}, got ${describe(value)}` })
  }
  const choices = optionChoices(opt)
  if (choices) {
    // A list option (e.g. onlySystematicsCategories) is checked element by element.
    const values = Array.isArray(value) ? value : [value]
    const unknown = values.filter(v => !choices.some(c => c === v || String(c) === String(v)))
    for (const v of unknown) {
      issues.push({ path: p, severity: 'warning', message: `'${v}' is not one of: ${choices.join(', ')}` })
    }
    const max = optionMaxChoices(opt)
    if (max !== null && values.length > max) {
      issues.push({ path: p, severity: 'warning', message: `at most ${max} value${max === 1 ? '' : 's'} allowed, got ${values.length}` })
    }
  }
  if (Array.isArray(opt.expertMode) && opt.expertMode.some(r => matchesExpertRule(r, value, opt))) {
    issues.push({ path: p, severity: 'warning', message: `This value requires expert mode (${EXPERT_FLAG_HINT})` })
  }
  if (key === 'selectionCuts' && typeof value === 'string' && /^\s*SAVE\s*$/m.test(value)) {
    issues.push({ path: p, severity: 'warning',
      message: "'SAVE' is deprecated — the event filter is created automatically; remove the SAVE line" })
  }
}

/** Map path → [issues] for O(1) per-line lookup in AnnotatedYamlView. */
export function buildIssueMap(issues) {
  const map = {}
  for (const issue of issues) (map[issue.path] ??= []).push(issue)
  return map
}
