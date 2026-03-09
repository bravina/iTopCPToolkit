import OptionField from './OptionField.jsx'
import SubBlockSection from './SubBlockSection.jsx'

export default function BlockPanel({
  blockDef, blockState,
  depIssues,
  onSetOption, onAddInstance, onRemoveInstance,
  onToggleSubBlock, onSetSubOption, onAddSubInstance, onRemoveSubInstance,
}) {
  if (!blockState?.enabled) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Enable this block in the sidebar to configure it.
      </div>
    )
  }

  const { options = [], sub_blocks = [], repeatable } = blockDef
  const parentOptionNames = options.map(o => o.name)

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {blockState.instances.map((inst, idx) => (
        <div key={inst._id} className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-700/50">
            <span className="text-sm font-semibold text-slate-300">
              {repeatable ? `${blockDef.label} — Instance ${idx + 1}` : blockDef.label}
            </span>
            {repeatable && blockState.instances.length > 1 && (
              <button onClick={() => onRemoveInstance(inst._id)}
                className="text-xs text-red-400 hover:text-red-300">
                ✕ Remove instance
              </button>
            )}
          </div>

          <div className="p-4 space-y-1">
            {options.length === 0 && sub_blocks.length === 0 && (
              <p className="text-xs text-slate-500 italic">
                No options introspected — will be written as {'{}'}.
              </p>
            )}
            {options.map(opt => (
              <OptionField
                key={opt.name}
                option={opt}
                value={inst.options[opt.name] ?? ''}
                onChange={val => onSetOption(inst._id, opt.name, val)}
                blockName={blockDef.name}
              />
            ))}

            {sub_blocks.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold mb-1">
                  Sub-blocks
                </p>
                {sub_blocks.map(subDef => {
                  const subState = inst.sub_blocks?.[subDef.name]
                  return (
                    <SubBlockSection
                      key={subDef.name}
                      subDef={subDef}
                      subState={subState}
                      parentOptionNames={parentOptionNames}
                      blockName={blockDef.name}
                      onToggle={() => onToggleSubBlock(inst._id, subDef.name)}
                      onSetOption={(subInstId, key, val) =>
                        onSetSubOption(inst._id, subDef.name, subInstId, key, val)}
                      onAddInstance={() => onAddSubInstance(inst._id, subDef.name)}
                      onRemoveInstance={(subInstId) =>
                        onRemoveSubInstance(inst._id, subDef.name, subInstId)}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ))}

      {repeatable && (
        <button
          onClick={() => onAddInstance(blockDef.name, blockDef)}
          className="w-full py-2 border-2 border-dashed border-slate-600 rounded-xl text-sm text-slate-400 hover:text-slate-200 hover:border-slate-400 transition-colors"
        >
          + Add {blockDef.label} instance
        </button>
      )}
    </div>
  )
}
