export default function Sidebar({ schema, config, selected, onSelect, onToggle }) {
  const groups = {}
  for (const block of schema) {
    const g = block.group || 'Other'
    if (!groups[g]) groups[g] = []
    groups[g].push(block)
  }

  return (
    <aside className="w-56 bg-slate-900 border-r border-slate-700 flex flex-col overflow-y-auto shrink-0">
      <div className="px-4 py-3 border-b border-slate-700">
        <a
          href="https://topcptoolkit.docs.cern.ch/"
          target="_blank"
          rel="noreferrer"
          className="text-sm font-bold text-slate-200 hover:text-blue-300 transition-colors leading-tight block"
        >
          TopCPToolkit
        </a>
        <p className="text-xs text-slate-500 mt-0.5">Config Builder</p>
      </div>

      <nav className="flex-1 py-2">
        {Object.entries(groups).map(([groupName, blocks]) => (
          <div key={groupName} className="mb-3">
            <p className="px-4 py-1 text-xs uppercase tracking-wider text-slate-500 font-semibold">
              {groupName}
            </p>
            {blocks.map(block => {
              const enabled = config[block.name]?.enabled ?? false
              const isSelected = selected === block.name
              return (
                <div
                  key={block.name}
                  className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-600/20 text-blue-300 border-r-2 border-blue-400'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggle(block.name) }}
                    className={`relative inline-flex h-4 w-7 rounded-full transition-colors shrink-0 ${
                      enabled ? 'bg-blue-500' : 'bg-slate-600'
                    }`}
                    title={enabled ? 'Disable block' : 'Enable block'}
                  >
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                      enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`} />
                  </button>

                  <span
                    onClick={() => onSelect(block.name)}
                    className="text-sm leading-none flex-1 truncate"
                  >
                    {block.label}
                  </span>

                  {block.repeatable && (
                    <span className="text-xs text-slate-600" title="Repeatable (list)">[]</span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </nav>
    </aside>
  )
}
