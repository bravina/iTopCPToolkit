import { useState, useEffect, useRef } from 'react'
import { PROVIDERS, getProvider, modelsFor, probeToolSupport, isToolBlocked, TOOL_CALLING_ADVICE } from '../ai/providers.js'
import { loadKey, hasNoToolSupport } from '../ai/settings.js'

/**
 * Bring-your-own-key setup for the assistant.
 *
 * The key is typed here, kept in sessionStorage by the caller and sent only to
 * the provider the user picked — never to the iTopCPToolkit backend.  Model
 * lists come from the provider's own API where there is one, so they cannot go
 * stale; the pinned fallback is used when that call fails, and any model ID
 * can be typed by hand.
 *
 * Where the provider can be asked (Ollama), each model is also probed for tool
 * calling, which this assistant cannot work without.  A model known to lack it
 * is marked and refused rather than hidden — someone who pulled `llama3` should
 * find out why it is no use, not fail to find it.  Probes never gate the list:
 * they run after it renders, and a model whose capability stays unknown is
 * offered as usual.
 *
 * Props: connection ({ provider, model } | null), onConnect, onDisconnect, onClose
 */
export default function AiSettingsModal({ connection, onConnect, onDisconnect, onClose }) {
  const [providerId, setProviderId] = useState(connection?.provider || PROVIDERS[0].id)
  const [model, setModel] = useState(connection?.model || '')
  const [apiKey, setApiKey] = useState(() => loadKey(connection?.provider || PROVIDERS[0].id))
  const [models, setModels] = useState([])
  const [source, setSource] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [caps, setCaps] = useState({})     // model id → 'yes' | 'no' | 'unknown'
  const keyRef = useRef(null)
  const aliveRef = useRef(true)

  const provider = getProvider(providerId)
  const needsKey = provider.requiresKey

  useEffect(() => { keyRef.current?.focus() }, [])
  useEffect(() => () => { aliveRef.current = false }, [])

  const markCap = (m, support) => { if (aliveRef.current) setCaps(c => ({ ...c, [m]: support })) }

  // Switching provider brings its own stored key and its own model list.
  useEffect(() => {
    setApiKey(loadKey(providerId))
    setModels(provider.defaultModels)
    setSource(null)
    setCaps({})
    setModel(m => (connection?.provider === providerId ? connection.model : provider.defaultModels[0] || m))
  }, [providerId])  // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshModels() {
    if (needsKey && !apiKey.trim()) { setError('Enter the API key first'); return }
    setBusy(true)
    setError(null)
    const { models: list, source: src, error: err } = await modelsFor(provider, { apiKey: apiKey.trim() })
    setModels(list)
    setSource(src)
    if (err) setError(`Could not list models (${err}) — showing pinned defaults`)
    if (!list.includes(model)) setModel(list[0] || model)
    setBusy(false)
    // Deliberately not awaited: the list is usable while the probes land.
    probeToolSupport(provider, list, { onResult: markCap }).catch(() => {})
  }

  // A hand-typed model is probed too, once the typing settles.
  useEffect(() => {
    const id = model.trim()
    if (!id || caps[id] !== undefined || typeof provider.toolSupport !== 'function') return
    const timer = setTimeout(
      () => { probeToolSupport(provider, [id], { onResult: markCap }).catch(() => {}) }, 400)
    return () => clearTimeout(timer)
  }, [model, providerId])  // eslint-disable-line react-hooks/exhaustive-deps

  // A failure already seen counts as a 'no' even where nothing can be probed.
  const chosen = model.trim()
  const support = hasNoToolSupport(providerId, chosen) ? 'no' : (caps[chosen] ?? 'unknown')
  const blocked = isToolBlocked(support)
  const unusable = models.filter(m => isToolBlocked(caps[m]))

  function handleConnect() {
    if (needsKey && !apiKey.trim()) { setError('An API key is required'); return }
    if (!model.trim()) { setError('Pick or type a model'); return }
    if (blocked) { setError(`${chosen} cannot do tool calling — ${TOOL_CALLING_ADVICE}.`); return }
    onConnect({ provider: providerId, model: model.trim(), apiKey: needsKey ? apiKey.trim() : '' })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onKeyDown={e => { if (e.key === 'Escape') onClose() }}>
      <div className="w-full max-w-lg rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <span className="font-semibold text-slate-800 dark:text-slate-200">🤖 AI assistant</span>
          <button type="button" onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl leading-none">×</button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map(p => (
              <button key={p.id} type="button" onClick={() => setProviderId(p.id)}
                className={`px-3 py-2 rounded border text-sm text-left transition-colors ${
                  p.id === providerId
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-semibold'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'}`}>
                {p.label}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              {needsKey ? 'API key' : 'API key (not needed)'}
            </label>
            <input ref={keyRef} type="password" value={apiKey} disabled={!needsKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={provider.keyPlaceholder}
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 disabled:opacity-50" />
            <p className="mt-1 text-xs text-slate-500">
              Kept in this tab only (sessionStorage) and sent straight to {provider.label} — it never reaches the
              iTopCPToolkit server.{' '}
              <a href={provider.keysUrl} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">
                {needsKey ? 'Get a key' : 'Docs'}
              </a>
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Model</label>
            <div className="flex gap-2">
              <input list="ai-models" value={model} onChange={e => setModel(e.target.value)}
                placeholder="model id"
                className="flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm font-mono text-slate-900 dark:text-slate-100" />
              <datalist id="ai-models">
                {models.map(m => (
                  <option key={m} value={m}
                    label={isToolBlocked(caps[m]) ? 'no tool calling — unusable' : undefined} />
                ))}
              </datalist>
              <button type="button" onClick={refreshModels} disabled={busy}
                className="text-sm px-2.5 py-1 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 disabled:opacity-40">
                {busy ? '…' : 'Fetch list'}
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {source === 'api' ? `${models.length} models from ${provider.label}.` : 'Pinned defaults — fetch the list for what your key can actually use.'}
              {provider.note ? ` ${provider.note}` : ''}
            </p>
            {unusable.length > 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                No tool calling, so not usable here: <span className="font-mono">{unusable.join(', ')}</span>
              </p>
            )}
            {blocked && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                <span className="font-mono">{chosen}</span> cannot do tool calling. Every answer this assistant
                gives comes from a tool result, so it would fail on the first message — {TOOL_CALLING_ADVICE}.
              </p>
            )}
          </div>

          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex items-center justify-end gap-2">
          {connection && (
            <button type="button" onClick={onDisconnect}
              className="mr-auto text-sm px-3 py-1.5 rounded text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30">
              Disconnect
            </button>
          )}
          <button type="button" onClick={onClose}
            className="text-sm px-3 py-1.5 rounded text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            Cancel
          </button>
          <button type="button" onClick={handleConnect} disabled={blocked}
            title={blocked ? 'This model cannot do tool calling' : undefined}
            className="text-sm font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:hover:bg-blue-600">
            {connection ? 'Save' : 'Connect'}
          </button>
        </div>
      </div>
    </div>
  )
}
