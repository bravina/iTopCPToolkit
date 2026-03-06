import { useState, useEffect } from 'react'
import { v4 as uuid } from 'uuid'
import {
  parseSelectionCutsDict,
  parseSelectionCutsString,
  serializeSelectionCutsDict,
  cutsToRawText,
} from '../utils/selectionCutsSerializer.js'
import SelectionCutsEditor from './SelectionCutsEditor.jsx'

function initState(value) {
  const selections = parseSelectionCutsDict(
    value && typeof value === 'object' ? value : {}
  )
  const rawTexts = {}
  for (const sel of selections) {
    rawTexts[sel.id] = cutsToRawText(sel.cuts)
  }
  return { selections, rawTexts }
}

export default function SelectionCutsDictEditor({ value, onChange }) {
  const [isRaw, setIsRaw] = useState(false)
  const [selections, setSelections] = useState(() => initState(value).selections)
  const [rawTexts, setRawTexts] = useState(() => initState(value).rawTexts)
  const [activeId, setActiveId] = useState(null)

  // Keep activeId valid when selections list changes
  useEffect(() => {
    if (selections.length && (!activeId || !selections.find(s => s.id === activeId))) {
      setActiveId(selections[0].id)
    }
  }, [selections, activeId])

  // ── Propagation helpers ─────────────────────────────────────────────────

  function propagateVisual(sels) {
    onChange(serializeSelectionCutsDict(sels))
  }

  function propagateRaw(sels, texts) {
    const dict = {}
    for (const sel of sels) {
      if (sel.name) dict[sel.name] = (texts[sel.id] || '') + '\n'
    }
    onChange(Object.keys(dict).length ? dict : null)
  }

  // ── Mode toggle ─────────────────────────────────────────────────────────

  function toggleMode() {
    if (isRaw) {
      // Raw → Visual: parse each textarea back into structured cuts
      const newSels = selections.map(sel => ({
        ...sel,
        cuts: parseSelectionCutsString(rawTexts[sel.id] || ''),
      }))
      setSelections(newSels)
      propagateVisual(newSels)
    } else {
      // Visual → Raw: serialize structured cuts to text
      const newTexts = {}
      for (const sel of selections) {
        newTexts[sel.id] = cutsToRawText(sel.cuts)
      }
      setRawTexts(newTexts)
      propagateRaw(selections, newTexts)
    }
    setIsRaw(r => !r)
  }

  // ── Selection management ────────────────────────────────────────────────

  function addSelection() {
    const name = `region_${selections.length + 1}`
    const id = uuid()
    const newSels = [...selections, { id, name, cuts: [] }]
    const newTexts = { ...rawTexts, [id]: 'SAVE' }
    setSelections(newSels)
    setRawTexts(newTexts)
    setActiveId(id)
    isRaw ? propagateRaw(newSels, newTexts) : propagateVisual(newSels)
  }

  function renameSelection(id, name) {
    const newSels = selections.map(s => s.id === id ? { ...s, name } : s)
    setSelections(newSels)
    isRaw ? propagateRaw(newSels, rawTexts) : propagateVisual(newSels)
  }

  function deleteSelection(id) {
    const newSels = selections.filter(s => s.id !== id)
    const newTexts = { ...rawTexts }
    delete newTexts[id]
    setSelections(newSels)
    setRawTexts(newTexts)
    if (activeId === id) setActiveId(newSels[0]?.id ?? null)
    isRaw ? propagateRaw(newSels, newTexts) : propagateVisual(newSels)
  }

  // ── Visual mode: cut updates ────────────────────────────────────────────

  function updateCuts(selId, cuts) {
    const newSels = selections.map(s => s.id === selId ? { ...s, cuts } : s)
    setSelections(newSels)
    propagateVisual(newSels)
  }

  // ── Raw mode: textarea updates ──────────────────────────────────────────

  function updateRawText(selId, text) {
    const newTexts = { ...rawTexts, [selId]: text }
    setRawTexts(newTexts)
    propagateRaw(selections, newTexts)
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const activeSel = selections.find(s => s.id === activeId)
  const allNames = selections.map(s => s.name)

  return (
    <div className="border border-slate-600 rounded-lg overflow-hidden mt-1">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-700 border-b border-slate-600">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
          Event Selections
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMode}
            title={isRaw ? 'Switch to visual editor' : 'Switch to raw text'}
            className="text-xs px-2 py-0.5 rounded bg-slate-600 hover:bg-slate-500 text-slate-300 transition-colors"
          >
            {isRaw ? '⊞ Visual' : '</> Raw'}
          </button>
          <button
            type="button"
            onClick={addSelection}
            className="text-xs px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            + Add
          </button>
        </div>
      </div>

      {selections.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-slate-500">
          No selections defined. Click <strong>+ Add</strong> to create one.
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="flex flex-wrap gap-1 px-2 py-1.5 bg-slate-800/60 border-b border-slate-700">
            {selections.map(sel => (
              <button
                key={sel.id}
                type="button"
                onClick={() => setActiveId(sel.id)}
                className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                  sel.id === activeId
                    ? 'bg-blue-600 text-white'
                    : sel.name.startsWith('SUB')
                      ? 'bg-amber-900/50 text-amber-300 hover:bg-amber-800/50'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {sel.name || '(unnamed)'}
              </button>
            ))}
          </div>

          {/* Active selection panel */}
          {activeSel && (
            <div className="bg-slate-900">

              {/* Name row */}
              <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-700">
                <input
                  type="text"
                  value={activeSel.name}
                  onChange={e => renameSelection(activeSel.id, e.target.value)}
                  className="flex-1 text-xs font-mono bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-blue-400"
                  placeholder="selection name"
                />
                {activeSel.name.startsWith('SUB') && (
                  <span className="text-xs text-amber-400 shrink-0" title="Sub-region (not used in final OR filter)">
                    sub-region
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => deleteSelection(activeSel.id)}
                  className="text-xs text-red-400 hover:text-red-300 px-1 shrink-0"
                  title="Delete this selection"
                >✕</button>
              </div>

              {/* Cuts area */}
              {isRaw ? (
                <textarea
                  value={rawTexts[activeSel.id] ?? ''}
                  onChange={e => updateRawText(activeSel.id, e.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="w-full bg-slate-900 text-slate-200 font-mono text-xs px-3 py-2 outline-none resize-y border-none"
                  placeholder="Enter selection cuts, one per line…"
                />
              ) : (
                <SelectionCutsEditor
                  cuts={activeSel.cuts}
                  onChange={cuts => updateCuts(activeSel.id, cuts)}
                  allSelectionNames={allNames}
                  currentSelectionName={activeSel.name}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
