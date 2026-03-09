import { useState, useEffect, useCallback } from 'react'
import AnnotatedYamlView from './AnnotatedYamlView.jsx'
import YamlLoader from './YamlLoader.jsx'
import DiffView from './DiffView.jsx'
import { validateConfig } from '../utils/yamlValidator.js'
import { generateAnnotatedYaml } from '../utils/yamlAnnotator.js'

export default function ConfigReader({ schema, onOpenInBuilder }) {
  const [config, setConfig] = useState(null)
  const [issues, setIssues] = useState([])
  const [isDiff, setIsDiff] = useState(false)
  const [scrollToBlock, setScrollToBlock] = useState(null)
  const [showValidation, setShowValidation] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => {
    if (config && schema.length) {
      setIssues(validateConfig(config, schema))
    }
  }, [config, schema])

  // Reset scroll request after it fires
  useEffect(() => {
    if (scrollToBlock) {
      const t = setTimeout(() => setScrollToBlock(null), 400)
      return () => clearTimeout(t)
    }
  }, [scrollToBlock])

  function handleLoad(parsed) {
    setConfig(parsed)
    setIsDiff(false)
    setScrollToBlock(null)
  }

  function handleExportAnnotated() {
    if (!config) return
    const yamlStr = generateAnnotatedYaml(config, schema)
    const blob = new Blob([yamlStr], { type: 'application/x-yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'annotated_config.yaml'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Not yet loaded: show loader
  if (!config) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold text-emerald-400">◎ Config Reader</span>
        </div>
        <YamlLoader onLoad={handleLoad} />
      </div>
    )
  }

  // Count issues
  const errorCount = issues.filter(i => i.severity === 'error').length
  const warnCount  = issues.filter(i => i.severity === 'warning').length

  // Blocks present in the loaded config
  const presentBlocks = Object.keys(config)
  const schemaMap = Object.fromEntries(schema.map(b => [b.name, b]))
  const blockIssues = {}
  for (const issue of issues) {
    const blockKey = issue.path.split('[')[0].split('.')[0]
    if (!blockIssues[blockKey]) blockIssues[blockKey] = []
    blockIssues[blockKey].push(issue)
  }

  if (isDiff) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar
          config={config}
          errorCount={errorCount}
          warnCount={warnCount}
          isDiff={isDiff}
          showValidation={showValidation}
          sidebarOpen={sidebarOpen}
          onNewFile={() => { setConfig(null); setIsDiff(false) }}
          onDiff={() => setIsDiff(d => !d)}
          onExport={handleExportAnnotated}
          onOpenInBuilder={() => onOpenInBuilder(config)}
          onToggleValidation={() => setShowValidation(v => !v)}
          onToggleSidebar={() => setSidebarOpen(s => !s)}
        />
        <DiffView configA={config} schema={schema} onClose={() => setIsDiff(false)} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar
        config={config}
        errorCount={errorCount}
        warnCount={warnCount}
        isDiff={isDiff}
        showValidation={showValidation}
        sidebarOpen={sidebarOpen}
        onNewFile={() => setConfig(null)}
        onDiff={() => setIsDiff(true)}
        onExport={handleExportAnnotated}
        onOpenInBuilder={() => onOpenInBuilder(config)}
        onToggleValidation={() => setShowValidation(v => !v)}
        onToggleSidebar={() => setSidebarOpen(s => !s)}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: block navigation */}
        {sidebarOpen && (
          <aside className="w-48 shrink-0 bg-slate-900 border-r border-slate-700 overflow-y-auto flex flex-col">
            <div className="px-3 py-2 border-b border-slate-800">
              <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Blocks</p>
            </div>
            <nav className="flex-1 py-1">
              {presentBlocks.map(bk => {
                const def = schemaMap[bk]
                const bi = blockIssues[bk] || []
                const errs = bi.filter(i => i.severity === 'error').length
                const warns = bi.filter(i => i.severity === 'warning').length
                const unknown = !def
                return (
                  <button
                    key={bk}
                    type="button"
                    onClick={() => setScrollToBlock(bk)}
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-slate-800 transition-colors group"
                  >
                    <span className={`text-xs truncate ${unknown ? 'text-red-400' : 'text-slate-300'}`}>
                      {def?.label ?? bk}
                    </span>
                    <span className="flex gap-1 ml-auto shrink-0">
                      {errs  > 0 && <span className="text-red-400 text-xs">✖{errs}</span>}
                      {warns > 0 && <span className="text-yellow-400 text-xs">⚠{warns}</span>}
                    </span>
                  </button>
                )
              })}
            </nav>
          </aside>
        )}

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Validation panel (collapsible) */}
          {showValidation && issues.length > 0 && (
            <div className="border-b border-slate-700 bg-slate-900 max-h-40 overflow-y-auto">
              <div className="px-4 py-2">
                {issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 py-0.5 text-xs">
                    <span className={issue.severity === 'error' ? 'text-red-400 shrink-0' : 'text-yellow-400 shrink-0'}>
                      {issue.severity === 'error' ? '✖' : '⚠'}
                    </span>
                    <span className="text-slate-500 font-mono shrink-0">{issue.path}</span>
                    <span className="text-slate-300">{issue.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {showValidation && issues.length === 0 && (
            <div className="border-b border-slate-700 bg-slate-900 px-4 py-2 text-xs text-emerald-400">
              ✓ No validation issues found
            </div>
          )}

          <AnnotatedYamlView
            configObj={config}
            schema={schema}
            issues={issues}
            scrollToBlock={scrollToBlock}
          />
        </div>
      </div>
    </div>
  )
}

// ── Toolbar ──────────────────────────────────────────────────────────────────
function Toolbar({
  config, errorCount, warnCount, isDiff, showValidation, sidebarOpen,
  onNewFile, onDiff, onExport, onOpenInBuilder, onToggleValidation, onToggleSidebar,
}) {
  const blockCount = Object.keys(config).length
  return (
    <div className="px-3 py-1.5 bg-slate-800 border-b border-slate-700 flex items-center gap-2 shrink-0 overflow-x-auto">
      <span className="text-xs font-bold text-emerald-400 shrink-0">◎ Reader</span>
      <span className="text-xs text-slate-500 shrink-0">{blockCount} block{blockCount !== 1 ? 's' : ''}</span>

      <div className="flex items-center gap-1 ml-1 shrink-0">
        {errorCount > 0 && (
          <button type="button" onClick={onToggleValidation}
            className={`text-xs px-2 py-0.5 rounded ${showValidation ? 'bg-red-700/50' : 'bg-red-900/30'} text-red-300 hover:bg-red-700/50`}>
            ✖ {errorCount} error{errorCount !== 1 ? 's' : ''}
          </button>
        )}
        {warnCount > 0 && (
          <button type="button" onClick={onToggleValidation}
            className={`text-xs px-2 py-0.5 rounded ${showValidation ? 'bg-yellow-700/50' : 'bg-yellow-900/30'} text-yellow-300 hover:bg-yellow-700/50`}>
            ⚠ {warnCount} warning{warnCount !== 1 ? 's' : ''}
          </button>
        )}
        {errorCount === 0 && warnCount === 0 && (
          <span className="text-xs text-emerald-500 px-1">✓ Valid</span>
        )}
      </div>

      <div className="flex items-center gap-1 ml-auto shrink-0">
        <ToolBtn onClick={onToggleSidebar} title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>
          {sidebarOpen ? '◂' : '▸'}
        </ToolBtn>
        <ToolBtn onClick={onNewFile}>Load file</ToolBtn>
        <ToolBtn onClick={onDiff} active={isDiff}>⇄ Diff</ToolBtn>
        <ToolBtn onClick={onExport} accent>↓ Annotated</ToolBtn>
        <ToolBtn onClick={onOpenInBuilder} accent="blue">⚙ Open in Builder</ToolBtn>
      </div>
    </div>
  )
}

function ToolBtn({ children, onClick, active, accent, title }) {
  const base = 'text-xs px-2 py-1 rounded transition-colors shrink-0'
  const style = accent === 'blue'
    ? `${base} bg-blue-700/50 hover:bg-blue-600/60 text-blue-200`
    : accent
      ? `${base} bg-slate-600 hover:bg-slate-500 text-slate-200`
      : active
        ? `${base} bg-slate-600 text-slate-100`
        : `${base} bg-slate-700/50 hover:bg-slate-600/50 text-slate-400 hover:text-slate-200`
  return (
    <button type="button" onClick={onClick} className={style} title={title}>
      {children}
    </button>
  )
}
