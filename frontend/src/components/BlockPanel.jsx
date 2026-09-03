import InfoPopover from './InfoPopover.jsx'
import OptionList from './OptionList.jsx'
import SubBlockSection from './SubBlockSection.jsx'

/**
 * Main editor panel for the selected block: header (label, factory name,
 * classes, docstring, introspection error, dependencies), one card per
 * instance, and the "+ add instance" button (every block may repeat).
 */
export default function BlockPanel({
  blockDef, blockState, depIssues, showExpert, keywords, enabledBlockNames,
  onEnable, onSetOption, onAddInstance, onRemoveInstance,
  onToggleSubBlock, onSetSubOption, onAddSubInstance, onRemoveSubInstance,
}) {
  const docstring = blockDef.classes?.map(c => c.docstring).filter(Boolean).join('\n\n')

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-700 bg-slate-800 shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-bold text-slate-100">{blockDef.label}</h2>
          {blockDef.custom && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300" title="Declared via AddConfigBlocks">custom</span>
          )}
          {blockDef.kind === 'group' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400" title="A @groupBlocks entry: options are the union of several ConfigBlocks">group</span>
          )}
          {docstring && <InfoPopover info={docstring} />}
        </div>
        <p className="text-xs text-slate-500 font-mono mt-0.5 truncate" title={blockDef.classes?.map(c => `${c.module}.${c.cls}`).join('\n')}>
          {blockDef.factoryName}
          {blockDef.classes?.length > 0 && (
            <span className="text-slate-600"> · {blockDef.classes.map(c => c.cls).join(' + ')}</span>
          )}
        </p>
        {blockDef.error && (
          <p className="text-xs text-red-400 mt-1 font-mono whitespace-pre-wrap">⚠ Introspection failed: {blockDef.error}</p>
        )}
        {blockDef.dependencies?.length > 0 && (
          <p className="text-xs text-slate-400 mt-1">
            Depends on:{' '}
            {blockDef.dependencies.map(d => {
              const ok = d.blockName === blockDef.name || enabledBlockNames?.has(d.blockName)
              return (
                <span key={d.blockName} className={`font-mono mr-2 ${ok ? 'text-green-400' : d.required ? 'text-red-400' : 'text-yellow-400'}`}
                  title={d.required ? 'required' : 'optional — reorders after it when present'}>
                  {ok ? '✓' : '✗'} {d.blockName}{d.required ? '' : ' (optional)'}
                </span>
              )
            })}
          </p>
        )}
      </div>

      {!blockState?.enabled ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500 text-sm">
          <span>This block is disabled.</span>
          <button type="button" onClick={onEnable}
            className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white">Enable {blockDef.label}</button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {blockState.instances.map((inst, idx) => (
            <div key={inst._id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-700/50">
                <span className="text-sm font-semibold text-slate-300">
                  {blockState.instances.length > 1 ? `${blockDef.label} — instance ${idx + 1}` : blockDef.label}
                </span>
                {blockState.instances.length > 1 && (
                  <button onClick={() => onRemoveInstance(inst._id)} className="text-xs text-red-400 hover:text-red-300">
                    ✕ Remove instance
                  </button>
                )}
              </div>

              <div className="p-4 space-y-1">
                <OptionList
                  blockDef={blockDef}
                  values={inst.options}
                  onChange={(key, val) => onSetOption(inst._id, key, val)}
                  showExpert={showExpert}
                  blockName={blockDef.name}
                  depIssues={depIssues.filter(i => i.path.startsWith(`${blockDef.name}[${idx}].`) && !/\]\.[^.]+\[/.test(i.path.slice(blockDef.name.length)))}
                  keywords={keywords}
                />

                {blockDef.subBlocks?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">Sub-blocks</p>
                    {blockDef.subBlocks.map(subDef => (
                      <SubBlockSection
                        key={subDef.name}
                        subDef={subDef}
                        subState={inst.subBlocks?.[subDef.name]}
                        parentOptions={inst.options}
                        parentDef={blockDef}
                        blockName={blockDef.name}
                        showExpert={showExpert}
                        keywords={keywords}
                        depIssues={depIssues.filter(i => i.path.startsWith(`${blockDef.name}[${idx}].${subDef.name}[`))}
                        onToggle={() => onToggleSubBlock(inst._id, subDef.name)}
                        onSetOption={(subInstId, key, val) => onSetSubOption(inst._id, subDef.name, subInstId, key, val)}
                        onAddInstance={() => onAddSubInstance(inst._id, subDef.name)}
                        onRemoveInstance={(subInstId) => onRemoveSubInstance(inst._id, subDef.name, subInstId)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          <button
            onClick={onAddInstance}
            className="w-full py-2 border-2 border-dashed border-slate-600 rounded-xl text-sm text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors"
            title="Any block may be given several times; the YAML becomes a list"
          >
            + Add {blockDef.label} instance
          </button>
        </div>
      )}
    </>
  )
}
