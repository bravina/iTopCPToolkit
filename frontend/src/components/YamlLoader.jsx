import { useState, useRef } from 'react'
import yaml from 'js-yaml'

export default function YamlLoader({ onLoad, label = 'Load Configuration' }) {
  const [tab, setTab] = useState('drop')
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef(null)

  function parseAndLoad(text) {
    try {
      const parsed = yaml.load(text)
      if (!parsed || typeof parsed !== 'object') throw new Error('YAML did not parse to an object')
      setError(null)
      onLoad(parsed)
    } catch (e) {
      setError(`YAML parse error: ${e.message}`)
    }
  }

  function handleFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => parseAndLoad(e.target.result)
    reader.readAsText(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-xl">
        <h2 className="text-xl font-bold text-slate-100 mb-1">{label}</h2>
        <p className="text-sm text-slate-400 mb-6">Load a TopCPToolkit YAML configuration file.</p>

        {/* Tabs */}
        <div className="flex gap-0 rounded-lg overflow-hidden border border-slate-700 mb-4">
          {[['drop', '↓ Drop / Browse'], ['paste', '</> Paste']].map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex-1 py-2 text-xs font-semibold transition-colors ${tab === id ? 'bg-slate-700 text-slate-100' : 'bg-slate-800/50 text-slate-500 hover:text-slate-300'}`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {tab === 'drop' && (
          <div
            onDrop={handleDrop}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-12 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
              dragging
                ? 'border-blue-400 bg-blue-500/10'
                : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/50'
            }`}
          >
            <span className="text-4xl">{dragging ? '📂' : '📄'}</span>
            <p className="text-sm text-slate-300 font-medium">
              {dragging ? 'Release to load' : 'Drop your YAML file here'}
            </p>
            <p className="text-xs text-slate-500">or click to browse</p>
            <input
              ref={fileRef}
              type="file"
              accept=".yaml,.yml,.txt"
              className="hidden"
              onChange={e => handleFile(e.target.files?.[0])}
            />
          </div>
        )}

        {tab === 'paste' && (
          <div className="space-y-2">
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              rows={12}
              spellCheck={false}
              placeholder="Paste your YAML here…"
              className="w-full rounded-xl bg-slate-800 border border-slate-600 px-4 py-3 text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-400 resize-y"
            />
            <button
              type="button"
              onClick={() => parseAndLoad(pasteText)}
              disabled={!pasteText.trim()}
              className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-semibold text-white transition-colors"
            >
              Load YAML
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg bg-red-900/30 border border-red-700 px-4 py-3 text-xs text-red-300 font-mono">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
