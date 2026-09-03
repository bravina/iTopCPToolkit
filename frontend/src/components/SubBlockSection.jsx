import OptionList from './OptionList.jsx'

/**
 * One sub-block (e.g. JVT, WorkingPoint) inside a parent instance.
 *
 * TextConfig propagates `containerName` and the skip* generic options from
 * the parent instance to its sub-blocks; those are shown with the inherited
 * value as placeholder rather than hidden, so users see what will apply.
 */
const INHERITED = ['containerName', 'skipOnData', 'skipOnMC', 'skipWithSystematics', 'onlyForDSIDs']

export default function SubBlockSection({
  subDef, subState, parentOptions = {}, parentDef, blockName, showExpert, keywords, depIssues = [],
  onToggle, onSetOption, onAddInstance, onRemoveInstance,
}) {
  const enabled = subState?.enabled ?? false
  const instances = subState?.instances ?? []

  const inherited = {}
  for (const name of INHERITED) {
    const fromParent = parentOptions[name]
    const parentDefault = parentDef?.options?.find(o => o.name === name)?.default
    const v = fromParent !== undefined && fromParent !== '' ? fromParent : parentDefault
    if (v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && !v.length)) inherited[name] = v
  }

  return (
    <div className="border border-slate-600 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-3 py-2 text-sm font-semibold transition-colors ${
          enabled ? 'bg-slate-600 text-slate-100' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'}`}
        title={subDef.factoryName}
      >
        <span className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-blue-400' : 'bg-slate-500'}`} />
          {subDef.label}
          {subDef.custom && <span className="text-xs px-1 rounded bg-purple-900/50 text-purple-300 font-normal">custom</span>}
          {subDef.error && <span className="text-xs text-red-400 font-normal" title={subDef.error}>!</span>}
        </span>
        <span className="text-xs opacity-60">
          {enabled ? `${instances.length} instance${instances.length !== 1 ? 's' : ''}` : 'disabled'}
        </span>
      </button>

      {enabled && (
        <div className="p-3 bg-slate-800/50 space-y-1">
          {subDef.error && (
            <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">⚠ {subDef.error}</p>
          )}
          {instances.map((si, idx) => (
            <div key={si._id} className="rounded bg-slate-800 p-3 border border-slate-700">
              {instances.length > 1 && (
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400 font-mono">Instance {idx + 1}</span>
                  <button onClick={() => onRemoveInstance(si._id)} className="text-xs text-red-400 hover:text-red-300">
                    ✕ remove
                  </button>
                </div>
              )}
              <OptionList
                blockDef={subDef}
                values={si.options}
                onChange={(key, val) => onSetOption(si._id, key, val)}
                showExpert={showExpert}
                blockName={blockName}
                isSub
                inherited={inherited}
                keywords={keywords}
                depIssues={depIssues.filter(i => i.path.includes(`.${subDef.name}[${idx}].`))}
              />
            </div>
          ))}

          <button onClick={onAddInstance} className="mt-1 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            + Add {subDef.label} instance
          </button>
        </div>
      )}
    </div>
  )
}
