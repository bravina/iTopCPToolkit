import { useState } from 'react'
import AnnotatedYamlView from './AnnotatedYamlView.jsx'
import YamlLoader from './YamlLoader.jsx'
import { computeDiff } from '../utils/yamlLineBuilder.js'

/**
 * Side-by-side diff of two YAML configs.
 * ConfigA is the "base", configB is the "new" one.
 * Lines in the diff map are colored accordingly in each view.
 */
export default function DiffView({ configA, schema, onClose }) {
  const [configB, setConfigB] = useState(null)

  if (!configB) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-200">Diff Mode</span>
          <span className="text-xs text-slate-400">Load a second config to compare against the current one</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-700"
          >
            ✕ Cancel diff
          </button>
        </div>
        <YamlLoader onLoad={setConfigB} label="Load Config B (comparison target)" />
      </div>
    )
  }

  const diff = computeDiff(configA, configB)

  // Build per-side diff maps: A shows removed+changed, B shows added+changed
  const diffMapA = {}
  const diffMapB = {}
  for (const [path, d] of Object.entries(diff)) {
    if (d.status === 'removed') diffMapA[path] = d
    else if (d.status === 'added') diffMapB[path] = d
    else {
      diffMapA[path] = d
      diffMapB[path] = d
    }
  }

  const stats = Object.values(diff).reduce(
    (acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc },
    {}
  )

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Diff toolbar */}
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-4 text-xs shrink-0">
        <span className="font-semibold text-slate-200">Diff</span>

        <span className="text-slate-500">A (base)</span>
        <span className="text-slate-600">vs</span>
        <span className="text-slate-500">B (new)</span>

        <div className="flex gap-3 ml-2">
          {stats.added   && <span className="text-emerald-400">+{stats.added} added</span>}
          {stats.removed && <span className="text-red-400">−{stats.removed} removed</span>}
          {stats.changed && <span className="text-yellow-400">~{stats.changed} changed</span>}
          {!Object.keys(diff).length && <span className="text-slate-400 italic">Configs are identical</span>}
        </div>

        <button
          type="button"
          onClick={() => setConfigB(null)}
          className="ml-auto text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-700"
        >
          Load different B
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 px-2 py-1 rounded hover:bg-slate-700"
        >
          ✕ Exit diff
        </button>
      </div>

      {/* Side-by-side */}
      <div className="flex flex-1 overflow-hidden divide-x divide-slate-700">
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <div className="px-4 py-1 bg-slate-800/60 border-b border-slate-700 text-xs font-semibold text-slate-400 shrink-0">
            A — Base
          </div>
          <AnnotatedYamlView configObj={configA} schema={schema} diffMap={diffMapA} />
        </div>
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          <div className="px-4 py-1 bg-slate-800/60 border-b border-slate-700 text-xs font-semibold text-slate-400 shrink-0">
            B — Comparison
          </div>
          <AnnotatedYamlView configObj={configB} schema={schema} diffMap={diffMapB} />
        </div>
      </div>
    </div>
  )
}
