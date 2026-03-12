import { useState, useEffect, useRef } from 'react'

const API = import.meta.env.VITE_API_URL || ''

const SECTIONS = [
  { id: 'muon',     label: 'Muons'          },
  { id: 'electron', label: 'Electrons'      },
  { id: 'photon',   label: 'Photons'        },
  { id: 'tau',      label: 'Taus'           },
  { id: 'jet',      label: 'Jets'           },
  { id: 'met',      label: 'Missing ET'     },
  { id: 'ftag',     label: 'Flavour Tagging'},
  { id: 'fatjet',   label: 'Fat Jets'       },
]

export default function IntNoteWriter({ tctVersion, pdflatex }) {
  const [jsonFile,          setJsonFile]          = useState(null)
  const [selectedSections,  setSelectedSections]  = useState(new Set(SECTIONS.map(s => s.id)))
  const [loading,           setLoading]           = useState(false)
  const [result,            setResult]            = useState(null)   // { pdf, tex, stdout, stderr }
  const [error,             setError]             = useState(null)   // { error, stdout?, stderr?, pdf_log?, tex? }
  const [pdfUrl,            setPdfUrl]            = useState(null)
  const [showLog,           setShowLog]           = useState(false)
  const [dragging,          setDragging]          = useState(false)
  const fileRef = useRef(null)

  // Revoke old blob URL and build a new one whenever the result changes
  useEffect(() => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    if (result?.pdf) {
      const binary = atob(result.pdf)
      const bytes  = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: 'application/pdf' })
      setPdfUrl(URL.createObjectURL(blob))
    } else {
      setPdfUrl(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  // Final cleanup on unmount
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])

  function toggleSection(id) {
    setSelectedSections(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.json')) setJsonFile(file)
  }

  async function handleGenerate() {
    if (!jsonFile || loading) return
    setLoading(true)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('json', jsonFile)

    // Only send --sections if it's a strict subset (all selected = omit flag)
    if (selectedSections.size > 0 && selectedSections.size < SECTIONS.length) {
      formData.append('sections', [...selectedSections].join(','))
    }

    try {
      const resp = await fetch(`${API}/api/generate-intnote`, { method: 'POST', body: formData })
      const data = await resp.json()
      if (!resp.ok) setError(data)
      else          setResult(data)
    } catch (e) {
      setError({ error: `Network error: ${e.message}` })
    } finally {
      setLoading(false)
    }
  }

  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime })
    const a    = document.createElement('a')
    a.href     = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function downloadTex() {
    const tex = result?.tex ?? error?.tex
    if (tex) downloadFile(tex, 'topcptoolkit_config_summary.tex', 'text/plain')
  }

  function downloadPdf() {
    if (!pdfUrl) return
    const a    = document.createElement('a')
    a.href     = pdfUrl
    a.download = 'topcptoolkit_config_summary.pdf'
    a.click()
  }

  const isUnavailable = !tctVersion || !pdflatex
  const logText = [
    result?.stdout || error?.stdout,
    result?.stderr || error?.stderr,
    error?.pdf_log,
  ].filter(Boolean).join('\n─────\n')

  // ── Unavailable state ──────────────────────────────────────────────────────
  if (isUnavailable) {
    return (
      <div className="flex flex-1 items-center justify-center bg-slate-950">
        <div className="max-w-md text-center space-y-4 px-6">
          <p className="text-4xl opacity-20">✍</p>
          <h2 className="text-lg font-bold text-slate-300">INTnote Writer unavailable</h2>
          {!tctVersion && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-300">
              ✗ TopCPToolkit was not built into this image.<br />
              Rebuild with <code className="bg-slate-800 px-1 rounded">TCT_VERSION</code> set.
            </div>
          )}
          {tctVersion && !pdflatex && (
            <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-sm text-red-300">
              ✗ <code>pdflatex</code> is not available in this image.<br />
              Rebuild with texlive installed.
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Normal UI ──────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 overflow-hidden">

      {/* ── Left control panel ── */}
      <div className="w-64 shrink-0 bg-slate-900 border-r border-slate-700 flex flex-col overflow-y-auto">

        <div className="px-4 py-3 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-bold text-amber-400">✍ INTnote Writer</h2>
          <p className="text-xs text-slate-500 mt-0.5">Generate LaTeX from a TopCPToolkit JSON</p>
        </div>

        <div className="flex flex-col gap-5 p-4">

          {/* File upload */}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              JSON file
            </p>
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center gap-1.5 cursor-pointer transition-colors text-center ${
                dragging
                  ? 'border-amber-400 bg-amber-500/10'
                  : jsonFile
                    ? 'border-green-600 bg-green-900/10'
                    : 'border-slate-600 hover:border-slate-500 hover:bg-slate-800/40'
              }`}
            >
              <span className="text-2xl">
                {jsonFile ? '✓' : dragging ? '📂' : '📄'}
              </span>
              <span className="text-xs font-medium text-slate-300 break-all leading-snug">
                {jsonFile ? jsonFile.name : 'Drop .json or click to browse'}
              </span>
              {jsonFile && (
                <span className="text-xs text-slate-500">
                  {(jsonFile.size / 1024).toFixed(1)} KB
                </span>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={e => { if (e.target.files?.[0]) setJsonFile(e.target.files[0]) }}
              />
            </div>
          </div>

          {/* Sections */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Sections
              </p>
              <div className="flex gap-2 text-xs">
                <button type="button"
                  onClick={() => setSelectedSections(new Set(SECTIONS.map(s => s.id)))}
                  className="text-slate-500 hover:text-slate-300 transition-colors">
                  All
                </button>
                <span className="text-slate-700">|</span>
                <button type="button"
                  onClick={() => setSelectedSections(new Set())}
                  className="text-slate-500 hover:text-slate-300 transition-colors">
                  None
                </button>
              </div>
            </div>

            <div className="space-y-1">
              {SECTIONS.map(s => {
                const on = selectedSections.has(s.id)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleSection(s.id)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors text-left ${
                      on
                        ? 'bg-amber-900/40 text-amber-200 border border-amber-700/50'
                        : 'bg-slate-800/40 text-slate-500 border border-transparent hover:bg-slate-800'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded text-xs flex items-center justify-center font-bold shrink-0 ${
                      on ? 'bg-amber-600 text-white' : 'bg-slate-700 text-slate-600'
                    }`}>
                      {on ? '✓' : ''}
                    </span>
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Generate button */}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!jsonFile || loading || selectedSections.size === 0}
            className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-bold text-white transition-colors flex items-center justify-center gap-2"
          >
            {loading
              ? <><span className="animate-spin inline-block">⟳</span> Generating…</>
              : '✍ Generate'}
          </button>

          {/* Log toggle */}
          {logText && (
            <button
              type="button"
              onClick={() => setShowLog(v => !v)}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
            >
              <span>{showLog ? '▾' : '▸'}</span>
              {showLog ? 'Hide' : 'Show'} script log
            </button>
          )}
        </div>
      </div>

      {/* ── Right panel: PDF viewer / error / placeholder ── */}
      <div className="flex flex-col flex-1 overflow-hidden bg-slate-950">

        {/* Toolbar (only when there is something to show) */}
        {(pdfUrl || error) && (
          <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex items-center gap-3 shrink-0 overflow-x-auto">
            {pdfUrl && (
              <>
                <span className="text-xs text-green-400 shrink-0">✓ PDF ready</span>
                <button
                  onClick={downloadPdf}
                  className="text-xs px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors shrink-0"
                >
                  ↓ Download PDF
                </button>
                <button
                  onClick={downloadTex}
                  className="text-xs px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors shrink-0"
                >
                  ↓ Download .tex
                </button>
              </>
            )}
            {error && (
              <span className="text-xs text-red-400 shrink-0">✗ {error.error}</span>
            )}
            {/* download .tex even on error if the script produced one */}
            {error?.tex && (
              <button
                onClick={downloadTex}
                className="text-xs px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors shrink-0"
              >
                ↓ Download .tex
              </button>
            )}
          </div>
        )}

        {/* Collapsible log */}
        {showLog && logText && (
          <div className="bg-slate-900 border-b border-slate-700 max-h-44 overflow-y-auto shrink-0">
            <pre className="text-xs font-mono text-slate-400 p-3 whitespace-pre-wrap leading-relaxed">
              {logText}
            </pre>
          </div>
        )}

        {/* Main area */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
            <span className="text-3xl animate-spin">⟳</span>
            <p className="text-sm">Running script and compiling PDF…</p>
            <p className="text-xs text-slate-600">This may take a moment</p>
          </div>

        ) : pdfUrl ? (
          <iframe
            src={pdfUrl}
            className="flex-1 w-full border-0"
            title="Generated configuration summary PDF"
          />

        ) : error ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3">
                <p className="text-sm font-semibold text-red-300 mb-1">Error</p>
                <p className="text-xs text-red-400 font-mono whitespace-pre-wrap">{error.error}</p>
              </div>

              {(error.stdout || error.stderr) && (
                <LogBlock title="Script output" content={[error.stdout, error.stderr].filter(Boolean).join('\n')} />
              )}
              {error.pdf_log && (
                <LogBlock title="pdflatex log" content={error.pdf_log} maxH="max-h-72" />
              )}
            </div>
          </div>

        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-700">
            <span className="text-6xl opacity-10 select-none">✍</span>
            <p className="text-sm">Upload a JSON file and click Generate</p>
          </div>
        )}
      </div>
    </div>
  )
}

function LogBlock({ title, content, maxH = 'max-h-48' }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden">
      <p className="text-xs font-semibold text-slate-400 px-4 py-2 border-b border-slate-700 bg-slate-800/50">
        {title}
      </p>
      <pre className={`text-xs font-mono text-slate-400 px-4 py-3 whitespace-pre-wrap overflow-x-auto overflow-y-auto ${maxH}`}>
        {content}
      </pre>
    </div>
  )
}
