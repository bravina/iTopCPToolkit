import { useState, useMemo } from 'react'
import {
  SIGNS, stripSave, splitCutLines, joinCutLines, parseCutLine, serializeCutLine, defaultArgs,
} from '../utils/eventSelection.js'

/**
 * Editor for EventSelection.selectionCuts (one cut per line).
 *
 * Without a keyword spec in the schema it is a plain textarea.  With a spec
 * (`schema.keywords`, provided upstream by EventSelectionConfig) it offers a
 * row-based editor where each line's arguments are typed inputs; lines the
 * spec cannot parse stay editable as raw text.  `SAVE` lines are flagged
 * (deprecated upstream) with a one-click removal.
 */
export default function SelectionCutsEditor({ value, onChange, keywords }) {
  const [visual, setVisual] = useState(!!keywords)
  const { hadSave } = useMemo(() => stripSave(value), [value])
  const specAvailable = !!keywords && Object.keys(keywords).length > 0

  return (
    <div className="border border-slate-600 rounded-lg overflow-hidden mt-1">
      <div className="flex items-center justify-between px-3 py-1 bg-slate-700 border-b border-slate-600">
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Selection cuts</span>
        <div className="flex items-center gap-2">
          {hadSave && (
            <button type="button" onClick={() => onChange(stripSave(value).text)}
              className="text-xs px-2 py-0.5 rounded bg-yellow-800/60 hover:bg-yellow-700 text-yellow-200"
              title="SAVE is deprecated: the event filter is created automatically at the end of each EventSelection">
              ⚠ remove SAVE
            </button>
          )}
          {specAvailable && (
            <button type="button" onClick={() => setVisual(v => !v)}
              className="text-xs px-2 py-0.5 rounded bg-slate-600 hover:bg-slate-500 text-slate-300">
              {visual ? '</> Raw' : '⊞ Visual'}
            </button>
          )}
        </div>
      </div>

      {visual && specAvailable
        ? <RowEditor value={value} onChange={onChange} keywords={keywords} />
        : (
          <textarea
            value={value ?? ''}
            onChange={e => onChange(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full bg-slate-900 text-slate-200 font-mono text-xs px-3 py-2 outline-none resize-y border-none"
            placeholder={'One cut per line, e.g.\nEL_N 25000 >= 1\nJET_N 25000 >= 4\nMET >= 30000'}
          />
        )}
      {!specAvailable && (
        <p className="px-3 py-1 text-xs text-slate-600 border-t border-slate-800">
          Keyword reference: TopCPToolkit docs → Event selection → available keywords.
        </p>
      )}
    </div>
  )
}

function RowEditor({ value, onChange, keywords }) {
  const [lines, setLines] = useState(() => splitCutLines(value))
  const kwNames = Object.keys(keywords)

  function commit(next) {
    setLines(next)
    onChange(joinCutLines(next))
  }
  const update = (id, raw) => commit(lines.map(l => (l.id === id ? { ...l, raw } : l)))
  const remove = id => commit(lines.filter(l => l.id !== id))
  const move = (id, dir) => {
    const i = lines.findIndex(l => l.id === id)
    if (i + dir < 0 || i + dir >= lines.length) return
    const next = [...lines]
    const [row] = next.splice(i, 1)
    next.splice(i + dir, 0, row)
    commit(next)
  }
  const add = () => {
    const kw = kwNames[0]
    commit([...lines, { id: crypto.randomUUID?.() ?? String(Math.random()), raw: serializeCutLine(kw, defaultArgs(kw, keywords), keywords) }])
  }

  return (
    <div className="p-2 space-y-1 bg-slate-900">
      {lines.length === 0 && <p className="text-xs text-slate-500 italic px-2 py-1">No cuts yet.</p>}
      {lines.map((line, idx) => (
        <CutRow key={line.id} line={line} keywords={keywords}
          onChange={raw => update(line.id, raw)} onDelete={() => remove(line.id)}
          onMoveUp={() => move(line.id, -1)} onMoveDown={() => move(line.id, 1)}
          canMoveUp={idx > 0} canMoveDown={idx < lines.length - 1} />
      ))}
      <button type="button" onClick={add} className="mt-0.5 text-xs text-blue-400 hover:text-blue-300 px-2">+ Add cut</button>
    </div>
  )
}

const SMALL = 'rounded bg-slate-700 border border-slate-600 px-1 py-0.5 text-xs font-mono text-slate-100 focus:outline-none focus:border-blue-400'

function CutRow({ line, keywords, onChange, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  const parsed = parseCutLine(line.raw, keywords)
  const kwNames = Object.keys(keywords)
  const structured = parsed.spec && parsed.args && !parsed.error
  const isComment = parsed.keyword === null

  function setKeyword(kw) {
    onChange(serializeCutLine(kw, defaultArgs(kw, keywords), keywords))
  }
  function setArg(name, v) {
    onChange(serializeCutLine(parsed.keyword, { ...parsed.args, [name]: v }, keywords))
  }

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 group flex-wrap">
      {!isComment && (
        <select value={parsed.spec ? parsed.keyword : ''} onChange={e => setKeyword(e.target.value)}
          className={`${SMALL} font-bold ${parsed.spec ? 'text-blue-300' : 'text-amber-300'}`}
          title={parsed.spec?.info || ''}>
          {!parsed.spec && <option value="">{parsed.keyword}</option>}
          {kwNames.map(kw => <option key={kw} value={kw}>{kw}</option>)}
        </select>
      )}

      {structured
        ? (parsed.spec.freeText
            ? <input type="text" value={parsed.args.text} onChange={e => setArg('text', e.target.value)} className={`${SMALL} flex-1 min-w-0`} placeholder="expression" />
            : parsed.spec.args.map(a => <ArgInput key={a.name} spec={a} value={parsed.args[a.name]} onChange={v => setArg(a.name, v)} />))
        : (
          <input type="text" value={line.raw} onChange={e => onChange(e.target.value)}
            className={`${SMALL} flex-1 min-w-0 ${parsed.error ? 'border-amber-600/60 text-amber-200' : ''}`}
            title={parsed.error || 'raw line'} placeholder="raw cut line" />
        )}
      {parsed.error && <span className="text-xs text-amber-400" title={parsed.error}>⚠</span>}

      <div className="flex-1" />
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp} className="text-slate-500 hover:text-slate-300 disabled:opacity-20 px-0.5 text-xs">↑</button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown} className="text-slate-500 hover:text-slate-300 disabled:opacity-20 px-0.5 text-xs">↓</button>
        <button type="button" onClick={onDelete} className="text-red-500 hover:text-red-300 px-0.5 text-xs">✕</button>
      </div>
    </div>
  )
}

function ArgInput({ spec, value, onChange }) {
  const label = <span className="text-xs text-slate-500 shrink-0">{spec.name}</span>
  if (spec.type === 'sign') {
    return (
      <label className="flex items-center gap-1 shrink-0">{label}
        <select value={value || '>='} onChange={e => onChange(e.target.value)} className={SMALL}>
          {SIGNS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
    )
  }
  if (spec.choices?.length) {
    return (
      <label className="flex items-center gap-1 shrink-0">{label}
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={SMALL}>
          {spec.optional && <option value="">—</option>}
          {spec.choices.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    )
  }
  if (spec.type === 'flag') {
    return (
      <label className="flex items-center gap-1 text-xs text-slate-400 shrink-0 cursor-pointer">
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked ? spec.name : '')} /> {spec.name}
      </label>
    )
  }
  const numeric = spec.type === 'float' || spec.type === 'int'
  return (
    <label className="flex items-center gap-1 shrink-0">{label}
      <input type={numeric ? 'number' : 'text'} value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={spec.optional ? 'opt.' : spec.type} className={`${SMALL} ${numeric ? 'w-24' : 'w-28'}`} />
    </label>
  )
}
