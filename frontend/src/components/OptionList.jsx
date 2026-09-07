import OptionField from './OptionField.jsx'
import { GENERIC_SECTION_LABEL, isExpertOption, isGenericOption, optionsByOrigin } from '../utils/schema.js'

/**
 * Renders the options of one block/sub-block instance:
 *   - main options, sectioned by declaring class for @groupBlocks entries
 *   - expert-only options hidden unless `showExpert`
 *   - generic ConfigBlock options in a collapsed section
 *
 * Props:
 *   blockDef, values, onChange(key, value), showExpert, blockName, depIssues,
 *   isSub, inherited: { optionName: valueFromParent }, keywords
 */
export default function OptionList({
  blockDef, values, onChange, showExpert, blockName, depIssues = [], isSub = false,
  inherited = {}, keywords,
}) {
  const all = blockDef.options || []
  const visible = opt => showExpert || !isExpertOption(opt) || isSet(values[opt.name])
  const hiddenExpert = all.filter(o => !isGenericOption(o) && isExpertOption(o) && !visible(o)).length
  const generic = all.filter(o => isGenericOption(o) && visible(o))
  const sections = blockDef.kind === 'group' && blockDef.classes?.length > 1
    ? optionsByOrigin(blockDef)
    : [{ origin: null, options: all.filter(o => !isGenericOption(o)) }]

  const field = opt => (
    <OptionField
      key={opt.name}
      option={opt}
      blockDef={blockDef}
      isSub={isSub}
      value={values[opt.name] ?? ''}
      inheritedValue={inherited[opt.name]}
      onChange={val => onChange(opt.name, val)}
      blockName={blockName}
      depIssue={depIssues.find(i => i.path.endsWith(`.${opt.name}`))?.message}
      keywords={keywords}
    />
  )

  const nothing = all.length === 0

  return (
    <div className="space-y-1">
      {nothing && (
        <p className="text-xs text-slate-500 italic">
          {blockDef.opaque ? 'Options unknown — this custom block could not be introspected.' : 'This block has no options; it will be written as {}.'}
        </p>
      )}

      {sections.map(({ origin, options }) => {
        const shown = options.filter(visible)
        if (!shown.length) return null
        return (
          <div key={origin ?? 'main'}>
            {origin && (
              <p className="text-xs text-slate-500 font-mono mt-2 mb-0.5 border-b border-slate-200 dark:border-slate-800 pb-0.5" title="ConfigBlock class declaring these options">
                {origin}
              </p>
            )}
            {shown.map(field)}
          </div>
        )
      })}

      {hiddenExpert > 0 && (
        <p className="text-xs text-slate-400 dark:text-slate-600 italic pt-1">
          {hiddenExpert} expert-only option{hiddenExpert > 1 ? 's' : ''} hidden — toggle 🧪 Expert in the header.
        </p>
      )}

      {generic.length > 0 && (
        <details className="mt-2 group">
          <summary className="text-xs uppercase tracking-wider text-slate-500 font-semibold cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300">
            {GENERIC_SECTION_LABEL}
            {isSub && <span className="normal-case tracking-normal font-normal text-slate-400 dark:text-slate-600"> — inherited from the parent unless set</span>}
          </summary>
          <div className="mt-1">{generic.map(field)}</div>
        </details>
      )}
    </div>
  )
}

function isSet(v) {
  return !(v === '' || v === null || v === undefined)
}
