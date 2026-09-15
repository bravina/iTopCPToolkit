import { useState, useMemo } from 'react'
import {
  SIGNS, stripDeprecated, splitCutLines, joinCutLines, parseCutLine, serializeCutLine,
  keywordNames, keywordSpec, specForms, newDraft, draftFromParsed, withForm, draftToLine,
  missingArgs,
} from '../utils/eventSelection.js'
import { useRegistry } from '../contexts/RegistryContext.js'

/**
 * Editor for EventSelection.selectionCuts (one cut per line).
 *
 * Without a keyword spec in the schema it is a plain textarea.  With a spec
 * (`schema.keywords`, provided upstream by EventSelectionConfig) it offers a
 * row-based editor where each line's arguments are typed inputs; lines the
 * spec cannot parse stay editable as raw text.  Lines whose keyword upstream
 * marks `deprecated` (currently `SAVE`) are flagged with a one-click removal;
 * which keywords those are comes from the spec, never from a hardcoded name.
 *
 * A row being edited holds a DRAFT (keyword + form + arguments) and writes the
 * text from it.  Deriving the row from the text instead would lose an argument
 * the moment it is empty — a newly added `EL_N` would serialise to `EL_N  >=`,
 * fail to parse, and drop the user into a bare text box with no idea what to
 * type.  See utils/eventSelection.js.
 */
export default function SelectionCutsEditor({ value, onChange, keywords }) {
  const [visual, setVisual] = useState(!!keywords)
  const { dropped } = useMemo(() => stripDeprecated(value, keywords), [value, keywords])
  const specAvailable = !!keywords && Object.keys(keywords).length > 0

  return (
    <div className="border border-slate-300 dark:border-slate-600 rounded-lg overflow-hidden mt-1">
      <div className="flex items-center justify-between px-3 py-1 bg-slate-200 dark:bg-slate-700 border-b border-slate-300 dark:border-slate-600">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">Selection cuts</span>
        <div className="flex items-center gap-2">
          {dropped.length > 0 && (
            <button type="button" onClick={() => onChange(stripDeprecated(value, keywords).text)}
              className="text-xs px-2 py-0.5 rounded bg-yellow-100 dark:bg-yellow-800/60 hover:bg-yellow-200 dark:hover:bg-yellow-700 text-yellow-800 dark:text-yellow-200"
              title={keywords?.[dropped[0]]?.info || 'This keyword is deprecated upstream'}>
              ⚠ remove {[...new Set(dropped)].join(', ')}
            </button>
          )}
          {specAvailable && (
            <button type="button" onClick={() => setVisual(v => !v)}
              className="text-xs px-2 py-0.5 rounded bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500 text-slate-700 dark:text-slate-300">
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
            className="w-full bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono text-xs px-3 py-2 outline-none resize-y border-none"
            placeholder={'One cut per line, e.g.\nEL_N 25000 >= 1\nJET_N 25000 >= 4\nMET >= 30000'}
          />
        )}
      {!specAvailable && (
        <p className="px-3 py-1 text-xs text-slate-400 dark:text-slate-600 border-t border-slate-200 dark:border-slate-800">
          Keyword reference: TopCPToolkit docs → Event selection → available keywords.
        </p>
      )}
    </div>
  )
}

const newId = () => (crypto.randomUUID?.() ?? String(Math.random()))

function RowEditor({ value, onChange, keywords }) {
  const [lines, setLines] = useState(() => splitCutLines(value))
  const kwNames = keywordNames(keywords)

  function commit(next) {
    setLines(next)
    onChange(joinCutLines(next))
  }
  const replace = (id, row) => commit(lines.map(l => (l.id === id ? { ...row, id } : l)))
  /** Raw text edited by hand: the draft is gone, the text is the truth again. */
  const setRaw = (id, raw) => replace(id, { raw })
  /** An argument or keyword changed: the draft is the truth, the text follows. */
  const setDraft = (id, draft) => replace(id, { draft, raw: draftToLine(draft, keywords) })
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
    const draft = newDraft(kwNames[0], keywords)
    commit([...lines, { id: newId(), draft, raw: draftToLine(draft, keywords) }])
  }

  return (
    <div className="p-2 space-y-1 bg-white dark:bg-slate-900">
      {lines.length === 0 && <p className="text-xs text-slate-500 italic px-2 py-1">No cuts yet.</p>}
      {lines.map((line, idx) => (
        <CutRow key={line.id} line={line} keywords={keywords}
          onSetRaw={raw => setRaw(line.id, raw)} onSetDraft={d => setDraft(line.id, d)}
          onDelete={() => remove(line.id)}
          onMoveUp={() => move(line.id, -1)} onMoveDown={() => move(line.id, 1)}
          canMoveUp={idx > 0} canMoveDown={idx < lines.length - 1} />
      ))}
      <button type="button" onClick={add} className="mt-0.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 px-2">+ Add cut</button>
    </div>
  )
}

const SMALL = 'rounded bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-1 py-0.5 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400'

function CutRow({ line, keywords, onSetRaw, onSetDraft, onDelete, onMoveUp, onMoveDown, canMoveUp, canMoveDown }) {
  const kwNames = keywordNames(keywords)
  const parsed = parseCutLine(line.raw, keywords)
  // A row carries its draft while being edited; one loaded from text gets the
  // draft its text parses to, so the first edit does not restart from scratch.
  const draft = line.draft || draftFromParsed(parsed)
  const spec = draft ? keywordSpec(keywords, draft.keyword) : null
  const isComment = !draft && parsed.keyword === null
  const forms = spec ? specForms(spec) : []
  const missing = spec && !spec.freeText ? missingArgs(draft.form, draft.args) : []
  // Only a line that is genuinely unparsable shows the parser's complaint: a
  // draft with empty arguments is incomplete, not wrong.
  const error = draft ? null : parsed.error

  const setKeyword = kw => onSetDraft(newDraft(kw, keywords))
  const setForm = i => onSetDraft(withForm(draft, forms[i], keywords))
  const setArg = (name, v) => onSetDraft({ ...draft, args: { ...draft.args, [name]: v } })

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 group flex-wrap">
      {!isComment && (
        <select value={spec ? draft.keyword : ''} onChange={e => setKeyword(e.target.value)}
          className={`${SMALL} font-bold ${spec ? 'text-blue-700 dark:text-blue-300' : 'text-amber-700 dark:text-amber-300'}`}
          title={spec?.info || ''}>
          {!spec && <option value="">{parsed.keyword}</option>}
          {kwNames.map(kw => <option key={kw} value={kw}>{kw}</option>)}
        </select>
      )}

      {spec
        ? (spec.freeText
            ? <input type="text" value={draft.args.text ?? ''} onChange={e => setArg('text', e.target.value)}
                className={`${SMALL} flex-1 min-w-0`} placeholder="expression" />
            : (
              <>
                {forms.length > 1 && (
                  <select value={forms.indexOf(draft.form)} onChange={e => setForm(Number(e.target.value))}
                    className={`${SMALL} text-slate-600 dark:text-slate-400`}
                    title="This keyword accepts several argument forms">
                    {forms.map((f, i) => (
                      <option key={i} value={i}>{f.map(a => a.name).join(' ')}</option>
                    ))}
                  </select>
                )}
                {(draft.form || []).map(a => (
                  <ArgInput key={a.name} spec={a} value={draft.args[a.name]}
                    missing={missing.includes(a.name)} onChange={v => setArg(a.name, v)} />
                ))}
              </>
            ))
        : (
          <input type="text" value={line.raw} onChange={e => onSetRaw(e.target.value)}
            className={`${SMALL} flex-1 min-w-0 ${error ? 'border-amber-400/60 dark:border-amber-600/60 text-amber-800 dark:text-amber-200' : ''}`}
            title={error || 'raw line'} placeholder="raw cut line" />
        )}
      {error && <span className="text-xs text-amber-600 dark:text-amber-400" title={error}>⚠</span>}
      {missing.length > 0 && (
        <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0"
          title={`This cut is incomplete until ${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} a value`}>
          needs {missing.join(', ')}
        </span>
      )}

      <div className="flex-1" />
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button type="button" onClick={onMoveUp} disabled={!canMoveUp} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-20 px-0.5 text-xs">↑</button>
        <button type="button" onClick={onMoveDown} disabled={!canMoveDown} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 disabled:opacity-20 px-0.5 text-xs">↓</button>
        <button type="button" onClick={onDelete} className="text-red-600 dark:text-red-500 hover:text-red-700 dark:hover:text-red-300 px-0.5 text-xs">✕</button>
      </div>
    </div>
  )
}

function ArgInput({ spec, value, onChange, missing = false }) {
  const label = <span className="text-xs text-slate-500 shrink-0">{spec.name}</span>
  const flag = `${SMALL} ${missing ? 'border-amber-400/70 dark:border-amber-600/70' : ''}`
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
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={flag}>
          {(spec.optional || !value) && <option value="">—</option>}
          {spec.choices.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
    )
  }
  if (spec.type === 'flag') {
    return (
      <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400 shrink-0 cursor-pointer">
        <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} /> {spec.name}
      </label>
    )
  }
  if (spec.type === 'container') return <ContainerArg spec={spec} value={value} onChange={onChange} label={label} missing={missing} />
  if (spec.type === 'region') return <RegionArg spec={spec} value={value} onChange={onChange} label={label} missing={missing} />
  const numeric = (spec.type === 'float' || spec.type === 'int') && !spec.signed
  return (
    <label className="flex items-center gap-1 shrink-0">{label}
      <input type={numeric ? 'number' : 'text'} value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={spec.optional ? 'opt.' : spec.type} className={`${flag} ${numeric ? 'w-24' : 'w-28'}`} />
    </label>
  )
}

/**
 * A `region` argument (IMPORT): the selectionName of another EventSelection
 * instance.  The list comes from the registry, which collects the regions the
 * config itself defines — a free-text value is still accepted, since the
 * region may be defined in a config this one is merged with.
 */
function RegionArg({ spec, value, onChange, label, missing }) {
  const { regions } = useRegistry()
  const listId = `cut-regions-${spec.name}`
  return (
    <label className="flex items-center gap-1 shrink-0">{label}
      <input type="text" list={listId} value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder="region" className={`${SMALL} w-40 ${missing ? 'border-amber-400/70 dark:border-amber-600/70' : ''}`} />
      <datalist id={listId}>
        {regions.map(r => <option key={r} value={r} />)}
      </datalist>
    </label>
  )
}

/**
 * A `container` argument (`Name` or `Name.selection`), completed from the
 * collection registry built out of the rest of the config.
 */
function ContainerArg({ spec, value, onChange, label, missing }) {
  const registry = useRegistry()
  const listId = `cut-containers-${spec.name}`
  const options = [
    ...registry.collections.map(c => c.name),
    ...registry.withSelections,
  ]
  return (
    <label className="flex items-center gap-1 shrink-0">{label}
      <input type="text" list={listId} value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder="Container[.selection]" className={`${SMALL} w-40 ${missing ? 'border-amber-400/70 dark:border-amber-600/70' : ''}`} />
      <datalist id={listId}>
        {[...new Set(options)].map(o => <option key={o} value={o} />)}
      </datalist>
    </label>
  )
}
