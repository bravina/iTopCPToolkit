import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Global search overlay. Opened via Cmd+F / Ctrl+F.
 *
 * Props:
 *   schema        – full schema array
 *   mode          – 'builder' | 'reader'
 *   onNavigate    – ({ blockName, optionName? }) => void
 *   onClose       – () => void
 */
export default function SearchOverlay({ schema, mode, onNavigate, onClose }) {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Build flat search index from schema
  const index = buildIndex(schema)

  // Filter results
  const results = query.trim().length === 0
    ? index.slice(0, 20)
    : fuzzyFilter(index, query.trim().toLowerCase()).slice(0, 30)

  // Reset active index when results change
  useEffect(() => { setActiveIdx(0) }, [query])

  function handleKeyDown(e) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
      scrollIntoView(activeIdx + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
      scrollIntoView(activeIdx - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[activeIdx]) select(results[activeIdx])
    }
  }

  function scrollIntoView(idx) {
    const el = listRef.current?.children[idx]
    el?.scrollIntoView({ block: 'nearest' })
  }

  function select(result) {
    onNavigate({ blockName: result.blockName, optionName: result.optionName ?? null })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-xl bg-slate-800 rounded-xl shadow-2xl border border-slate-600 flex flex-col overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700">
          <span className="text-slate-500 text-sm shrink-0">⌕</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search blocks and options…"
            className="flex-1 bg-transparent text-slate-100 text-sm placeholder-slate-500 focus:outline-none"
          />
          <kbd className="text-xs text-slate-600 shrink-0">Esc</kbd>
        </div>

        {/* Results */}
        <ul ref={listRef} className="overflow-y-auto max-h-96">
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-500">
              No results for "{query}"
            </li>
          )}

          {results.map((r, i) => (
            <li
              key={r.id}
              onMouseDown={() => select(r)}
              className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                i === activeIdx ? 'bg-blue-600/25' : 'hover:bg-slate-700/50'
              }`}
            >
              {/* Type badge */}
              <span className={`text-xs px-1.5 py-0.5 rounded font-mono shrink-0 mt-0.5 ${
                r.kind === 'block'
                  ? 'bg-blue-900/60 text-blue-300'
                  : 'bg-slate-700 text-slate-400'
              }`}>
                {r.kind === 'block' ? 'block' : r.optType ?? 'opt'}
              </span>

              <div className="flex-1 min-w-0">
                {/* Main label */}
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-mono text-slate-100">
                    <Highlight text={r.blockLabel} query={query} />
                    {r.optionName && (
                      <>
                        <span className="text-slate-500">.</span>
                        <Highlight text={r.optionName} query={query} />
                      </>
                    )}
                  </span>
                  {r.kind === 'block' && r.blockName !== r.blockLabel && (
                    <span className="text-xs text-slate-600 font-mono truncate">{r.blockName}</span>
                  )}
                </div>

                {/* Description */}
                {r.description && (
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                    <Highlight text={r.description} query={query} />
                  </p>
                )}
              </div>

              {/* Default value hint for options */}
              {r.defaultStr && (
                <span className="text-xs text-slate-600 font-mono shrink-0 mt-0.5 ml-auto">
                  = {r.defaultStr}
                </span>
              )}
            </li>
          ))}
        </ul>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-slate-700/50 flex items-center gap-4 text-xs text-slate-600">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> jump to</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
          <span className="ml-auto text-slate-700">⌘F / Ctrl+F</span>
          <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  )
}

// ── Highlight matching characters ───────────────────────────────────────────

function Highlight({ text, query }) {
  if (!text) return null
  if (!query || query.length < 2) return <>{text}</>
  const q = query.toLowerCase()
  const idx = text.toLowerCase().indexOf(q)
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-500/30 text-yellow-200 rounded-sm">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

// ── Index builder ────────────────────────────────────────────────────────────

function buildIndex(schema) {
  const items = []

  for (const block of (schema || [])) {
    items.push({
      id: `block:${block.name}`,
      kind: 'block',
      blockName: block.name,
      blockLabel: block.label ?? block.name,
      optionName: null,
      description: block.docstring ?? '',
      optType: null,
      defaultStr: null,
      searchText: [block.name, block.label, block.docstring].filter(Boolean).join(' ').toLowerCase(),
    })

    for (const opt of (block.options || [])) {
      items.push(makeOptEntry(opt, block, null))
    }

    for (const sub of (block.sub_blocks || [])) {
      for (const opt of (sub.options || [])) {
        items.push(makeOptEntry(opt, block, sub))
      }
    }
  }

  return items
}

function makeOptEntry(opt, block, sub) {
  const optLabel = sub ? `${sub.name}.${opt.name}` : opt.name
  const defaultStr = opt.default !== null && opt.default !== undefined && opt.default !== ''
    ? String(opt.default).slice(0, 20)
    : null

  return {
    id: `opt:${block.name}:${sub?.name ?? ''}:${opt.name}`,
    kind: 'option',
    blockName: block.name,
    blockLabel: block.label ?? block.name,
    optionName: optLabel,
    description: opt.info ?? '',
    optType: opt.type ?? null,
    defaultStr,
    searchText: [block.name, block.label, opt.name, opt.info, sub?.name].filter(Boolean).join(' ').toLowerCase(),
  }
}

// ── Fuzzy filter ─────────────────────────────────────────────────────────────

function fuzzyFilter(index, q) {
  const terms = q.split(/\s+/).filter(Boolean)

  const scored = index.map(item => {
    let score = 0
    for (const t of terms) {
      if (!item.searchText.includes(t)) { score = -1; break }
      if ((item.blockLabel ?? '').toLowerCase().startsWith(t)) score += 10
      else if ((item.optionName ?? '').toLowerCase().startsWith(t)) score += 8
      else if ((item.blockName ?? '').toLowerCase().includes(t)) score += 5
      else if ((item.optionName ?? '').toLowerCase().includes(t)) score += 4
      else score += 1
    }
    if (item.kind === 'block') score += 3
    return { item, score }
  })

  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.item)
}
