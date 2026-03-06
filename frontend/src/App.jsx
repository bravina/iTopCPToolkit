import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar.jsx'
import BlockPanel from './components/BlockPanel.jsx'
import YamlPreview from './components/YamlPreview.jsx'
import ResizablePanels from './components/ResizablePanels.jsx'
import MobileLayout from './components/MobileLayout.jsx'
import { useConfig } from './hooks/useConfig.js'
import { buildYamlObject, toYamlString } from './utils/yamlSerializer.js'

const API = import.meta.env.VITE_API_URL || ''

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = e => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isMobile
}

export default function App() {
  const [schema, setSchema] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportMsg, setExportMsg] = useState(null)
  const [appVersion, setAppVersion] = useState(null)
  const [abVersion, setAbVersion] = useState(null)
  const [tctVersion, setTctVersion] = useState(undefined)
  const [athena, setAthena] = useState(null)
  const isMobile = useIsMobile()

  const {
    config, init,
    toggleBlock, setOption, addInstance, removeInstance,
    toggleSubBlock, setSubOption, addSubInstance, removeSubInstance,
  } = useConfig()

  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/schema`).then(r => r.json()),
      fetch(`${API}/api/health`).then(r => r.json()),
    ])
      .then(([schemaData, health]) => {
        setSchema(schemaData)
        setAthena(health.athena)
        setAppVersion(health.app_version)
        setAbVersion(health.ab_version)
        setTctVersion(health.tct_version ?? null)
        init(schemaData)
        setSelected(schemaData[0]?.name ?? null)
        setLoading(false)
      })
      .catch(err => {
        setError(`Cannot reach backend: ${err.message}`)
        setLoading(false)
      })
  }, [])

  async function handleExport(filename) {
    try {
      const yamlText = toYamlString(config, schema)
      const blob = new Blob([yamlText], { type: 'application/x-yaml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setExportMsg(`Downloaded ${filename}`)
    } catch {
      setExportMsg('Export failed')
    }
    setTimeout(() => setExportMsg(null), 4000)
  }

  const selectedDef = schema.find(b => b.name === selected)
  const selectedState = config[selected]

  const docsUrl = tctVersion === undefined || tctVersion === null
    ? 'https://topcptoolkit.docs.cern.ch/'
    : tctVersion === 'latest'
      ? 'https://topcptoolkit.docs.cern.ch/latest/'
      : `https://topcptoolkit.docs.cern.ch/${tctVersion}/`

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

  // ── Shared panel content ───────────────────────────────────────────────────

  const sidebarPanel = (
    <Sidebar
      schema={schema}
      config={config}
      selected={selected}
      onSelect={setSelected}
      onToggle={toggleBlock}
      docsUrl={docsUrl}
    />
  )

  const editorPanel = (
    <main className="flex flex-col overflow-hidden h-full bg-slate-900">
      {selectedDef ? (
        <>
          <div className="px-5 py-3 border-b border-slate-700 bg-slate-800 shrink-0">
            <h2 className="font-bold text-slate-100">{selectedDef.label}</h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">{selectedDef.class_path}</p>
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
  )

  const previewPanel = (
    <YamlPreview config={config} schema={schema} onExport={handleExport} />
  )

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
      {/* Top bar */}
      <header className="h-10 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-2 shrink-0 overflow-x-auto">
        <span className="text-sm font-bold text-blue-400 shrink-0">
          iTopCPToolkit{appVersion ? ` v${appVersion}` : ''}
        </span>

        {athena === false && (
          <span className="text-xs bg-yellow-800/50 text-yellow-300 px-2 py-0.5 rounded shrink-0">
            <span className="hidden sm:inline">⚠ Athena not available — options may be empty</span>
            <span className="sm:hidden">⚠ No Athena</span>
          </span>
        )}
        {athena === true && abVersion && (
          <span className="text-xs bg-green-800/50 text-green-300 px-2 py-0.5 rounded shrink-0">
            <span className="hidden sm:inline">✓ AnalysisBase {abVersion}</span>
            <span className="sm:hidden">✓ AB {abVersion}</span>
          </span>
        )}
        {athena === true && !abVersion && (
          <span className="text-xs bg-green-800/50 text-green-300 px-2 py-0.5 rounded shrink-0">
            <span className="hidden sm:inline">✓ Athena environment loaded</span>
            <span className="sm:hidden">✓ Athena</span>
          </span>
        )}

        {tctVersion !== undefined && (
          tctVersion
            ? <span className="text-xs bg-green-800/50 text-green-300 px-2 py-0.5 rounded shrink-0">
                <span className="hidden sm:inline">✓ TopCPToolkit {tctVersion}</span>
                <span className="sm:hidden">✓ TCT {tctVersion}</span>
              </span>
            : <span className="text-xs bg-red-800/50 text-red-300 px-2 py-0.5 rounded shrink-0">
                <span className="hidden sm:inline">✗ No TopCPToolkit built</span>
                <span className="sm:hidden">✗ No TCT</span>
              </span>
        )}

        <a href={docsUrl} target="_blank" rel="noreferrer"
          className="text-xs bg-blue-800/50 text-blue-300 hover:bg-blue-700/50 px-2 py-0.5 rounded transition-colors shrink-0">
          <span className="hidden sm:inline">📖 TopCPToolkit docs</span>
          <span className="sm:hidden">📖 Docs</span>
        </a>

        {exportMsg && (
          <span className="text-xs text-green-400 shrink-0">{exportMsg}</span>
        )}
      </header>

      {/* Main layout: responsive */}
      {isMobile ? (
        <MobileLayout
          sidebar={sidebarPanel}
          editor={editorPanel}
          preview={previewPanel}
        />
      ) : (
        <ResizablePanels initialSizes={[18, 52, 30]}>
          {sidebarPanel}
          {editorPanel}
          {previewPanel}
        </ResizablePanels>
      )}
    </div>
  )
}
