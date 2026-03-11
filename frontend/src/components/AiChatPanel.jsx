import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'

const API = import.meta.env.VITE_API_URL || ''

export default function AiChatPanel({ aiConfig, config, schema, onDisconnect }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [ragSources, setRagSources] = useState([])
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    // Build a brief schema context from enabled blocks
    let schemaContext = ''
    try {
      const enabledBlocks = Object.entries(config || {})
        .filter(([, v]) => v?.enabled)
        .map(([k]) => k)
      if (enabledBlocks.length > 0) {
        schemaContext = `Enabled blocks: ${enabledBlocks.join(', ')}`
      }
    } catch (_) { /* ignore */ }

    try {
      const resp = await fetch(`${API}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: aiConfig.provider,
          model: aiConfig.model,
          api_key: aiConfig.apiKey,
          messages: newMessages.slice(-20), // Keep last 20 messages for context window
          schema_context: schemaContext,
        }),
      })

      const data = await resp.json()
      if (!resp.ok) {
        setMessages([
          ...newMessages,
          { role: 'assistant', content: `**Error:** ${data.error || 'Unknown error'}\n\n${data.detail || ''}` },
        ])
      } else {
        setMessages([
          ...newMessages,
          { role: 'assistant', content: data.reply },
        ])
        if (data.rag_sources?.length) {
          setRagSources(data.rag_sources)
        }
      }
    } catch (e) {
      setMessages([
        ...newMessages,
        { role: 'assistant', content: `**Connection error:** ${e.message}` },
      ])
    }
    setLoading(false)
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const providerColors = {
    openai: 'text-green-400',
    anthropic: 'text-orange-400',
    xai: 'text-blue-400',
    google: 'text-sky-400',
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 border-t border-slate-700">
      {/* Header */}
      <div className="px-3 py-1.5 bg-slate-800 border-b border-slate-700 flex items-center gap-2 shrink-0">
        <span className={`text-sm font-bold ${providerColors[aiConfig.provider] || 'text-blue-400'}`}>
          🤖 {aiConfig.providerName}
        </span>
        <span className="text-xs text-slate-500 font-mono">{aiConfig.model}</span>

        {ragSources.length > 0 && (
          <span className="text-xs text-slate-600" title={ragSources.map(s => s.title).join(', ')}>
            📚 {ragSources.length} doc{ragSources.length !== 1 ? 's' : ''}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setMessages([])}
            className="text-xs text-slate-500 hover:text-slate-300 px-2 py-0.5 rounded hover:bg-slate-700"
            title="Clear chat history"
          >Clear</button>
          <button
            onClick={onDisconnect}
            className="text-xs text-red-500 hover:text-red-300 px-2 py-0.5 rounded hover:bg-slate-700"
            title="Disconnect AI"
          >Disconnect</button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-8">
            <span className="text-2xl opacity-50">🤖</span>
            <p className="text-sm text-slate-400">
              Ask me anything about TopCPToolkit configuration!
            </p>
            <div className="flex flex-wrap gap-1 justify-center mt-1">
              {[
                'How do I configure jets?',
                'What are the electron working points?',
                'How does event selection work?',
                'Explain overlap removal options',
              ].map(q => (
                <button
                  key={q}
                  type="button"
                  onClick={() => { setInput(q); inputRef.current?.focus() }}
                  className="text-xs px-2 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600/30 text-slate-100 rounded-br-sm'
                  : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-sm'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-invert prose-xs max-w-none">
                  <ReactMarkdown
                    components={{
                      code: ({ inline, children, ...props }) =>
                        inline
                          ? <code className="bg-slate-700 px-1 rounded text-xs font-mono" {...props}>{children}</code>
                          : <pre className="bg-slate-950 rounded p-2 overflow-x-auto text-xs"><code {...props}>{children}</code></pre>,
                      p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc ml-4 mb-1 space-y-0.5">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal ml-4 mb-1 space-y-0.5">{children}</ol>,
                      li: ({ children }) => <li>{children}</li>,
                      a: ({ href, children }) => (
                        <a href={href} target="_blank" rel="noreferrer"
                          className="text-blue-400 underline hover:text-blue-300">{children}</a>
                      ),
                      h3: ({ children }) => <h3 className="font-bold text-slate-100 mt-2 mb-1">{children}</h3>,
                      strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 border border-slate-700 rounded-xl rounded-bl-sm px-3 py-2 text-xs text-slate-400">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>·</span>
                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>·</span>
                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>·</span>
              </span>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-slate-700 bg-slate-800/50 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about TopCPToolkit config..."
            rows={1}
            className="flex-1 rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-xs text-slate-100 font-mono resize-none focus:outline-none focus:border-blue-400 max-h-24 overflow-y-auto"
            style={{ minHeight: '2rem' }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white text-xs font-semibold transition-colors shrink-0"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
