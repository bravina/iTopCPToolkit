import { useState, useRef, useEffect } from 'react'
import { useRegistry } from '../contexts/RegistryContext.js'
import { inferFieldType, selectionsFor, regionSelectionExpr } from '../utils/collectionRegistry.js'

/**
 * A text input that shows a dropdown of matching names from the current
 * registry, filtered to the expected physics object type.
 *
 * Props:
 *   optName     – option name (used to infer expected type)
 *   value, onChange
 *   placeholder
 *   mode        – 'collections+selections' (a reference: containers and
 *                 container.selection pairs), 'selections' (a name that
 *                 creates or reuses a selection on `container`) or 'regions'
 *                 (an event filter naming a region EventSelection defines)
 *   container   – the block instance's container, scoping 'selections'
 */
export default function CollectionField({
  optName, value, onChange, placeholder, mode = 'collections+selections', container,
}) {
  const registry = useRegistry()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value ?? '')
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [activeIdx, setActiveIdx] = useState(0)

  // Sync external value changes into local query
  useEffect(() => { setQuery(value ?? '') }, [value])

  const expectedType = inferFieldType(optName)

  // Build candidate list
  const allSuggestions = []

  if (mode === 'regions') {
    // Only EventSelection defines regions, so the list is exactly what it
    // defined.  Picking one inserts the decoration the algorithms read; the
    // field stays free text, since `||`, `&&` and `!` combinations are valid.
    for (const name of registry.regions ?? []) {
      allSuggestions.push({ value: regionSelectionExpr(name), label: name, hint: 'region', kind: 'region' })
    }
  } else if (mode === 'selections') {
    // Reusing an existing name overwrites that selection; a new one creates it,
    // so the list is a shortcut, never the set of allowed values.
    for (const name of selectionsFor(registry, container)) {
      allSuggestions.push({ value: name, label: name, hint: 'reuse', kind: 'selection' })
    }
  } else {
    // Filter collections by expected type
    const containers = expectedType
      ? (registry.byType[expectedType] ?? [])
      : registry.collections

    for (const c of containers) {
      allSuggestions.push({ value: c.name, label: c.name, hint: c.type, kind: 'container' })
    }

    // Container.selection pairs, filtered by type
    for (const s of registry.selections) {
      if (expectedType && s.type !== expectedType) continue
      allSuggestions.push({
        value: `${s.container}.${s.name}`,
        label: `${s.container}.${s.name}`,
        hint: s.type,
        kind: 'selection',
      })
    }
  }

  // Filter by query
  const q = query.trim().toLowerCase()
  const filtered = q === ''
    ? allSuggestions
    : allSuggestions.filter(s => {
        const label = s.label.toLowerCase()
        return s.value.toLowerCase().includes(q) || label.includes(q) || q.includes(label)
      })

  function commit(val) {
    setQuery(val)
    onChange(val)
    setOpen(false)
    inputRef.current?.blur()
  }

  function handleInput(e) {
    const v = e.target.value
    setQuery(v)
    onChange(v)
    setOpen(true)
    setActiveIdx(0)
  }

  function handleKeyDown(e) {
    if (!open || filtered.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[activeIdx]) commit(filtered[activeIdx].value)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (!inputRef.current?.parentElement?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const kindColor = {
    container: 'text-blue-600 dark:text-blue-400',
    selection: 'text-purple-600 dark:text-purple-400',
    region: 'text-emerald-600 dark:text-emerald-400',
  }
  const kindIcon  = { container: '○', selection: '◉', region: '▣' }

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={placeholder ?? (mode === 'regions' ? 'event filter…'
          : expectedType ? `${expectedType} container…` : 'container…')}
        onChange={handleInput}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-full rounded bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400"
      />

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 top-full mt-0.5 w-full max-h-48 overflow-y-auto bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg shadow-xl text-xs"
        >
          {filtered.map((s, i) => (
            <li
              key={s.value}
              onMouseDown={() => commit(s.value)}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${
                i === activeIdx ? 'bg-blue-100 dark:bg-blue-600/30 text-slate-900 dark:text-slate-100' : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <span className={`${kindColor[s.kind]} shrink-0`}>{kindIcon[s.kind]}</span>
              <span className="font-mono">{s.label}</span>
              <span className="ml-auto text-slate-400 dark:text-slate-600 shrink-0">{s.hint}</span>
            </li>
          ))}
        </ul>
      )}

      {open && filtered.length === 0 && query.length > 0 && allSuggestions.length > 0 && (
        <div className="absolute z-50 left-0 top-full mt-0.5 w-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-500">
          No matches. Using custom value.
        </div>
      )}
    </div>
  )
}
