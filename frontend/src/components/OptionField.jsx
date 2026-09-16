import { useEffect, useState } from 'react'
import InfoPopover from './InfoPopover.jsx'
import CollectionField from './CollectionField.jsx'
import SelectionCutsEditor from './SelectionCutsEditor.jsx'
import { getAutocompleteMode } from '../utils/collectionRegistry.js'
import { isExpertOption, isRequiredOption, optionChoices, optionMaxChoices } from '../utils/schema.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

const INPUT = 'w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-xs text-slate-800 dark:text-slate-200 font-mono ' +
              'focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 placeholder:text-slate-400 dark:placeholder:text-slate-600'

function parseNumber(raw, type) {
  if (raw === '' || raw === null || raw === undefined) return ''
  const n = type === 'int' ? parseInt(raw, 10) : parseFloat(raw)
  return Number.isNaN(n) ? raw : n
}

function placeholderFor(opt, inheritedValue) {
  if (inheritedValue !== undefined) return `inherits ${formatValue(inheritedValue)}`
  if (isRequiredOption(opt)) return 'required'
  if (opt.default !== null && opt.default !== undefined && opt.default !== '') return formatValue(opt.default)
  return ''
}

function formatValue(v) {
  if (Array.isArray(v)) return v.length ? v.join(', ') : '[]'
  if (v && typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// ── Field types ───────────────────────────────────────────────────────────────

function BoolField({ value, onChange, defaultValue, inheritedValue }) {
  const effective = (value === true || value === false) ? value : (inheritedValue ?? defaultValue)
  const isOn = effective === true
  const explicit = value === true || value === false
  return (
    <div className="flex items-center gap-2 mt-1">
      <button type="button" role="switch" aria-checked={isOn} onClick={() => onChange(!isOn)}
        className={`relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 focus:outline-none ${isOn ? 'bg-blue-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${isOn ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
      <span className={`text-xs ${isOn ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'}`}>{String(isOn)}</span>
      {!explicit && <span className="text-xs text-slate-400 dark:text-slate-600 italic">(default)</span>}
      {explicit && <button type="button" onClick={() => onChange('')} className="text-xs text-slate-400 dark:text-slate-600 hover:text-slate-600 dark:hover:text-slate-400" title="Back to default">reset</button>}
    </div>
  )
}

function ChoiceField({ opt, value, onChange, choices }) {
  const known = choices.some(c => String(c) === String(value))
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={INPUT}>
      <option value="">{opt.default !== '' && opt.default != null ? `default (${formatValue(opt.default)})` : '— unset —'}</option>
      {!known && value !== '' && value != null && <option value={value}>{String(value)} (not in choices)</option>}
      {choices.map(c => <option key={String(c)} value={c}>{String(c)}</option>)}
    </select>
  )
}

/**
 * A `list` option with `meta.choices`: pick several of a fixed set
 * (e.g. CommonServices.onlySystematicsCategories).  `maxChoices` caps how many
 * may be on at once; unset means no limit.
 */
function MultiChoiceField({ opt, value, onChange, choices, max }) {
  const selected = Array.isArray(value) ? value.map(String) : (value ? [String(value)] : [])
  const atCap = max !== null && selected.length >= max
  function toggle(choice) {
    const next = selected.includes(choice) ? selected.filter(c => c !== choice) : [...selected, choice]
    onChange(next.length ? next : '')
  }
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {choices.map(c => {
          const on = selected.includes(String(c))
          return (
            <button type="button" key={String(c)} onClick={() => toggle(String(c))} disabled={!on && atCap}
              aria-pressed={on}
              className={`text-xs font-mono px-1.5 py-0.5 rounded border transition-colors ${on
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-blue-500 disabled:opacity-40 disabled:hover:border-slate-300 dark:disabled:hover:border-slate-600'}`}>
              {String(c)}
            </button>
          )
        })}
      </div>
      {selected.some(c => !choices.some(k => String(k) === c)) && (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
          not in choices: {selected.filter(c => !choices.some(k => String(k) === c)).join(', ')}
        </p>
      )}
      {max !== null && <p className="text-xs text-slate-400 dark:text-slate-600 mt-0.5">at most {max}</p>}
    </div>
  )
}

function NumberField({ opt, value, onChange, placeholder }) {
  return (
    <div className="flex items-center gap-2">
      <input type="number" value={value ?? ''} onChange={e => onChange(parseNumber(e.target.value, opt.type))}
        step={opt.type === 'float' ? 'any' : 1} className={INPUT} placeholder={placeholder} />
      {opt.physicalUnit && <span className="text-xs text-slate-500 shrink-0" title="Physical unit (from the option's help text)">{opt.physicalUnit}</span>}
    </div>
  )
}

/** Text shown for a list value. */
function listText(v) {
  return Array.isArray(v) ? v.join(', ') : (v ?? '')
}

/** Comma-separated text → list; blank text means "unset" (''), never []. */
function parseList(text) {
  const parts = String(text).split(',').map(s => s.trim()).filter(Boolean)
  return parts.length ? parts : ''
}

function listUnset(v) {
  return v === '' || v === null || v === undefined || (Array.isArray(v) && v.length === 0)
}

function sameList(a, b) {
  return (listUnset(a) && listUnset(b)) || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Comma-separated for scalar lists; JSON editing when the list holds objects.
 *
 * The text being typed is kept locally so a trailing comma survives the
 * round-trip through the parsed value; the field only resyncs from the prop
 * when an outside change (undo, import) makes it differ by value.
 */
function ListField({ value, onChange, placeholder }) {
  // Hooks stay above the early return so the hook order is stable when a value
  // flips between a scalar list and a list of objects.
  const [text, setText] = useState(() => listText(value))
  useEffect(() => {
    if (!sameList(parseList(text), value)) setText(listText(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const isComplex = Array.isArray(value) && value.some(v => v && typeof v === 'object')
  if (isComplex) return <JsonField value={value} onChange={onChange} expect="array" />

  function handle(t) {
    setText(t)
    onChange(parseList(t))
  }
  return (
    <input type="text" value={text} onChange={e => handle(e.target.value)}
      className={INPUT} placeholder={placeholder || 'comma-separated values'} />
  )
}

function JsonField({ value, onChange, expect }) {
  const [text, setText] = useState(() => (value && typeof value === 'object') ? JSON.stringify(value, null, 1) : (value ?? ''))
  const [err, setErr] = useState(null)
  function handle(t) {
    setText(t)
    if (t.trim() === '') { setErr(null); onChange(''); return }
    try {
      const parsed = JSON.parse(t)
      const ok = expect === 'array' ? Array.isArray(parsed) : (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      if (!ok) throw new Error(`expected a JSON ${expect === 'array' ? 'array' : 'object'}`)
      setErr(null)
      onChange(parsed)
    } catch (e) {
      setErr(e.message)
    }
  }
  return (
    <div>
      <textarea value={text} onChange={e => handle(e.target.value)} rows={3} spellCheck={false}
        className={`${INPUT} resize-y ${err ? 'border-red-500' : ''}`} placeholder={expect === 'array' ? '[ ... ]' : '{ "key": value }'} />
      {err && <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{err}</p>}
    </div>
  )
}

function StringField({ opt, value, onChange, blockDef, isSub, placeholder, keywords, container }) {
  // AB 25.2.110 allows only 'choices' and 'role' in meta, so there is no
  // upstream marker for "this string holds several lines".  selectionCuts is
  // the one such option and has an editor of its own.
  if (opt.name === 'selectionCuts') {
    return <SelectionCutsEditor value={value ?? ''} onChange={onChange} keywords={keywords} />
  }
  const mode = getAutocompleteMode(opt, { isSub, blockName: blockDef?.name })
  if (mode) {
    return <CollectionField optName={opt.name} value={value ?? ''} onChange={onChange}
      placeholder={placeholder} mode={mode} container={container} />
  }
  return <input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} className={INPUT} placeholder={placeholder} />
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * One option row: label (name, type, required, expert, unit, info, default)
 * and the input widget chosen from the option's type and metadata.
 */
export default function OptionField({
  option: opt, value, onChange, blockName, blockDef, isSub = false, inheritedValue, depIssue, keywords,
  container,
}) {
  const placeholder = placeholderFor(opt, inheritedValue)
  const choices = optionChoices(opt)

  function renderInput() {
    if (opt.type === 'bool') return <BoolField value={value} onChange={onChange} defaultValue={opt.default} inheritedValue={inheritedValue} />
    if (choices && opt.type === 'list') return <MultiChoiceField opt={opt} value={value} onChange={onChange} choices={choices} max={optionMaxChoices(opt)} />
    if (choices) return <ChoiceField opt={opt} value={value} onChange={onChange} choices={choices} />
    if (opt.type === 'int' || opt.type === 'float') return <NumberField opt={opt} value={value} onChange={onChange} placeholder={placeholder} />
    if (opt.type === 'list') return <ListField value={value} onChange={onChange} placeholder={placeholder} />
    if (opt.type === 'dict') return <JsonField value={value} onChange={onChange} expect="object" />
    return <StringField opt={opt} value={value} onChange={onChange} blockDef={blockDef} isSub={isSub} placeholder={placeholder} keywords={keywords} container={container} />
  }

  return (
    <div data-option={`${blockName}:${opt.name}`} className="py-2 border-b border-slate-200/60 dark:border-slate-800/60 last:border-0">
      <div className="flex items-center gap-1 mb-1 min-w-0">
        <span className="text-xs font-mono text-blue-700 dark:text-blue-300 shrink-0">{opt.name}</span>
        {opt.type && <span className="text-xs text-slate-400 dark:text-slate-600 font-mono shrink-0">({opt.type})</span>}
        {isRequiredOption(opt) && <span className="text-xs text-amber-600 dark:text-amber-500 shrink-0" title="Required">*</span>}
        {isExpertOption(opt) && (
          <span className="text-xs px-1 rounded bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 shrink-0"
            title={`Expert-only${opt.expertMode[0] === true ? ' (any non-default value)' : ` values: ${opt.expertMode.join(', ')}`} — needs CommonServices.enableExpertMode`}>
            expert
          </span>
        )}
        {inheritedValue !== undefined && (
          <span className="text-xs text-slate-500 shrink-0" title="Propagated from the parent block unless set here">↳ inherited</span>
        )}
        {opt.info && <InfoPopover info={opt.info} />}
        {opt.default !== null && opt.default !== undefined && opt.default !== '' && (
          <span className="text-xs text-slate-400 dark:text-slate-700 ml-auto shrink-0 font-mono truncate max-w-[120px]"
            title={`Default: ${formatValue(opt.default)}${opt.factoryDefault !== null && opt.factoryDefault !== undefined ? ' (set by the factory)' : ''}`}>
            ={formatValue(opt.default).substring(0, 20)}
          </span>
        )}
      </div>

      {renderInput()}

      {depIssue && (
        <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5 flex items-center gap-1"><span>⊘</span> {depIssue}</p>
      )}
    </div>
  )
}
