import InfoPopover from './InfoPopover.jsx'
import SelectionCutsDictEditor from './SelectionCutsDictEditor.jsx'

export default function OptionField({ option, value, onChange }) {
  const { name, type, default: defaultVal, info, required } = option
  const displayDefault = defaultVal === null ? 'None' : defaultVal === undefined ? '—' : String(defaultVal)

  const label = (
    <div className="flex items-center gap-1 mb-0.5 flex-wrap">
      <span className="text-sm font-mono font-semibold text-slate-200">{name}</span>
      <span className="text-xs text-slate-500 font-mono">({type})</span>
      {required && <span className="text-xs text-red-400">required</span>}
      <InfoPopover info={info} />
    </div>
  )

  // ── Special-cased options ─────────────────────────────────────────────────

  if (name === 'selectionCutsDict') {
    return (
      <div className="py-1">
        {label}
        <SelectionCutsDictEditor value={value || {}} onChange={onChange} />
      </div>
    )
  }

  if (name === 'selectionCuts') {
    return (
      <div className="py-1">
        {label}
        <textarea
          rows={6}
          value={value === '' ? '' : String(value ?? '')}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          placeholder="One cut per line…"
          className="w-full rounded bg-slate-700 border border-slate-600 px-2 py-1 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-400 resize-y"
        />
      </div>
    )
  }

  // ── Generic type renderers ────────────────────────────────────────────────

  if (type === 'bool') {
    const checked = value === '' ? Boolean(defaultVal) : Boolean(value)
    return (
      <div className="flex items-center gap-3 py-1.5">
        <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
          className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-slate-600'}`}>
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-0.5 ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </button>
        {label}
      </div>
    )
  }

  if (type === 'int' || type === 'float') {
    return (
      <div className="py-1">
        {label}
        <input type="number" step={type === 'int' ? 1 : 'any'}
          value={value === '' ? (defaultVal ?? '') : value}
          placeholder={displayDefault}
          onChange={e => {
            const raw = e.target.value
            if (raw === '') { onChange(''); return }
            onChange(type === 'int' ? parseInt(raw, 10) : parseFloat(raw))
          }}
          className="w-full rounded bg-slate-700 border border-slate-600 px-2 py-1 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-400" />
      </div>
    )
  }

  if (type === 'list' || type === 'dict') {
    const displayVal = value === '' ? '' : (typeof value === 'string' ? value : JSON.stringify(value, null, 2))
    return (
      <div className="py-1">
        {label}
        <textarea rows={3} value={displayVal}
          placeholder={type === 'list' ? '["value1", "value2"]' : '{"key": "value"}'}
          onChange={e => {
            const raw = e.target.value
            if (!raw) { onChange(''); return }
            try { onChange(JSON.parse(raw)) } catch { onChange(raw) }
          }}
          className="w-full rounded bg-slate-700 border border-slate-600 px-2 py-1 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-400 resize-y" />
      </div>
    )
  }

  // str / fallback
  return (
    <div className="py-1">
      {label}
      <input type="text" value={value === '' ? '' : String(value)} placeholder={displayDefault}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded bg-slate-700 border border-slate-600 px-2 py-1 text-sm font-mono text-slate-100 focus:outline-none focus:border-blue-400" />
    </div>
  )
}
