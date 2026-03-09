import { useState, useRef, useEffect } from 'react'
import { useRegistry } from '../contexts/RegistryContext.js'
import { inferFieldType } from '../utils/collectionRegistry.js'

/**
 * A text input that shows a dropdown of matching container/selection names
 * from the current registry, filtered to the expected physics object type.
 *
 * Props:
 *   optName         – option name (used to infer expected type)
 *   value, onChange
 *   placeholder
 *   allowSelections – whether to show container.selection pairs (default true)
 */
export default function CollectionField({ optName, value, onChange, placeholder }) {
  const registry = useRegistry()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(value ?? '')
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const [activeIdx, setActiveIdx] = useState(0)

  // Sync external value changes into local query
  useEffect(() => { setQuery(value ?? '') }, [value])

  const expectedType = inferFieldType(optName)

  // Build candidate list: containers first, then container.selection pairs
  const allSuggestions = []

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

  // Filter by query
  const q = query.trim().toLowerCase()
  const filtered = q === ''
    ? allSuggestions
    : allSuggestions.filter(s => s.value.toLowerCase().includes(q))

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

  const kindColor = { container: 'text-blue-400', selection: 'text-purple-400' }
  const kindIcon  = { container: '○', selection: '◉' }

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={query}
        placeholder={placeholder ?? (expectedType ? `${expectedType} container…` : 'container…')}
        onChange={handleInput}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-full rounded bg-slate-700 border border-slate-600 px-2 py-1 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-400"
      />

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 top-full mt-0.5 w-full max-h-48 overflow-y-auto bg-slate-800 border border-slate-600 rounded-lg shadow-xl text-xs"
        >
          {filtered.map((s, i) => (
            <li
              key={s.value}
              onMouseDown={() => commit(s.value)}
              className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${
                i === activeIdx ? 'bg-blue-600/30 text-slate-100' : 'hover:bg-slate-700 text-slate-300'
              }`}
            >
              <span className={`${kindColor[s.kind]} shrink-0`}>{kindIcon[s.kind]}</span>
              <span className="font-mono">{s.label}</span>
              <span className="ml-auto text-slate-600 shrink-0">{s.hint}</span>
            </li>
          ))}
        </ul>
      )}

      {open && filtered.length === 0 && query.length > 0 && allSuggestions.length > 0 && (
        <div className="absolute z-50 left-0 top-full mt-0.5 w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-500">
          No matches. Using custom value.
        </div>
      )}
    </div>
  )
}
