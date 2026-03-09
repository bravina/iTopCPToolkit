import InfoPopover from './InfoPopover.jsx'
import CollectionField from './CollectionField.jsx'
import { getAutocompleteMode } from '../utils/collectionRegistry.js'

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseTypedValue(raw, type) {
  if (raw === '' || raw === null || raw === undefined) return raw
  if (type === 'int') {
    const n = parseInt(raw, 10)
    return isNaN(n) ? raw : n
  }
  if (type === 'float') {
    const n = parseFloat(raw)
    return isNaN(n) ? raw : n
  }
  if (type === 'list') {
    if (typeof raw === 'string') {
      try { return JSON.parse(raw) } catch { /* fall through */ }
      return raw.split(',').map(s => s.trim()).filter(Boolean)
    }
  }
  return raw
}

function displayValue(value, type) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.join(', ')
  return String(value)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function BoolField({ value, onChange }) {
  return (
    <div className="flex items-center gap-3 mt-1">
      {[true, false].map(bool => (
        <label key={String(bool)} className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            name={`bool-${Math.random()}`}
            checked={value === bool}
            onChange={() => onChange(bool)}
            className="accent-blue-500"
          />
          <span className={`text-xs ${value === bool ? 'text-slate-100' : 'text-slate-400'}`}>
            {String(bool)}
          </span>
        </label>
      ))}
      {value !== true && value !== false && (
        <span className="text-xs text-slate-600 italic">not set</span>
      )}
    </div>
  )
}

function StringField({ opt, value, onChange, blockName }) {
  const useCollection = getAutocompleteMode(opt.name, blockName)

  if (useCollection) {
    return (
      <CollectionField
        optName={opt.name}
        value={value ?? ''}
        onChange={onChange}
      />
    )
  }

  const isMultiline = opt.name === 'selectionCuts' || opt.info?.includes('\n')

  if (isMultiline) {
    return (
      <textarea
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        rows={4}
        className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-slate-200 font-mono
                   focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                   resize-y placeholder:text-slate-600"
        placeholder={opt.required ? 'required' : opt.default != null ? String(opt.default) : ''}
        spellCheck={false}
      />
    )
  }

  return (
    <input
      type="text"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono
                 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                 placeholder:text-slate-600"
      placeholder={opt.required ? 'required' : opt.default != null ? String(opt.default) : ''}
    />
  )
}

function NumberField({ opt, value, onChange }) {
  return (
    <input
      type="number"
      value={value ?? ''}
      onChange={e => onChange(parseTypedValue(e.target.value, opt.type))}
      step={opt.type === 'float' ? 'any' : 1}
      className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono
                 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                 placeholder:text-slate-600"
      placeholder={opt.default != null ? String(opt.default) : ''}
    />
  )
}

function ListField({ opt, value, onChange }) {
  const display = Array.isArray(value) ? value.join(', ') : (value ?? '')
  return (
    <input
      type="text"
      value={display}
      onChange={e => onChange(parseTypedValue(e.target.value, 'list'))}
      className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 font-mono
                 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30
                 placeholder:text-slate-600"
      placeholder="comma-separated values"
    />
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * Renders a single option row.
 *
 * Props:
 *   option     – option definition from schema { name, type, default, info, required, noneAction }
 *                (passed as `option` prop by callers; aliased to `opt` internally)
 *   value      – current value (from block instance options)
 *   onChange   – (newValue) => void
 *   blockName  – name of the parent block (for collection autocomplete + data-option attribute)
 *   depIssues  – array of dependency issues from checkDepsFromState (optional)
 */
export default function OptionField({ option: opt, value, onChange, blockName, depIssues }) {
  const depWarning = depIssues?.find(i => i.path.endsWith(`.${opt.name}`))?.message

  const isRequired = opt.required || opt.noneAction === 'error'

  function renderInput() {
    const type = opt.type

    if (type === 'bool') {
      return <BoolField value={value} onChange={onChange} />
    }
    if (type === 'int' || type === 'float') {
      return <NumberField opt={opt} value={value} onChange={onChange} />
    }
    if (type === 'list') {
      return <ListField opt={opt} value={value} onChange={onChange} />
    }
    return <StringField opt={opt} value={value} onChange={onChange} blockName={blockName} />
  }

  return (
    <div
      data-option={`${blockName}:${opt.name}`}
      className="py-2 border-b border-slate-800/60 last:border-0"
    >
      {/* Label row */}
      <div className="flex items-center gap-1 mb-1 min-w-0">
        <span className="text-xs font-mono text-blue-300 shrink-0">
          {opt.name}
        </span>

        {/* Type badge */}
        {opt.type && (
          <span className="text-xs text-slate-600 font-mono shrink-0">
            ({opt.type})
          </span>
        )}

        {/* Required badge */}
        {isRequired && (
          <span className="text-xs text-amber-500 shrink-0" title="Required">
            *
          </span>
        )}

        {/* Info popover */}
        {opt.info && <InfoPopover info={opt.info} />}

        {/* Default value hint */}
        {opt.default != null && opt.default !== '' && (
          <span className="text-xs text-slate-700 ml-auto shrink-0 font-mono truncate max-w-[120px]"
                title={`Default: ${Array.isArray(opt.default) ? JSON.stringify(opt.default) : String(opt.default)}`}>
            ={Array.isArray(opt.default) ? '[…]' : String(opt.default).substring(0, 20)}
          </span>
        )}
      </div>

      {/* Input */}
      {renderInput()}

      {/* Dependency warning */}
      {depWarning && (
        <p className="text-xs text-orange-400 mt-0.5 flex items-center gap-1">
          <span>⊘</span> {depWarning}
        </p>
      )}
    </div>
  )
}
