import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar.jsx'
import BlockPanel from './components/BlockPanel.jsx'
import YamlPreview from './components/YamlPreview.jsx'
import { useConfig } from './hooks/useConfig.js'
import { buildYamlObject } from './utils/yamlSerializer.js'

const API = import.meta.env.VITE_API_URL || ''

export default function App() {
  const [schema, setSchema] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportPath, setExportPath] = useState('/tmp/analysis_config.yaml')
  const [exportMsg, setExportMsg] = useState(null)
  const [athena, setAthena] = useState(null)

  const {
    config, init,
    toggleBlock, setOption, addInstance, removeInstance,
    toggleSubBlock, setSubOption, addSubInstance, removeSubInstance,
  } = useConfig()

  // ── Fetch schema from backend ──────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/schema`).then(r => r.json()),
      fetch(`${API}/api/health`).then(r => r.json()),
    ])
      .then(([schemaData, health]) => {
        setSchema(schemaData)
        setAthena(health.athena)
        init(schemaData)
        setSelected(schemaData[0]?.name ?? null)
        setLoading(false)
      })
      .catch(err => {
        setError(`Cannot reach backend: ${err.message}`)
        setLoading(false)
      })
  }, [])

  // ── Export YAML ────────────────────────────────────────────────────────────
  async function handleExport() {
    const yamlObj = buildYamlObject(config, schema)
    try {
      const res = await fetch(`${API}/api/export-yaml`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: yamlObj, filepath: exportPath }),
      })
      const data = await res.json()
      setExportMsg(data.success ? `Saved to ${data.filepath}` : 'Export failed')
    } catch {
      setExportMsg('Export failed — backend unreachable')
    }
    setTimeout(() => setExportMsg(null), 4000)
  }

  // ── Selected block ─────────────────────────────────────────────────────────
  const selectedDef = schema.find(b => b.name === selected)
  const selectedState = config[selected]

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">
      Loading schema…
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-center">
        <p className="text-red-400 font-semibold mb-2">{error}</p>
        <p className="text-slate-500 text-sm">Make sure the Flask backend is running on port 5000.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top bar */}
      <header className="h-10 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-4 shrink-0">
        <span className="text-sm font-bold text-blue-400">TCT Config GUI</span>
        {athena === false && (
          <span className="text-xs bg-yellow-800/50 text-yellow-300 px-2 py-0.5 rounded">
            ⚠ Athena not available — options may be empty
          </span>
        )}
        {athena === true && (
          <span className="text-xs bg-green-800/50 text-green-300 px-2 py-0.5 rounded">
            ✓ Athena environment loaded
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-500">Export path:</span>
          <input
            type="text"
            value={exportPath}
            onChange={e => setExportPath(e.target.value)}
            className="text-xs font-mono bg-slate-700 border border-slate-600 rounded px-2 py-0.5 w-72 text-slate-200 focus:outline-none focus:border-blue-400"
          />
          {exportMsg && (
            <span className="text-xs text-green-400">{exportMsg}</span>
          )}
        </div>
      </header>

      {/* Main layout: sidebar | editing panel | yaml preview */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          schema={schema}
          config={config}
          selected={selected}
          onSelect={setSelected}
          onToggle={toggleBlock}
        />

        {/* Centre panel */}
        <main className="flex-1 flex flex-col overflow-hidden bg-slate-850">
          {selectedDef ? (
            <>
              {/* Panel header */}
              <div className="px-5 py-3 border-b border-slate-700 bg-slate-800 shrink-0">
                <h2 className="font-bold text-slate-100">{selectedDef.label}</h2>
                <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedDef.class_path}</p>
              </div>

              <BlockPanel
                blockDef={selectedDef}
                blockState={selectedState}
                onSetOption={(instId, key, val) => setOption(selectedDef.name, instId, key, val)}
                onAddInstance={() => addInstance(selectedDef.name, selectedDef)}
                onRemoveInstance={(instId) => removeInstance(selectedDef.name, instId)}
                onToggleSubBlock={(instId, subName) => toggleSubBlock(selectedDef.name, instId, subName)}
                onSetSubOption={(instId, subName, subInstId, key, val) =>
                  setSubOption(selectedDef.name, instId, subName, subInstId, key, val)}
                onAddSubInstance={(instId, subName) =>
                  addSubInstance(selectedDef.name, instId, subName)}
                onRemoveSubInstance={(instId, subName, subInstId) =>
                  removeSubInstance(selectedDef.name, instId, subName, subInstId)}
              />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Select a block from the sidebar.
            </div>
          )}
        </main>

        <YamlPreview config={config} schema={schema} onExport={handleExport} />
      </div>
    </div>
  )
}
