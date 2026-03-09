import { useState, useEffect, useMemo } from 'react'
import AnnotatedYamlView from './AnnotatedYamlView.jsx'
import YamlLoader from './YamlLoader.jsx'
import DiffView from './DiffView.jsx'
import { validateConfig } from '../utils/yamlValidator.js'
import { generateAnnotatedYaml } from '../utils/yamlAnnotator.js'
import { buildRegistryFromYaml } from '../utils/collectionRegistry.js'
import { checkDepsFromYaml } from '../utils/dependencyChecker.js'

export default function ConfigReader({ schema, onOpenInBuilder, onOpenSearch }) {
  const [config, setConfig] = useState(null)
  const [isDiff, setIsDiff] = useState(false)
  const [scrollToBlock, setScrollToBlock] = useState(null)
  const [showIssues, setShowIssues] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [issueFilter, setIssueFilter] = useState('all') // 'all' | 'error' | 'warning' | 'dep'

  // Validation issues
  const schemaIssues = useMemo(
    () => config && schema.length ? validateConfig(config, schema) : [],
    [config, schema]
  )

  // Dependency issues
  const registry = useMemo(
    () => config ? buildRegistryFromYaml(config, schema) : { collections: [], selections: [], byType: {}, withSelections: [] },
    [config, schema]
  )
  const depIssues = useMemo(
    () => config ? checkDepsFromYaml(config, registry, schema) : [],
    [config, registry, schema]
  )

  // Merge all issues, dep issues have kind='dependency' already
  const allIssues = useMemo(() => [...schemaIssues, ...depIssues], [schemaIssues, depIssues])

  const filteredIssues = useMemo(() => {
    if (issueFilter === 'dep') return allIssues.filter(i => i.kind === 'dependency')
    if (issueFilter === 'error') return allIssues.filter(i => i.severity === 'error' && i.kind !== 'dependency')
    if (issueFilter === 'warning') return allIssues.filter(i => i.severity === 'warning' && i.kind !== 'dependency')
    return allIssues
  }, [allIssues, issueFilter])

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

  if (!config) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold text-emerald-400">◉ Config Reader</span>
        </div>
        <YamlLoader onLoad={handleLoad} />
      </div>
    )
  }

  const errorCount = allIssues.filter(i => i.severity === 'error' && i.kind !== 'dependency').length
  const warnCount  = allIssues.filter(i => i.severity === 'warning' && i.kind !== 'dependency').length
  const depCount   = depIssues.length

  const presentBlocks = Object.keys(config)
  const schemaMap = Object.fromEntries(schema.map(b => [b.name, b]))

  // Per-block issue index
  const blockIssues = {}
  for (const issue of allIssues) {
    const blockKey = issue.path.split('[')[0].split('.')[0]
    if (!blockIssues[blockKey]) blockIssues[blockKey] = []
    blockIssues[blockKey].push(issue)
  }

  if (isDiff) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <Toolbar
          config={config} errorCount={errorCount} warnCount={warnCount} depCount={depCount}
          isDiff={isDiff} showIssues={showIssues} sidebarOpen={sidebarOpen}
          onNewFile={() => { setConfig(null); setIsDiff(false) }}
          onDiff={() => setIsDiff(d => !d)}
          onExport={handleExportAnnotated}
          onOpenInBuilder={() => onOpenInBuilder(config)}
          onToggleIssues={() => setShowIssues(v => !v)}
          onToggleSidebar={() => setSidebarOpen(s => !s)}
          onOpenSearch={onOpenSearch}
        />
        <DiffView configA={config} schema={schema} onClose={() => setIsDiff(false)} />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <Toolbar
        config={config} errorCount={errorCount} warnCount={warnCount} depCount={depCount}
        isDiff={isDiff} showIssues={showIssues} sidebarOpen={sidebarOpen}
        onNewFile={() => setConfig(null)}
        onDiff={() => setIsDiff(true)}
        onExport={handleExportAnnotated}
        onOpenInBuilder={() => onOpenInBuilder(config)}
        onToggleIssues={() => setShowIssues(v => !v)}
        onToggleSidebar={() => setSidebarOpen(s => !s)}
        onOpenSearch={onOpenSearch}
      />

      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <aside className="w-48 shrink-0 bg-slate-900 border-r border-slate-700 overflow-y-auto flex flex-col">
            <div className="px-3 py-2 border-b border-slate-800">
              <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Blocks</p>
            </div>
            <nav className="flex-1 py-1">
              {presentBlocks.map(bk => {
                const def = schemaMap[bk]
                const bi = blockIssues[bk] || []
                const errs = bi.filter(i => i.severity === 'error' && i.kind !== 'dependency').length
                const warns = bi.filter(i => i.severity === 'warning' && i.kind !== 'dependency').length
                const deps = bi.filter(i => i.kind === 'dependency').length
                return (
                  <button
                    key={bk}
                    type="button"
                    onClick={() => setScrollToBlock(bk)}
                    className="w-full text-left px-3 py-1.5 flex items-center gap-1 hover:bg-slate-800 transition-colors"
                  >
                    <span className={`text-xs truncate ${!def ? 'text-red-400' : 'text-slate-300'}`}>
                      {def?.label ?? bk}
                    </span>
                    <span className="flex gap-0.5 ml-auto shrink-0">
                      {errs  > 0 && <span className="text-red-400 text-xs">✖{errs}</span>}
                      {warns > 0 && <span className="text-yellow-400 text-xs">⚠{warns}</span>}
                      {deps  > 0 && <span className="text-orange-400 text-xs">⊘{deps}</span>}
                    </span>
                  </button>
                )
              })}
            </nav>
          </aside>
        )}

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Issues panel */}
          {showIssues && (
            <div className="border-b border-slate-700 bg-slate-900/80 max-h-44 overflow-y-auto shrink-0">
              {/* Filter tabs */}
              <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-slate-800">
                {[
                  { key: 'all',     label: `All (${allIssues.length})` },
                  { key: 'error',   label: `Errors (${errorCount})`,    color: 'text-red-400' },
                  { key: 'warning', label: `Warnings (${warnCount})`,   color: 'text-yellow-400' },
                  { key: 'dep',     label: `References (${depCount})`,  color: 'text-orange-400' },
                ].map(tab => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setIssueFilter(tab.key)}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      issueFilter === tab.key
                        ? 'bg-slate-700 text-slate-100'
                        : `text-slate-500 hover:text-slate-300 ${tab.color ?? ''}`
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="px-4 py-1.5">
                {filteredIssues.length === 0 && (
                  <div className="text-xs text-emerald-400 py-1">✓ No issues in this category</div>
                )}
                {filteredIssues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 py-0.5 text-xs">
                    <span className={
                      issue.kind === 'dependency'
                        ? 'text-orange-400 shrink-0'
                        : issue.severity === 'error'
                          ? 'text-red-400 shrink-0'
                          : 'text-yellow-400 shrink-0'
                    }>
                      {issue.kind === 'dependency' ? '⊘' : issue.severity === 'error' ? '✖' : '⚠'}
                    </span>
                    <button
                      type="button"
                      className="text-slate-500 font-mono shrink-0 hover:text-blue-400 text-left"
                      onClick={() => setScrollToBlock(issue.path.split('[')[0].split('.')[0])}
                    >
                      {issue.path}
                    </button>
                    <span className="text-slate-300">{issue.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <AnnotatedYamlView
            configObj={config}
            schema={schema}
            issues={allIssues}
            scrollToBlock={scrollToBlock}
          />
        </div>
      </div>
    </div>
  )
}

function Toolbar({
  config, errorCount, warnCount, depCount, isDiff, showIssues, sidebarOpen,
  onNewFile, onDiff, onExport, onOpenInBuilder, onToggleIssues, onToggleSidebar, onOpenSearch,
}) {
  const blockCount = Object.keys(config).length
  const totalIssues = errorCount + warnCount + depCount
  return (
    <div className="px-3 py-1.5 bg-slate-800 border-b border-slate-700 flex items-center gap-2 shrink-0 overflow-x-auto">
      <span className="text-xs font-bold text-emerald-400 shrink-0">◉ Reader</span>
      <span className="text-xs text-slate-500 shrink-0">{blockCount} block{blockCount !== 1 ? 's' : ''}</span>

      <div className="flex items-center gap-1 ml-1 shrink-0">
        {errorCount > 0 && (
          <button type="button" onClick={onToggleIssues}
            className={`text-xs px-2 py-0.5 rounded ${showIssues ? 'bg-red-700/50' : 'bg-red-900/30'} text-red-300 hover:bg-red-700/50`}>
            ✖ {errorCount}
          </button>
        )}
        {warnCount > 0 && (
          <button type="button" onClick={onToggleIssues}
            className={`text-xs px-2 py-0.5 rounded ${showIssues ? 'bg-yellow-700/50' : 'bg-yellow-900/30'} text-yellow-300 hover:bg-yellow-700/50`}>
            ⚠ {warnCount}
          </button>
        )}
        {depCount > 0 && (
          <button type="button" onClick={onToggleIssues}
            className={`text-xs px-2 py-0.5 rounded ${showIssues ? 'bg-orange-700/50' : 'bg-orange-900/30'} text-orange-300 hover:bg-orange-700/50`}
            title="Unresolved container/selection references">
            ⊘ {depCount} ref{depCount !== 1 ? 's' : ''}
          </button>
        )}
        {totalIssues === 0 && (
          <span className="text-xs text-emerald-500 px-1">✓ Valid</span>
        )}
      </div>

      <div className="flex items-center gap-1 ml-auto shrink-0">
        {onOpenSearch && (
          <ToolBtn onClick={onOpenSearch} title="Search (⌘K)">⌕</ToolBtn>
        )}
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
