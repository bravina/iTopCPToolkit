import { useState, useEffect, useMemo, useCallback } from 'react'
import AnnotatedYamlView from './AnnotatedYamlView.jsx'
import YamlLoader from './YamlLoader.jsx'
import DiffView from './DiffView.jsx'
import ResizablePanels from './ResizablePanels.jsx'
import AiChatPanel from './AiChatPanel.jsx'
import { ExplainProvider, useExplainRequests } from '../contexts/ExplainContext.js'
import { explainStatus } from '../ai/settings.js'
import { validateConfig } from '../utils/yamlValidator.js'
import { generateAnnotatedYaml } from '../utils/yamlAnnotator.js'
import { buildRegistryFromYaml, EMPTY_REGISTRY } from '../utils/collectionRegistry.js'
import { checkDepsFromYaml } from '../utils/dependencyChecker.js'
import { resolveCustomEntriesSync, resolveCustomEntries } from '../utils/yamlToConfig.js'
import { effectiveBlocks, ADD_CONFIG_BLOCKS } from '../utils/schema.js'
import { introspectEntry } from '../api.js'

/**
 * Reader mode.  The loaded file's AddConfigBlocks section extends the schema
 * (catalogue first, then a live introspection for anything else) before the
 * rest of the file is validated — the same order TextConfig uses.
 *
 * Reader hosts the assistant itself: its config is the parsed file rather
 * than builder state, and it is an inspector — the tools are built read-only,
 * so there are no proposal tools to offer edits Reader could not apply.
 */
export default function ConfigReader({
  schema, onOpenInBuilder, onOpenSearch,
  aiAvailable = false, aiConnection = null, onOpenAiSettings, isMobile = false,
}) {
  const [config, setConfig] = useState(null)
  const [customEntries, setCustomEntries] = useState([])
  const [isDiff, setIsDiff] = useState(false)
  const [scrollToBlock, setScrollToBlock] = useState(null)
  const [showIssues, setShowIssues] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [issueFilter, setIssueFilter] = useState('all') // 'all' | 'error' | 'warning' | 'dep'
  const [aiOpen, setAiOpen] = useState(true)
  const [aiSplit, setAiSplit] = useState([62, 38])

  const aiStatus = explainStatus(aiAvailable, aiConnection)
  const onAsk = useCallback(() => setAiOpen(true), [])
  const { value: explainValue, request: explainRequest, clear: clearExplain } =
    useExplainRequests({ status: aiStatus, onConnect: onOpenAiSettings, onAsk })

  // Resolve custom blocks: synchronously from the catalogue, then upgrade
  // opaque entries through the backend when Athena is available.
  useEffect(() => {
    if (!config) { setCustomEntries([]); return }
    const sync = resolveCustomEntriesSync(config, schema)
    setCustomEntries(sync)
    if (schema.versions?.athena && sync.some(e => e.block?.opaque)) {
      let cancelled = false
      resolveCustomEntries(config, schema, entry => introspectEntry(entry))
        .then(entries => { if (!cancelled) setCustomEntries(entries) })
        .catch(() => {})
      return () => { cancelled = true }
    }
  }, [config, schema])

  const blocks = useMemo(() => effectiveBlocks(schema.blocks, customEntries), [schema, customEntries])

  const schemaIssues = useMemo(() => (config ? validateConfig(config, blocks) : []), [config, blocks])
  const registry = useMemo(() => (config ? buildRegistryFromYaml(config, blocks) : EMPTY_REGISTRY), [config, blocks])
  const depIssues = useMemo(() => (config ? checkDepsFromYaml(config, registry, blocks) : []), [config, registry, blocks])
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
    const blob = new Blob([generateAnnotatedYaml(config, blocks)], { type: 'application/x-yaml' })
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
        <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">◉ Config Reader</span>
        </div>
        <YamlLoader onLoad={handleLoad} />
      </div>
    )
  }

  const errorCount = allIssues.filter(i => i.severity === 'error' && i.kind !== 'dependency').length
  const warnCount = allIssues.filter(i => i.severity === 'warning' && i.kind !== 'dependency').length
  const depCount = depIssues.length

  const presentBlocks = Object.keys(config)
  const blockMap = Object.fromEntries(blocks.map(b => [b.name, b]))

  const blockIssues = {}
  for (const issue of allIssues) {
    const blockKey = issue.path.split('[')[0].split('.')[0]
    ;(blockIssues[blockKey] ??= []).push(issue)
  }

  const toolbar = (
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
      aiAvailable={aiAvailable}
      aiConnected={!!aiConnection}
      aiOpen={aiOpen}
      onToggleAi={() => (aiConnection ? setAiOpen(o => !o) : onOpenAiSettings?.())}
    />
  )

  if (isDiff) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {toolbar}
        <DiffView configA={config} blocks={blocks} onClose={() => setIsDiff(false)} />
      </div>
    )
  }

  const sidebar = (
    <aside className="w-48 shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-700 overflow-y-auto flex flex-col">
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-800">
        <p className="text-xs uppercase tracking-wider text-slate-500 font-semibold">Blocks</p>
      </div>
      <nav className="flex-1 py-1">
        {presentBlocks.map(bk => {
          const def = blockMap[bk] ?? (bk === ADD_CONFIG_BLOCKS ? { label: 'Add Config Blocks' } : null)
          const bi = blockIssues[bk] || []
          const errs = bi.filter(i => i.severity === 'error' && i.kind !== 'dependency').length
          const warns = bi.filter(i => i.severity === 'warning' && i.kind !== 'dependency').length
          const deps = bi.filter(i => i.kind === 'dependency').length
          return (
            <button key={bk} type="button" onClick={() => setScrollToBlock(bk)}
              className="w-full text-left px-3 py-1.5 flex items-center gap-1 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
              <span className={`text-xs truncate ${!def ? 'text-red-600 dark:text-red-400' : def.custom ? 'text-purple-700 dark:text-purple-300' : 'text-slate-700 dark:text-slate-300'}`}>
                {def?.label ?? bk}
              </span>
              <span className="flex gap-0.5 ml-auto shrink-0">
                {errs > 0 && <span className="text-red-600 dark:text-red-400 text-xs">✖{errs}</span>}
                {warns > 0 && <span className="text-yellow-600 dark:text-yellow-400 text-xs">⚠{warns}</span>}
                {deps > 0 && <span className="text-orange-600 dark:text-orange-400 text-xs">⊘{deps}</span>}
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )

  const yamlColumn = (
    <div className="flex flex-col overflow-hidden h-full w-full">
      {showIssues && (
        <div className="border-b border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 max-h-44 overflow-y-auto shrink-0">
          <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-slate-200 dark:border-slate-800">
            {[
              { key: 'all', label: `All (${allIssues.length})` },
              { key: 'error', label: `Errors (${errorCount})`, color: 'text-red-600 dark:text-red-400' },
              { key: 'warning', label: `Warnings (${warnCount})`, color: 'text-yellow-600 dark:text-yellow-400' },
              { key: 'dep', label: `References (${depCount})`, color: 'text-orange-600 dark:text-orange-400' },
            ].map(tab => (
              <button key={tab.key} type="button" onClick={() => setIssueFilter(tab.key)}
                className={`text-xs px-2 py-0.5 rounded transition-colors ${
                  issueFilter === tab.key ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100' : `text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 ${tab.color ?? ''}`}`}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="px-4 py-1.5">
            {filteredIssues.length === 0 && <div className="text-xs text-emerald-600 dark:text-emerald-400 py-1">✓ No issues in this category</div>}
            {filteredIssues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5 text-xs">
                <span className={issue.kind === 'dependency' ? 'text-orange-600 dark:text-orange-400 shrink-0' : issue.severity === 'error' ? 'text-red-600 dark:text-red-400 shrink-0' : 'text-yellow-600 dark:text-yellow-400 shrink-0'}>
                  {issue.kind === 'dependency' ? '⊘' : issue.severity === 'error' ? '✖' : '⚠'}
                </span>
                <button type="button" className="text-slate-500 font-mono shrink-0 hover:text-blue-600 dark:hover:text-blue-400 text-left"
                  onClick={() => setScrollToBlock(issue.path.split('[')[0].split('.')[0])}>
                  {issue.path}
                </button>
                <span className="text-slate-700 dark:text-slate-300">{issue.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <AnnotatedYamlView configObj={config} blocks={blocks} issues={allIssues} scrollToBlock={scrollToBlock} />
    </div>
  )

  const showAi = aiAvailable && !!aiConnection && aiOpen
  const assistant = showAi ? (
    <AiChatPanel
      connection={aiConnection}
      schema={schema}
      configObj={config}
      blocks={blocks}
      registry={registry}
      mode="reader"
      readOnly
      explainRequest={explainRequest}
      onExplainHandled={clearExplain}
      onOpenSettings={onOpenAiSettings}
      onClose={() => setAiOpen(false)}
    />
  ) : null

  return (
    <ExplainProvider value={explainValue}>
      <div className="flex flex-1 flex-col overflow-hidden">
        {toolbar}

        <div className="flex flex-1 overflow-hidden">
          {sidebarOpen && sidebar}

          {assistant ? (
            <div className="flex-1 min-w-0 overflow-hidden">
              <ResizablePanels direction={isMobile ? 'vertical' : 'horizontal'} minSize={20}
                sizes={aiSplit} onSizesChange={setAiSplit}>
                {yamlColumn}
                {assistant}
              </ResizablePanels>
            </div>
          ) : (
            <div className="flex flex-1 min-w-0 overflow-hidden">{yamlColumn}</div>
          )}
        </div>
      </div>
    </ExplainProvider>
  )
}

export function Toolbar({
  config, errorCount, warnCount, depCount, isDiff, showIssues, sidebarOpen,
  onNewFile, onDiff, onExport, onOpenInBuilder, onToggleIssues, onToggleSidebar, onOpenSearch,
  aiAvailable, aiConnected, aiOpen, onToggleAi,
}) {
  const blockCount = Object.keys(config).length
  const totalIssues = errorCount + warnCount + depCount
  return (
    <div className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 shrink-0 overflow-x-auto">
      <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 shrink-0">◉ Reader</span>
      <span className="text-xs text-slate-500 shrink-0">{blockCount} block{blockCount !== 1 ? 's' : ''}</span>

      <div className="flex items-center gap-1 ml-1 shrink-0">
        {errorCount > 0 && (
          <button type="button" onClick={onToggleIssues}
            className={`text-xs px-2 py-0.5 rounded ${showIssues ? 'bg-red-200 dark:bg-red-700/50' : 'bg-red-100 dark:bg-red-900/30'} text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-700/50`}>
            ✖ {errorCount}
          </button>
        )}
        {warnCount > 0 && (
          <button type="button" onClick={onToggleIssues}
            className={`text-xs px-2 py-0.5 rounded ${showIssues ? 'bg-yellow-200 dark:bg-yellow-700/50' : 'bg-yellow-100 dark:bg-yellow-900/30'} text-yellow-700 dark:text-yellow-300 hover:bg-yellow-200 dark:hover:bg-yellow-700/50`}>
            ⚠ {warnCount}
          </button>
        )}
        {depCount > 0 && (
          <button type="button" onClick={onToggleIssues}
            className={`text-xs px-2 py-0.5 rounded ${showIssues ? 'bg-orange-200 dark:bg-orange-700/50' : 'bg-orange-100 dark:bg-orange-900/30'} text-orange-700 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-700/50`}
            title="Unresolved container/selection references">
            ⊘ {depCount} ref{depCount !== 1 ? 's' : ''}
          </button>
        )}
        {totalIssues === 0 && <span className="text-xs text-emerald-600 dark:text-emerald-500 px-1">✓ Valid</span>}
      </div>

      <div className="flex items-center gap-1 ml-auto shrink-0">
        {onOpenSearch && <ToolBtn onClick={onOpenSearch} title="Search (⌘F / Ctrl+F)">⌕</ToolBtn>}
        {aiAvailable && (
          <ToolBtn onClick={onToggleAi} active={aiConnected && aiOpen}
            title={aiConnected ? 'Show or hide the assistant' : 'Connect an assistant with your own API key'}>
            🤖 {aiConnected ? 'Assistant' : 'Connect AI'}
          </ToolBtn>
        )}
        <ToolBtn onClick={onToggleSidebar} title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>{sidebarOpen ? '◂' : '▸'}</ToolBtn>
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
    ? `${base} bg-blue-100 dark:bg-blue-700/50 hover:bg-blue-200 dark:hover:bg-blue-600/60 text-blue-800 dark:text-blue-200`
    : accent
      ? `${base} bg-slate-300 dark:bg-slate-600 hover:bg-slate-400 dark:hover:bg-slate-500 text-slate-800 dark:text-slate-200`
      : active
        ? `${base} bg-slate-300 dark:bg-slate-600 text-slate-900 dark:text-slate-100`
        : `${base} bg-slate-200/50 dark:bg-slate-700/50 hover:bg-slate-300/50 dark:hover:bg-slate-600/50 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200`
  return <button type="button" onClick={onClick} className={style} title={title}>{children}</button>
}
