import { useEffect, useRef } from 'react'
import InfoPopover from './InfoPopover.jsx'
import { buildLines, renderPrefix } from '../utils/yamlLineBuilder.js'
import { buildIssueMap } from '../utils/yamlValidator.js'

// ── Loose default comparison ────────────────────────────────────────────────
function matchesDefault(rawValue, defaultVal) {
  if (rawValue === '' || rawValue === undefined) return false
  if (defaultVal === null || defaultVal === undefined) return false
  if (Array.isArray(defaultVal) && Array.isArray(rawValue))
    return JSON.stringify(rawValue) === JSON.stringify(defaultVal)
  if (typeof defaultVal === 'object')
    return JSON.stringify(rawValue) === JSON.stringify(defaultVal)
  return rawValue === defaultVal || String(rawValue) === String(defaultVal)
}

// ── Value coloring ──────────────────────────────────────────────────────────
function valueClass(rawValue, isDefault) {
  if (isDefault) return 'text-slate-500'
  if (rawValue === null || rawValue === undefined) return 'text-slate-500 italic'
  if (typeof rawValue === 'boolean') return 'text-yellow-400'
  if (typeof rawValue === 'number') return 'text-orange-400'
  if (typeof rawValue === 'string') return 'text-green-400'
  if (typeof rawValue === 'object') return 'text-slate-400'
  return 'text-slate-300'
}

// ── Single rendered line ────────────────────────────────────────────────────
function YamlLine({ line, issueMap, diffMap, scrollRef }) {
  const prefix = renderPrefix(line.indent, line.isListStart)
  const issues = issueMap?.[line.path] ?? []
  const diff = diffMap?.[line.path]

  const isDefault = line.type === 'kv' && line.optInfo
    ? matchesDefault(line.rawValue, line.optInfo.default)
    : false

  const bgClass = diff?.status === 'added'    ? 'bg-emerald-900/25'
                : diff?.status === 'removed'  ? 'bg-red-900/25'
                : diff?.status === 'changed'  ? 'bg-yellow-900/20'
                : issues.some(i => i.severity === 'error')   ? 'bg-red-900/15'
                : issues.some(i => i.severity === 'warning') ? 'bg-yellow-900/10'
                : ''

  const keyClass = line.unknown       ? 'text-red-400 underline decoration-dotted underline-offset-2'
                 : line.optInfo       ? (isDefault ? 'text-slate-500' : 'text-blue-300')
                 : line.subInfo       ? 'text-purple-300'
                 : line.type === 'block-header' ? 'text-slate-100 font-bold'
                 : 'text-slate-300'

  if (line.type === 'blank') {
    return <div className="h-3" />
  }

  if (line.type === 'block-header') {
    const blockLabel = line.blockDef?.label
    const diffStatus = diff?.status
    const headerBg = diffStatus === 'added' ? 'bg-emerald-900/25' : diffStatus === 'removed' ? 'bg-red-900/25' : ''
    return (
      <div
        id={`yaml-block-${line.key}`}
        ref={el => { if (scrollRef) scrollRef.current[line.key] = el }}
        className={`flex items-center gap-1 px-4 py-0.5 ${headerBg} border-l-2 ${line.unknown ? 'border-red-500' : 'border-transparent'} hover:bg-slate-800/40 group`}
      >
        <span className="text-slate-700 select-none w-7 text-right text-xs shrink-0 mr-1">{line.lineNum}</span>
        <span className={`font-mono text-sm font-bold ${keyClass}`}>{line.key}</span>
        <span className="font-mono text-sm text-slate-500">:</span>
        {blockLabel && (
          <span className="text-xs text-slate-600 ml-2 italic">#{blockLabel}</span>
        )}
        {line.unknown && (
          <span className="text-xs text-red-400 ml-2">⚠ unknown block</span>
        )}
        {diffStatus && (
          <DiffBadge status={diffStatus} valueA={diff.valueA} valueB={diff.valueB} />
        )}
      </div>
    )
  }

  return (
    <div className={`flex items-center px-4 py-0 ${bgClass} hover:bg-slate-800/30 group`}>
      <span className="text-slate-700 select-none w-7 text-right text-xs shrink-0 mr-2 leading-5">{line.lineNum}</span>

      {/* Code content — info bubble sits right after key:, not at far right */}
      <span className="font-mono text-xs leading-5 flex items-center flex-1 min-w-0 flex-wrap gap-0">
        {/* Indent + optional dash (whitespace-pre keeps spacing exact) */}
        <span className="text-slate-600 select-none whitespace-pre">{prefix}</span>

        {/* Key + colon + ⓘ bubble immediately after */}
        {line.key && (
          <span className="flex items-center shrink-0">
            <span className={keyClass}>{line.key}</span>
            <span className="text-slate-500">:&nbsp;</span>
            {(line.optInfo?.info || line.subInfo?.def?.label) && (
              <InfoPopover info={line.optInfo?.info ?? `**${line.subInfo.def.label}** sub-block`} />
            )}
            {/* Spacer so values don't jump when no info bubble */}
            {!line.optInfo?.info && !line.subInfo?.def?.label && (
              <span className="w-[1.1rem] inline-block select-none" />
            )}
          </span>
        )}

        {/* Value */}
        {line.type === 'kv' && (
          <span className={`${valueClass(line.rawValue, isDefault)} break-all`}>
            {line.valueStr}
          </span>
        )}

        {/* Diff inline old value */}
        {diff?.status === 'changed' && diff.valueA !== undefined && (
          <span className="ml-2 text-yellow-600 text-xs">({String(diff.valueA)}&nbsp;→)</span>
        )}

        {/* "=default" label on hover */}
        {isDefault && (
          <span className="ml-2 text-slate-700 text-xs italic opacity-0 group-hover:opacity-100 transition-opacity select-none">
            =default
          </span>
        )}
      </span>

      {/* Right-side status badges only */}
      <span className="flex items-center gap-1 ml-1 shrink-0">
        {issues.length > 0 && <IssueBadge issues={issues} />}
        {diff && <DiffBadge status={diff.status} valueA={diff.valueA} valueB={diff.valueB} />}
        {line.optInfo?.required && !line.rawValue && (
          <span className="text-xs text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Required option">req</span>
        )}
        {line.optInfo?.type && (
          <span className="text-xs text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity font-mono">
            {line.optInfo.type}
          </span>
        )}
      </span>
    </div>
  )
}

function IssueBadge({ issues }) {
  const hasError = issues.some(i => i.severity === 'error')
  const title = issues.map(i => i.message).join('\n')
  return (
    <span
      title={title}
      className={`text-xs px-1 rounded ${hasError ? 'text-red-400' : 'text-yellow-400'} cursor-help`}
    >
      {hasError ? '✖' : '⚠'}
    </span>
  )
}

function DiffBadge({ status, valueA, valueB }) {
  const cfg = {
    added:   { label: '+', color: 'text-emerald-400', title: 'Added in B' },
    removed: { label: '−', color: 'text-red-400',     title: 'Removed in B' },
    changed: { label: '~', color: 'text-yellow-400',   title: `Changed: ${valueA} → ${valueB}` },
  }[status]
  if (!cfg) return null
  return <span title={cfg.title} className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
}

// ── Main component ──────────────────────────────────────────────────────────
export default function AnnotatedYamlView({
  configObj,
  schema,
  issues = [],
  diffMap = null,
  scrollToBlock = null,
}) {
  const scrollRef = useRef({})
  const containerRef = useRef(null)
  const issueMap = buildIssueMap(issues)

  const lines = buildLines(configObj, schema)

  // Scroll to block when requested
  useEffect(() => {
    if (scrollToBlock && scrollRef.current[scrollToBlock]) {
      scrollRef.current[scrollToBlock].scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [scrollToBlock])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-slate-950 font-mono text-xs leading-5 py-3 select-text"
    >
      {lines.map(line => (
        <YamlLine
          key={line.lineNum}
          line={line}
          issueMap={issueMap}
          diffMap={diffMap}
          scrollRef={scrollRef}
        />
      ))}
    </div>
  )
}
