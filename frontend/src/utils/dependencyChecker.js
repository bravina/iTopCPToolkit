/**
 * dependencyChecker.js
 *
 * Flags container / selection references (options with role 'containerRef')
 * whose target is not defined anywhere in the config.  Issues have the same
 * shape as validator issues, with kind: 'dependency'.
 *
 * Deliberately conservative on two counts: the 'containerRef' role comes only
 * from the upstream `meta.role` (never from the option's name), so options the
 * block does not annotate are never checked; and of those that are, only values
 * that look like `Container` or `Container.selection` are flagged.
 */

import { walkState, walkYaml } from './configWalk.js'
import { optionRole } from './collectionRegistry.js'

const CONTAINER_REF_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_%]+)?$/
const LITERALS = new Set(['True', 'False', 'None', 'true', 'false'])

export function looksLikeContainerRef(value) {
  return typeof value === 'string' && value !== '' && !LITERALS.has(value) && CONTAINER_REF_RE.test(value)
}

function checkValue(value, path, registry) {
  if (!looksLikeContainerRef(value)) return null
  const dot = value.indexOf('.')
  const container = dot === -1 ? value : value.slice(0, dot)
  const selection = dot === -1 ? null : value.slice(dot + 1)

  if (!registry.collections.some(c => c.name === container)) {
    return { path, severity: 'warning', kind: 'dependency',
             message: `Container '${container}' is not defined by any enabled block` }
  }
  if (selection && !registry.selections.some(s => s.container === container && s.name === selection)) {
    return { path, severity: 'warning', kind: 'dependency',
             message: `Selection '${selection}' is not defined for container '${container}'` }
  }
  return null
}

function checkWalked(walked, registry) {
  const issues = []
  for (const { def, instances } of walked) {
    for (const { idx, options, subs } of instances) {
      for (const opt of def.options || []) {
        if (optionRole(opt) !== 'containerRef') continue
        const issue = checkValue(options[opt.name], `${def.name}[${idx}].${opt.name}`, registry)
        if (issue) issues.push(issue)
      }
      for (const { def: sd, idx: sidx, options: so } of subs) {
        for (const opt of sd.options || []) {
          if (optionRole(opt, { isSub: true }) !== 'containerRef') continue
          const issue = checkValue(so[opt.name], `${def.name}[${idx}].${sd.name}[${sidx}].${opt.name}`, registry)
          if (issue) issues.push(issue)
        }
      }
    }
  }
  return issues
}

export function checkDepsFromState(config, registry, blocks) {
  return checkWalked(walkState(config, blocks), registry)
}

export function checkDepsFromYaml(configObj, registry, blocks) {
  return checkWalked(walkYaml(configObj, blocks), registry)
}
