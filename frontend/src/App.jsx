import { useState, useEffect, useMemo } from 'react'
import Sidebar from './components/Sidebar.jsx'
import BlockPanel from './components/BlockPanel.jsx'
import YamlPreview from './components/YamlPreview.jsx'
import ResizablePanels from './components/ResizablePanels.jsx'
import MobileLayout from './components/MobileLayout.jsx'
import SplashScreen from './components/SplashScreen.jsx'
import ModeSelector from './components/ModeSelector.jsx'
import ConfigReader from './components/ConfigReader.jsx'
import IntNoteWriter from './components/IntNoteWriter.jsx'
import SearchOverlay from './components/SearchOverlay.jsx'
import { useConfig } from './hooks/useConfig.js'
import { toYamlString } from './utils/yamlSerializer.js'
import { yamlToConfig } from './utils/yamlToConfig.js'
import { buildRegistryFromState } from './utils/collectionRegistry.js'
import { checkDepsFromState } from './utils/dependencyChecker.js'
import { RegistryProvider } from './contexts/RegistryContext.js'

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

// Brand name with consistent blue/white coloring
export function BrandName({ className = '' }) {
  return (
    <span className={className}>
      <span className="text-blue-400">i</span>
      <span className="text-slate-100">Top</span>
      <span className="text-blue-400">CP</span>
      <span className="text-slate-100">Toolkit</span>
    </span>
  )
}

export default function App() {
  const [showSplash, setShowSplash] = useState(true)
  const [mode, setMode] = useState(null)
  const [schema, setSchema] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [exportMsg, setExportMsg] = useState(null)
  const [appVersion, setAppVersion] = useState(null)
  const [abVersion, setAbVersion] = useState(null)
  const [tctVersion, setTctVersion] = useState(undefined)
  const [pdflatex, setPdflatex] = useState(false)
  const [athena, setAthena] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const isMobile = useIsMobile()

  const {
    config, init, loadFromYaml,
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
        setPdflatex(health.pdflatex ?? false)
        init(schemaData)
        setSelected(schemaData[0]?.name ?? null)
        setLoading(false)
      })
      .catch(err => {
        setError(`Cannot reach backend: ${err.message}`)
        setLoading(false)
      })
  }, [])

  // Registry derived from builder config state
  const registry = useMemo(
    () => buildRegistryFromState(config, schema),
    [config, schema]
  )

  // Dependency issues for builder mode
  const depIssues = useMemo(
    () => checkDepsFromState(config, registry, schema),
    [config, registry, schema]
  )

  // Cmd+F / Ctrl+F global shortcut — opens search, prevents browser find
  useEffect(() => {
    function handler(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        if (mode) setSearchOpen(o => !o)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mode])

  function handleSearchNavigate({ blockName, optionName }) {
    if (mode === 'builder') {
      setSelected(blockName)
      if (config[blockName] && !config[blockName].enabled) {
        toggleBlock(blockName)
      }
      if (optionName) {
        // Use a longer timeout to ensure the panel has rendered after state changes
        setTimeout(() => {
          const cleanOpt = optionName.includes('.') ? optionName.split('.')[1] : optionName
          const el = document.querySelector(`[data-option="${blockName}:${cleanOpt}"]`)
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            el.classList.add('search-highlight')
            setTimeout(() => el.classList.remove('search-highlight'), 2000)
          }
        }, 150)
      }
    }
  }

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

  function handleOpenInBuilder(configObj) {
    const builderState = yamlToConfig(configObj, schema)
    loadFromYaml(builderState)
    setMode('builder')
    setSelected(Object.keys(configObj)[0] ?? schema[0]?.name ?? null)
  }

  // Pill click: toggle; if turning ON, also navigate to that block
  function handleSidebarToggle(name) {
    const wasEnabled = config[name]?.enabled
    toggleBlock(name)
    if (!wasEnabled) setSelected(name)
  }

  // Name click: always navigate; if block was OFF, also enable it
  function handleSidebarSelect(name) {
    if (!config[name]?.enabled) toggleBlock(name)
    setSelected(name)
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

  const sidebarPanel = (
    <Sidebar
      schema={schema}
      config={config}
      selected={selected}
      onSelect={handleSidebarSelect}
      onToggle={handleSidebarToggle}
      onAddInstance={addInstance}
      docsUrl={docsUrl}
      depIssues={depIssues}
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
            depIssues={depIssues.filter(i => i.path.startsWith(selectedDef.name))}
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
    <RegistryProvider value={registry}>
      {searchOpen && (
        <SearchOverlay
          schema={schema}
          mode={mode}
          onNavigate={handleSearchNavigate}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {showSplash && (
        <SplashScreen
          onDone={() => setShowSplash(false)}
          version={appVersion}
        />
      )}

      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
        <header className="h-10 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-2 shrink-0 overflow-x-auto">
          {/* Brand name with blue/white color scheme */}
          <span className="text-sm font-bold shrink-0">
            <span className="text-blue-400">i</span>
            <span className="text-slate-100">Top</span>
            <span className="text-blue-400">CP</span>
            <span className="text-slate-100">Toolkit</span>
            {appVersion && <span className="text-slate-500 font-normal"> v{appVersion}</span>}
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

          {exportMsg && <span className="text-xs text-green-400 shrink-0">{exportMsg}</span>}

          {/* Search button — shows Cmd+F / Ctrl+F shortcut */}
          {mode && mode !== 'intnote' && (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="text-xs px-2 py-0.5 rounded bg-slate-700/50 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-colors shrink-0 flex items-center gap-1.5"
              title="Search blocks and options (⌘F / Ctrl+F)"
            >
              <span>⌕</span>
              <span className="hidden md:inline">Search</span>
              <kbd className="hidden md:inline text-slate-600 font-mono text-xs ml-1">⌘F</kbd>
            </button>
          )}

          {/* Mode switcher */}
          {mode && (
            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setMode('builder')}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${mode === 'builder' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
              >
                ⚙ Builder
              </button>
              <button
                type="button"
                onClick={() => setMode('reader')}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${mode === 'reader' ? 'bg-emerald-700 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
              >
                ◉ Reader
              </button>
              <button
                type="button"
                onClick={() => setMode('intnote')}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${mode === 'intnote' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}
              >
                ✍ INTnote
              </button>
            </div>
          )}
        </header>

        {!showSplash && mode === null && (
          <ModeSelector onSelect={setMode} appVersion={appVersion} tctVersion={tctVersion} pdflatex={pdflatex} />
        )}

        {mode === 'builder' && (
          isMobile ? (
            <MobileLayout sidebar={sidebarPanel} editor={editorPanel} preview={previewPanel} />
          ) : (
            <ResizablePanels initialSizes={[18, 52, 30]}>
              {sidebarPanel}
              {editorPanel}
              {previewPanel}
            </ResizablePanels>
          )
        )}

        {mode === 'reader' && (
          <div className="flex flex-1 overflow-hidden">
            <ConfigReader
              schema={schema}
              onOpenInBuilder={handleOpenInBuilder}
              onOpenSearch={() => setSearchOpen(true)}
            />
          </div>
        )}

        {mode === 'intnote' && (
          <div className="flex flex-1 overflow-hidden">
            <IntNoteWriter tctVersion={tctVersion} pdflatex={pdflatex} />
          </div>
        )}
      </div>
    </RegistryProvider>
  )
}
