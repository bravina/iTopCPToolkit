import { useState } from 'react'
import { toYamlString } from '../utils/yamlSerializer.js'

export default function YamlPreview({ config, schema, onExport }) {
  const [copied, setCopied] = useState(false)
  const [filename, setFilename] = useState('analysis_config.yaml')
  const yamlText = toYamlString(config, schema)

  function handleCopy() {
    navigator.clipboard.writeText(yamlText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="w-96 bg-slate-900 border-l border-slate-700 flex flex-col shrink-0">
      <div className="px-4 py-3 border-b border-slate-700 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-200">YAML Preview</span>
          <button
            onClick={handleCopy}
            className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={filename}
            onChange={e => setFilename(e.target.value)}
            className="flex-1 text-xs font-mono bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-200 focus:outline-none focus:border-blue-400"
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

      <pre className="yaml-preview flex-1 overflow-auto p-4 text-xs text-slate-300 leading-relaxed whitespace-pre">
        {yamlText}
      </pre>
    </div>
  )
}
