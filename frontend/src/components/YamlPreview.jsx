import { useState, useEffect, useMemo, useRef } from 'react'
import { toYamlBlocks, toYamlString } from '../utils/yamlSerializer.js'

const EMPTY_PLACEHOLDER = '# No blocks enabled yet\n'

/**
 * Live YAML preview.  Each top-level block is its own <div> so the block that
 * is currently selected in the builder can be highlighted and scrolled to,
 * and so clicking a block in the preview jumps the editor to it.
 *
 * The text of each block is its serializer dump minus trailing newlines; the
 * blank line `toYamlString` puts between blocks is a bottom margin here (a
 * trailing "\n" inside a `white-space: pre` block would hang and not render).
 */
export default function YamlPreview({ config, schema, onExport, selected, onSelectBlock }) {
  const [copied, setCopied] = useState(false)
  const [filename, setFilename] = useState('analysis_config.yaml')
  const scrollRef = useRef(null)
  const blockRefs = useRef(new Map())

  const blocks = useMemo(() => toYamlBlocks(config, schema) ?? [], [config, schema])

  // A block is selectable only if it is a real builder block: this rules out
  // the AddConfigBlocks pseudo-block and blocks kept verbatim from an import.
  const isSelectable = name => !!config?.blocks?.[name]

  function handleCopy() {
    navigator.clipboard.writeText(toYamlString(config, schema)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // Follow the selection: scroll the preview's own container, not the page.
  useEffect(() => {
    if (!selected) return
    const el = blockRefs.current.get(selected)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selected, blocks.length])

  return (
    <div className="h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 flex flex-col">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">YAML Preview</span>
          <button
            onClick={handleCopy}
            className="text-xs px-2 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={filename}
            onChange={e => setFilename(e.target.value)}
            className="flex-1 text-xs font-mono bg-slate-200 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400"
            placeholder="filename.yaml"
          />
          <button
            onClick={() => onExport(filename)}
            className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors whitespace-nowrap"
          >
            ↓ Export
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="yaml-preview flex-1 min-h-0 overflow-auto p-4 text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre"
      >
        {blocks.length === 0 ? EMPTY_PLACEHOLDER : blocks.map((b, i) => {
          const selectable = isSelectable(b.name)
          const active = b.name === selected
          return (
            <div
              key={b.name}
              ref={el => {
                if (el) blockRefs.current.set(b.name, el)
                else blockRefs.current.delete(b.name)
              }}
              onClick={selectable && onSelectBlock ? () => onSelectBlock(b.name) : undefined}
              title={selectable ? `Edit ${b.name}` : undefined}
              className={`border-l-2 -ml-0.5 transition-colors ${i < blocks.length - 1 ? 'mb-5' : ''} ${
                active
                  ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-500 dark:border-blue-400 text-slate-900 dark:text-slate-100'
                  : 'border-transparent'
              } ${selectable ? 'cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-800/60' : ''}`}
            >
              {b.text.replace(/\n+$/, '')}
            </div>
          )
        })}
      </div>
    </div>
  )
}
