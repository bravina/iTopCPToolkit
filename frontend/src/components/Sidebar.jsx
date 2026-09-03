import { useState } from 'react'
import { categorize, superBlockList, TCT_CATEGORY } from '../utils/schema.js'

/**
 * Left sidebar of the Builder: block toggles grouped by category, the
 * TopCPToolkit catalogue (custom blocks declared via AddConfigBlocks), a
 * manual "add custom block" form, templates and unknown-block housekeeping.
 */
export default function Sidebar({
  blocks, categories, config, selected, onSelect, onToggle, onAddInstance, docsUrl, depIssues,
  catalogue = [], onAddCatalogueEntry, onAddCustomEntry, onRemoveCustom, onRemoveUnknown,
  examples = [], onLoadExample, onNewConfig, canIntrospect,
}) {
  const depCounts = {}
  for (const issue of depIssues || []) {
    const name = issue.path.split('[')[0]
    depCounts[name] = (depCounts[name] || 0) + 1
  }
  const customByName = Object.fromEntries((config.addConfigBlocks || []).map(e => [e.algName, e]))
  const groups = categorize(blocks, categories)
  const available = catalogue.filter(c => !customByName[c.algName])
  const unknownNames = Object.keys(config.unknown || {})

  return (
    <aside className="h-full bg-slate-900 border-r border-slate-700 flex flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b border-slate-700">
        <a href={docsUrl} target="_blank" rel="noreferrer"
          className="text-sm font-bold text-slate-200 hover:text-blue-300 transition-colors leading-tight block">
          TopCPToolkit
        </a>
        <p className="text-xs text-slate-500 mt-0.5">Config Builder</p>
        <div className="flex items-center gap-1 mt-2">
          <button type="button" onClick={onNewConfig}
            className="text-xs px-2 py-0.5 rounded bg-slate-700/60 hover:bg-slate-600 text-slate-300 transition-colors"
            title="Start from an empty configuration">
            ✦ New
          </button>
          {examples.length > 0 && (
            <select
              value=""
              onChange={e => { if (e.target.value) onLoadExample(e.target.value) }}
              className="flex-1 min-w-0 text-xs bg-slate-700/60 hover:bg-slate-600 text-slate-300 rounded px-1 py-0.5 focus:outline-none"
              title="Start from a TopCPToolkit reference config"
            >
              <option value="">Start from template…</option>
              {examples.map(ex => <option key={ex.path} value={ex.path}>{ex.name}</option>)}
            </select>
          )}
        </div>
      </div>

      <nav className="flex-1 py-2">
        {groups.map(({ category, blocks: list }) => (
          <div key={category} className="mb-3">
            <p className="px-4 py-1 text-xs uppercase tracking-wider text-slate-500 font-semibold">
              {category}
            </p>
            {list.map(block => (
              <BlockRow
                key={block.name}
                block={block}
                state={config.blocks[block.name]}
                isSelected={selected === block.name}
                depCount={depCounts[block.name] || 0}
                customEntry={block.custom ? customByName[block.name] : null}
                onSelect={onSelect}
                onToggle={onToggle}
                onAddInstance={onAddInstance}
                onRemoveCustom={onRemoveCustom}
              />
            ))}
          </div>
        ))}

        {(available.length > 0 || onAddCustomEntry) && (
          <div className="mb-3 border-t border-slate-800 pt-2">
            <p className="px-4 py-1 text-xs uppercase tracking-wider text-slate-500 font-semibold">
              Custom blocks
            </p>
            {available.length === 0 && catalogue.length === 0 && (
              <p className="px-4 py-1 text-xs text-slate-600 italic">
                No TopCPToolkit catalogue — build the image with TCT_VERSION to preload its blocks.
              </p>
            )}
            {available.map(entry => <CatalogueRow key={`${entry.modulePath}.${entry.functionName}.${entry.algName}`} entry={entry} onAdd={onAddCatalogueEntry} />)}
            {onAddCustomEntry && <CustomBlockForm onAdd={onAddCustomEntry} canIntrospect={canIntrospect} />}
          </div>
        )}

        {unknownNames.length > 0 && (
          <div className="mb-3 border-t border-slate-800 pt-2">
            <p className="px-4 py-1 text-xs uppercase tracking-wider text-red-400/80 font-semibold">
              Unknown blocks
            </p>
            <p className="px-4 pb-1 text-xs text-slate-600">Kept verbatim from the loaded file; written back unchanged.</p>
            {unknownNames.map(name => (
              <div key={name} className="flex items-center gap-2 px-4 py-1 text-xs text-red-300">
                <span className="flex-1 truncate font-mono">{name}</span>
                <button type="button" onClick={() => onRemoveUnknown(name)} title="Drop this block"
                  className="text-slate-500 hover:text-red-300">✕</button>
              </div>
            ))}
          </div>
        )}
      </nav>
    </aside>
  )
}

function BlockRow({ block, state, isSelected, depCount, customEntry, onSelect, onToggle, onAddInstance, onRemoveCustom }) {
  const enabled = state?.enabled ?? false
  const instanceCount = state?.instances?.length ?? 1
  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue-600/20 text-blue-300 border-r-2 border-blue-400'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      }`}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle(block.name) }}
        className={`relative inline-flex h-4 w-7 rounded-full transition-colors shrink-0 ${enabled ? 'bg-blue-500' : 'bg-slate-600'}`}
        title={enabled ? 'Disable block' : 'Enable block'}
      >
        <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
          enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
      </button>

      <span onClick={() => onSelect(block.name)} className="text-sm leading-none flex-1 truncate" title={block.factoryName}>
        {block.label}
      </span>

      {block.error && (
        <span className="text-xs text-red-400 shrink-0" title={block.error}>!</span>
      )}
      {depCount > 0 && (
        <span className="text-xs text-orange-400 shrink-0" title={`${depCount} unresolved reference(s)`}>⊘{depCount}</span>
      )}
      {customEntry && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveCustom(customEntry.id) }}
          className="text-xs text-purple-400 hover:text-red-300 shrink-0" title={`Custom block from ${customEntry.modulePath} — click to remove`}>
          ✕
        </button>
      )}

      <span className="flex items-center gap-0.5 shrink-0">
        <span className={`text-xs font-mono ${enabled ? 'text-slate-400' : 'text-slate-600'}`}
          title={enabled ? `${instanceCount} instance${instanceCount !== 1 ? 's' : ''}` : 'Every block may have several instances'}>
          [{enabled ? instanceCount : 0}]
        </span>
        {enabled && (
          <button type="button"
            onClick={(e) => { e.stopPropagation(); onAddInstance(block.name, block) }}
            className="text-xs text-slate-500 hover:text-blue-300 font-mono leading-none transition-colors px-0.5"
            title="Add another instance">
            +
          </button>
        )}
      </span>
    </div>
  )
}

function CatalogueRow({ entry, onAdd }) {
  const parents = superBlockList(entry.superBlocks)
  const broken = !!entry.block?.error
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-slate-400 hover:bg-slate-800">
      <button type="button" disabled={broken} onClick={() => onAdd(entry)}
        className="text-xs text-blue-400 hover:text-blue-200 disabled:opacity-30 font-mono shrink-0"
        title={broken ? entry.block.error : `Add ${entry.algName} (${entry.modulePath}.${entry.functionName})`}>
        +
      </button>
      <span className="text-sm leading-none flex-1 truncate" title={`${entry.modulePath}.${entry.functionName}\nUsed in: ${(entry.usedIn || []).join(', ')}`}>
        {entry.block?.label ?? entry.algName}
      </span>
      {parents.length > 0 && (
        <span className="text-xs text-slate-600 shrink-0" title={`Sub-block of ${parents.join(', ')}`}>↳ {parents.join(', ')}</span>
      )}
      {broken && <span className="text-xs text-red-400 shrink-0" title={entry.block.error}>!</span>}
    </div>
  )
}

function CustomBlockForm({ onAdd, canIntrospect }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ modulePath: '', functionName: '', algName: '', pos: '', superBlocks: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const ready = form.modulePath && form.functionName && form.algName

  async function submit(e) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await onAdd({
        modulePath: form.modulePath.trim(), functionName: form.functionName.trim(), algName: form.algName.trim(),
        pos: form.pos.trim() || null, superBlocks: form.superBlocks.trim() || null,
      })
      setForm({ modulePath: '', functionName: '', algName: '', pos: '', superBlocks: '' })
      setOpen(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-3 py-1">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
        <span>{open ? '▾' : '▸'}</span> Add custom block…
      </button>
      {open && (
        <form onSubmit={submit} className="mt-1 space-y-1">
          {!canIntrospect && (
            <p className="text-xs text-yellow-400">Introspection needs a live Athena backend.</p>
          )}
          {[['modulePath', 'TopCPToolkit.MyConfig'], ['functionName', 'MyConfig'], ['algName', 'MyBlock'],
            ['pos', 'pos (optional, e.g. Output)'], ['superBlocks', 'superBlocks (optional, e.g. Jets)']].map(([k, ph]) => (
            <input key={k} type="text" value={form[k]} onChange={e => set(k, e.target.value)} placeholder={ph}
              className="w-full text-xs font-mono bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-blue-400" />
          ))}
          <button type="submit" disabled={!ready || busy || !canIntrospect}
            className="w-full text-xs py-1 rounded bg-blue-700/60 hover:bg-blue-600 disabled:opacity-40 text-white">
            {busy ? 'Introspecting…' : 'Introspect & add'}
          </button>
          {error && <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">{error}</p>}
        </form>
      )}
    </div>
  )
}

export { TCT_CATEGORY }
