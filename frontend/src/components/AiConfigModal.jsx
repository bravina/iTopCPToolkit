import { useState, useEffect, useRef } from 'react'

const PROVIDERS = [
  {
    id: 'openai',
    name: 'ChatGPT',
    icon: '◈',
    color: 'text-green-400',
    bgColor: 'bg-green-900/30 border-green-700',
    bgActive: 'bg-green-700/40 border-green-500',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'],
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true
  },
  {
    id: 'anthropic',
    name: 'Claude',
    icon: '◉',
    color: 'text-orange-400',
    bgColor: 'bg-orange-900/30 border-orange-700',
    bgActive: 'bg-orange-700/40 border-orange-500',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'],
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    requiresKey: true
  },
  {
    id: 'google',
    name: 'Gemini',
    icon: '◆',
    color: 'text-sky-400',
    bgColor: 'bg-sky-900/30 border-sky-700',
    bgActive: 'bg-sky-700/40 border-sky-500',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    keyPrefix: 'AI',
    keyPlaceholder: 'AIza...',
    docsUrl: 'https://aistudio.google.com/apikey',
    requiresKey: true
  },
  {
    id: 'ollama',
    name: 'Ollama',
    icon: '🦙',
    color: 'text-white',
    bgColor: 'bg-slate-700/30 border-slate-500',
    bgActive: 'bg-slate-500/40 border-slate-400',
    defaultModel: 'llama3',
    models: ['llama3', 'mistral', 'phi3', 'gemma'],
    keyPlaceholder: 'No API key needed (Local)',
    docsUrl: 'https://ollama.com/',
    requiresKey: false
  }
]

export default function AiConfigModal({ onConnect, onClose, currentConfig }) {
  const [selectedProvider, setSelectedProvider] = useState(currentConfig?.provider || 'openai')
  const [model, setModel] = useState(currentConfig?.model || '')
  const [apiKey, setApiKey] = useState(currentConfig?.apiKey || '')
  const [customModel, setCustomModel] = useState(false)
  const [error, setError] = useState(null)
  const [testing, setTesting] = useState(false)
  const keyRef = useRef(null)

  const provider = PROVIDERS.find(p => p.id === selectedProvider)
  const needsKey = provider?.requiresKey !== false

  useEffect(() => {
    if (!currentConfig || currentConfig.provider !== selectedProvider) {
      setModel(provider?.defaultModel || '')
      setCustomModel(false)
      if (!needsKey) setApiKey('local-no-key') // Set a dummy key for free providers
    }
  }, [selectedProvider])

  async function handleConnect() {
    if (needsKey && !apiKey.trim()) {
      setError('Please enter an API key')
      return
    }
    
    setError(null)
    setTesting(true)

    try {
      const API = import.meta.env.VITE_API_URL || ''
      const resp = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          model: model.trim(),
          api_key: needsKey ? apiKey.trim() : 'none',
          messages: [{ role: 'user', content: 'Reply with just "ok".' }],
        }),
      })
      
      const data = await resp.json()
      if (!resp.ok) {
        setError(data.error || data.detail || `API error ${resp.status}`)
        setTesting(false)
        return
      }
      
      onConnect({
        provider: selectedProvider,
        providerName: provider.name,
        model: model.trim(),
        apiKey: needsKey ? apiKey.trim() : '',
      })
    } catch (e) {
      setError(`Connection failed: ${e.message}`)
    }
    setTesting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-800 rounded-2xl shadow-2xl border border-slate-600 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-100">AI Configuration</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-2xl">×</button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Provider Grid */}
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedProvider(p.id)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all text-left ${
                  selectedProvider === p.id ? p.bgActive : `${p.bgColor} hover:brightness-110`
                }`}
              >
                <span className={`text-xl ${p.color}`}>{p.icon}</span>
                <span className="text-sm font-semibold text-slate-200">{p.name}</span>
              </button>
            ))}
          </div>

          {/* Model Selection */}
          <div>
            <label className="text-xs text-slate-400 uppercase font-semibold mb-1 block">Model</label>
            <div className="flex gap-2">
              <select 
                value={model} 
                onChange={e => setModel(e.target.value)}
                className="flex-1 rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-slate-100"
              >
                {provider?.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* API Key Input */}
          <div className={needsKey ? 'opacity-100' : 'opacity-50 pointer-events-none'}>
            <label className="text-xs text-slate-400 uppercase font-semibold mb-1 block">
              {needsKey ? 'API Key' : 'API Key (Not Required)'}
            </label>
            <input
              type="password"
              disabled={!needsKey}
              value={needsKey ? apiKey : ''}
              onChange={e => setApiKey(e.target.value)}
              placeholder={provider?.keyPlaceholder}
              className="w-full rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-slate-100"
            />
          </div>

          {error && <div className="text-red-400 text-xs bg-red-900/20 p-2 rounded border border-red-900/50">{error}</div>}
        </div>

        <div className="px-6 py-4 border-t border-slate-700 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400">Cancel</button>
          <button
            onClick={handleConnect}
            disabled={testing || (needsKey && !apiKey.trim())}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white"
          >
            {testing ? 'Testing...' : 'Connect & Start Chat'}
          </button>
        </div>
      </div>
    </div>
  )
}
