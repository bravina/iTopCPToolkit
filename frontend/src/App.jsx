import { useState, useEffect, useMemo, useCallback } from 'react'
import yaml from 'js-yaml'
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
import { blocksForConfig, customEntryFromCatalogue, superBlockList } from './utils/schema.js'
import { buildRegistryFromState } from './utils/collectionRegistry.js'
import { checkDepsFromState } from './utils/dependencyChecker.js'
import { RegistryProvider } from './contexts/RegistryContext.js'
import { fetchSchema, introspectEntry, fetchExample } from './api.js'
import { loadAutosave, saveAutosave, clearAutosave, mergeRestored } from './utils/autosave.js'

const SPLASH_SEEN_KEY = 'itopcptoolkit.splashSeen'

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

function splashSeen() {
  try { return sessionStorage.getItem(SPLASH_SEEN_KEY) === '1' } catch { return false }
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

function isTypingTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export default function App() {
  const [showSplash, setShowSplash] = useState(() => !splashSeen())
  const [mode, setMode] = useState(null)
  const [schema, setSchema] = useState(null)
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [showExpert, setShowExpert] = useState(false)
  const isMobile = useIsMobile()

  const {
    config, init, load,
    toggleBlock, setBlockEnabled, setOption, addInstance, removeInstance,
    toggleSubBlock, setSubOption, addSubInstance, removeSubInstance,
    addCustomBlock, removeCustomBlock, removeUnknownBlock,
    undo, redo, canUndo, canRedo,
  } = useConfig()

  const flash = useCallback((msg) => setNotice(msg), [])

  // ── Boot: schema + autosave restore ────────────────────────────────────────
  useEffect(() => {
    fetchSchema()
      .then(doc => {
        setSchema(doc)
        const saved = loadAutosave()
        if (saved?.config) {
          load(mergeRestored(saved.config, doc))
          setSelected(saved.selected ?? doc.blocks[0]?.name ?? null)
          flash('Restored your previous session')
        } else {
          init(doc.blocks)
          setSelected(doc.blocks[0]?.name ?? null)
        }
        setLoading(false)
      })
      .catch(err => {
        // err.status is set by api.js for HTTP errors: the message is the
        // backend's own (e.g. Athena missing).  Without it, the fetch failed.
        setError(err.status
          ? { title: 'Backend not ready', detail: err.message }
          : { title: `Cannot reach backend: ${err.message}`,
              detail: 'Make sure the Flask backend is running on port 5000.' })
        setLoading(false)
      })
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ───────────────────────────────────────────────────────────
  const blocks = useMemo(() => (schema ? blocksForConfig(schema, config) : []), [schema, config.addConfigBlocks])  // eslint-disable-line react-hooks/exhaustive-deps
  const registry = useMemo(() => buildRegistryFromState(config, blocks), [config, blocks])
  const depIssues = useMemo(() => checkDepsFromState(config, registry, blocks), [config, registry, blocks])
  const versions = schema?.versions ?? {}

  // ── Autosave (debounced) ───────────────────────────────────────────────────
  useEffect(() => {
    if (!schema) return
    const t = setTimeout(() => saveAutosave({ config, selected }), 500)
    return () => clearTimeout(t)
  }, [config, selected, schema])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  // ── Keyboard shortcuts: search, undo, redo ─────────────────────────────────
  useEffect(() => {
    function handler(e) {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      if (e.key === 'f') {
        e.preventDefault()
        if (mode) setSearchOpen(o => !o)
        return
      }
      if (mode !== 'builder' || isTypingTarget(document.activeElement)) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [mode, undo, redo])

  // ── Handlers ───────────────────────────────────────────────────────────────
  function handleSearchNavigate({ blockName, optionName }) {
    if (mode !== 'builder') return
    setSelected(blockName)
    if (config.blocks[blockName] && !config.blocks[blockName].enabled) setBlockEnabled(blockName, true)
    if (optionName) {
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

  function handleExport(filename) {
    try {
      const blob = new Blob([toYamlString(config, schema)], { type: 'application/x-yaml' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      flash(`Downloaded ${filename}`)
    } catch {
      flash('Export failed')
    }
  }

  async function handleOpenInBuilder(configObj) {
    try {
      const state = await yamlToConfig(configObj, schema, entry => introspectEntry(entry))
      load(state)
      setMode('builder')
      const first = Object.keys(configObj).find(k => state.blocks[k]) ?? schema.blocks[0]?.name ?? null
      setSelected(first)
      const opaque = state.addConfigBlocks.filter(e => e.block?.opaque).map(e => e.algName)
      if (opaque.length) flash(`Custom block(s) could not be introspected: ${opaque.join(', ')}`)
    } catch (err) {
      flash(`Cannot open in builder: ${err.message}`)
    }
  }

  async function handleLoadExample(path) {
    try {
      const parsed = yaml.load(await fetchExample(path))
      if (!parsed || typeof parsed !== 'object') throw new Error('file is not a YAML mapping')
      await handleOpenInBuilder(parsed)
      flash(`Loaded ${path}`)
    } catch (err) {
      flash(`Cannot load example: ${err.message}`)
    }
  }

  function handleNewConfig() {
    init(schema.blocks)
    clearAutosave()
    setSelected(schema.blocks[0]?.name ?? null)
    flash('Started a new configuration')
  }

  function handleAddCatalogueEntry(catalogueEntry) {
    const entry = customEntryFromCatalogue(catalogueEntry)
    addCustomBlock(entry)
    const parents = superBlockList(entry.superBlocks)
    if (parents.length) flash(`'${entry.algName}' is now available as a sub-block of ${parents.join(', ')}`)
    else setSelected(entry.algName)
  }

  async function handleAddCustomEntry(form) {
    const block = await introspectEntry(form)   // throws with the backend's message
    handleAddCatalogueEntry({ ...form, block })
  }

  function handleRemoveCustom(id) {
    const entry = config.addConfigBlocks.find(e => e.id === id)
    removeCustomBlock(id)
    if (entry && selected === entry.algName) setSelected(schema.blocks[0]?.name ?? null)
  }

  // Pill click: toggle; if turning ON, also navigate to that block
  function handleSidebarToggle(name) {
    const wasEnabled = config.blocks[name]?.enabled
    toggleBlock(name)
    if (!wasEnabled) setSelected(name)
  }

  // Name click: always navigate; if block was OFF, also enable it
  function handleSidebarSelect(name) {
    if (!config.blocks[name]?.enabled) setBlockEnabled(name, true)
    setSelected(name)
  }

  const selectedDef = blocks.find(b => b.name === selected)
  const selectedState = config.blocks[selected]
  const enabledBlockNames = useMemo(
    () => new Set(Object.entries(config.blocks).filter(([, s]) => s?.enabled).map(([n]) => n)),
    [config.blocks])

  const docsUrl = !versions.tct
    ? 'https://topcptoolkit.docs.cern.ch/'
    : versions.tct === 'latest'
      ? 'https://topcptoolkit.docs.cern.ch/latest/'
      : `https://topcptoolkit.docs.cern.ch/${versions.tct}/`

  if (loading) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">
      Loading schema…
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="text-center max-w-xl">
        <p className="text-red-400 font-semibold mb-2">{error.title}</p>
        {error.detail && <p className="text-slate-500 text-sm">{error.detail}</p>}
      </div>
    </div>
  )

  const sidebarPanel = (
    <Sidebar
      blocks={blocks}
      categories={schema.categories}
      config={config}
      selected={selected}
      onSelect={handleSidebarSelect}
      onToggle={handleSidebarToggle}
      onAddInstance={addInstance}
      docsUrl={docsUrl}
      depIssues={depIssues}
      catalogue={schema.catalogue}
      onAddCatalogueEntry={handleAddCatalogueEntry}
      onAddCustomEntry={handleAddCustomEntry}
      onRemoveCustom={handleRemoveCustom}
      onRemoveUnknown={removeUnknownBlock}
      examples={schema.examples}
      onLoadExample={handleLoadExample}
      onNewConfig={handleNewConfig}
      canIntrospect={versions.athena === true}
      catalogueHint={catalogueHint(schema)}
    />
  )

  const editorPanel = (
    <main className="flex flex-col overflow-hidden h-full bg-slate-900">
      {selectedDef ? (
        <BlockPanel
          blockDef={selectedDef}
          blockState={selectedState}
          depIssues={depIssues.filter(i => i.path.startsWith(`${selectedDef.name}[`))}
          showExpert={showExpert}
          onToggleExpert={() => setShowExpert(v => !v)}
          keywords={schema.keywords}
          enabledBlockNames={enabledBlockNames}
          onEnable={() => setBlockEnabled(selectedDef.name, true)}
          onSetOption={(instId, key, val) => setOption(selectedDef.name, instId, key, val)}
          onAddInstance={() => addInstance(selectedDef.name, selectedDef)}
          onRemoveInstance={(instId) => removeInstance(selectedDef.name, instId)}
          onToggleSubBlock={(instId, subName) => toggleSubBlock(selectedDef.name, instId, subName)}
          onSetSubOption={(instId, subName, subInstId, key, val) =>
            setSubOption(selectedDef.name, instId, subName, subInstId, key, val)}
          onAddSubInstance={(instId, subName) => addSubInstance(selectedDef.name, instId, subName)}
          onRemoveSubInstance={(instId, subName, subInstId) =>
            removeSubInstance(selectedDef.name, instId, subName, subInstId)}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          Select a block from the sidebar.
        </div>
      )}
    </main>
  )

  const previewPanel = (
    <YamlPreview config={config} schema={schema} onExport={handleExport}
      selected={selected} onSelectBlock={setSelected} />
  )

  return (
    <RegistryProvider value={registry}>
      {searchOpen && (
        <SearchOverlay
          blocks={blocks}
          mode={mode}
          onNavigate={handleSearchNavigate}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {showSplash && (
        <SplashScreen
          onDone={() => { setShowSplash(false); try { sessionStorage.setItem(SPLASH_SEEN_KEY, '1') } catch { /* ignore */ } }}
          version={versions.app}
        />
      )}

      <div className="app-shell bg-slate-900 text-slate-100 flex flex-col">
        <header className="h-10 bg-slate-800 border-b border-slate-700 flex items-center px-4 gap-2 shrink-0 overflow-x-auto">
          <span className="text-sm font-bold shrink-0">
            <BrandName />
            {versions.app && <span className="text-slate-500 font-normal"> v{versions.app}</span>}
          </span>

          {versions.athena === true && versions.ab && (
            <Badge tone="green" full={`✓ AnalysisBase ${versions.ab}`} short={`✓ AB ${versions.ab}`} />
          )}
          {versions.athena === true && !versions.ab && (
            <Badge tone="green" full="✓ Athena environment loaded" short="✓ Athena" />
          )}
          {versions.tct
            ? <Badge tone="green" full={`✓ TopCPToolkit ${versions.tct}`} short={`✓ TCT ${versions.tct}`} />
            : <Badge tone="red" full="✗ No TopCPToolkit built" short="✗ No TCT" />}

          <a href={docsUrl} target="_blank" rel="noreferrer"
            className="text-xs bg-blue-800/50 text-blue-300 hover:bg-blue-700/50 px-2 py-0.5 rounded transition-colors shrink-0">
            <span className="hidden sm:inline">📖 TopCPToolkit docs</span>
            <span className="sm:hidden">📖 Docs</span>
          </a>

          {notice && <span className="text-xs text-green-400 shrink-0">{notice}</span>}

          {mode === 'builder' && (
            <div className="flex items-center gap-1 shrink-0">
              <HeaderBtn onClick={undo} disabled={!canUndo} title="Undo (⌘Z / Ctrl+Z)">↶</HeaderBtn>
              <HeaderBtn onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z / Ctrl+Y)">↷</HeaderBtn>
              <HeaderBtn onClick={() => setShowExpert(v => !v)} active={showExpert}
                title="Show expert-only options (requires CommonServices.enableExpertMode at runtime)">
                🧪 <span className="hidden md:inline">Expert</span>
              </HeaderBtn>
            </div>
          )}

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

          {mode && (
            <div className="ml-auto flex items-center gap-1 shrink-0">
              <ModeBtn active={mode === 'builder'} color="bg-blue-600" onClick={() => setMode('builder')}>⚙ Builder</ModeBtn>
              <ModeBtn active={mode === 'reader'} color="bg-emerald-700" onClick={() => setMode('reader')}>◉ Reader</ModeBtn>
              <ModeBtn active={mode === 'intnote'} color="bg-amber-600" onClick={() => setMode('intnote')}>✍ INTnote</ModeBtn>
            </div>
          )}
        </header>

        {!showSplash && mode === null && (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ModeSelector onSelect={setMode} appVersion={versions.app} tctVersion={versions.tct} pdflatex={versions.pdflatex} />
          </div>
        )}

        {mode === 'builder' && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {isMobile ? (
              <MobileLayout sidebar={sidebarPanel} editor={editorPanel} preview={previewPanel} />
            ) : (
              <ResizablePanels initialSizes={[20, 50, 30]}>
                {sidebarPanel}
                {editorPanel}
                {previewPanel}
              </ResizablePanels>
            )}
          </div>
        )}

        {mode === 'reader' && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <ConfigReader
              schema={schema}
              onOpenInBuilder={handleOpenInBuilder}
              onOpenSearch={() => setSearchOpen(true)}
            />
          </div>
        )}

        {mode === 'intnote' && (
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <IntNoteWriter tctVersion={versions.tct} pdflatex={versions.pdflatex} />
          </div>
        )}
      </div>
    </RegistryProvider>
  )
}

/** Why the TopCPToolkit catalogue is empty, as precisely as the backend can tell. */
function catalogueHint(schema) {
  const v = schema.versions || {}
  if (!v.tct) return 'No TopCPToolkit in this image — build it with TCT_VERSION to preload its blocks.'
  if (!schema.tctDataDir) return `TopCPToolkit ${v.tct} is built, but its reference configs were not found (see the backend log: data dir missing or a dangling symlink).`
  return `TopCPToolkit ${v.tct} is built, but none of its reference configs declares AddConfigBlocks.`
}

function Badge({ tone, full, short }) {
  const cls = {
    green: 'bg-green-800/50 text-green-300',
    yellow: 'bg-yellow-800/50 text-yellow-300',
    red: 'bg-red-800/50 text-red-300',
  }[tone]
  return (
    <span className={`text-xs ${cls} px-2 py-0.5 rounded shrink-0`}>
      <span className="hidden sm:inline">{full}</span>
      <span className="sm:hidden">{short}</span>
    </span>
  )
}

function HeaderBtn({ children, onClick, disabled, active, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className={`text-xs px-2 py-0.5 rounded transition-colors disabled:opacity-30 ${
        active ? 'bg-purple-700/60 text-purple-100' : 'bg-slate-700/50 hover:bg-slate-600 text-slate-300'}`}>
      {children}
    </button>
  )
}

function ModeBtn({ children, active, color, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded transition-colors ${
        active ? `${color} text-white` : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'}`}>
      {children}
    </button>
  )
}
