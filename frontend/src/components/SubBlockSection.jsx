import OptionField from './OptionField.jsx'

/**
 * Renders one sub-block (e.g. JVT, WorkingPoint, FlavourTagging) within a parent instance.
 */
export default function SubBlockSection({
  subDef, subState,
  onToggle, onSetOption, onAddInstance, onRemoveInstance,
}) {
  const { name, label, repeatable, options = [] } = subDef

  return (
    <div className="border border-slate-600 rounded-lg overflow-hidden">
      {/* Sub-block header with toggle */}
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-3 py-2 text-sm font-semibold transition-colors ${
          subState?.enabled
            ? 'bg-slate-600 text-slate-100'
            : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
        }`}
      >
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${subState?.enabled ? 'bg-blue-400' : 'bg-slate-500'}`} />
          {label}
        </span>
        <span className="text-xs opacity-60">{subState?.enabled ? 'enabled' : 'disabled'}</span>
      </button>

      {subState?.enabled && (
        <div className="p-3 bg-slate-800/50 space-y-1">
          {subState.instances.map((si, idx) => (
            <div key={si._id} className="rounded bg-slate-800 p-3 border border-slate-700">
              {repeatable && (
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400 font-mono">Instance {idx + 1}</span>
                  {subState.instances.length > 1 && (
                    <button
                      onClick={() => onRemoveInstance(si._id)}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      ✕ remove
                    </button>
                  )}
                </div>
              )}

              {options.length === 0 && (
                <p className="text-xs text-slate-500 italic">
                  No options introspected — will use defaults (rendered as {'{}'}).
                </p>
              )}

              {options.map(opt => (
                <OptionField
                  key={opt.name}
                  option={opt}
                  value={si.options[opt.name] ?? ''}
                  onChange={val => onSetOption(si._id, opt.name, val)}
                />
              ))}
            </div>
          ))}

          {repeatable && (
            <button
              onClick={onAddInstance}
              className="mt-1 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
            >
              + Add {label} instance
            </button>
          )}
        </div>
      )}
    </div>
  )
}
