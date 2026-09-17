import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import AiMarkdown, { CopyButton } from './AiMarkdown.jsx'
import AiProposalCard from './AiProposalCard.jsx'
import DiffView from './DiffView.jsx'
import { buildYamlObject } from '../utils/yamlSerializer.js'
import { createTools } from '../ai/tools.js'
import { buildSystemPrompt } from '../ai/systemPrompt.js'
import { runAssistantTurn, userTurn } from '../ai/chat.js'
import { getProvider } from '../ai/providers.js'
import { rememberNoToolSupport } from '../ai/settings.js'
import { buildExplainTarget, explainLabel, explainQuestion, splitFollowUps } from '../ai/explain.js'

const SUGGESTIONS = [
  'I have ttbar ℓ+jets — which blocks do I need to get started?',
  'Check my config and explain anything that looks wrong',
  'Which reference config is closest to what I am building?',
  'Set up jets and electrons for me — I will review the diff',
]

const READER_SUGGESTIONS = [
  'What is this configuration doing, in a few sentences?',
  'Which parts of it are non-default, and why would someone change them?',
  'Explain anything here that looks wrong or unusual',
]

/**
 * The one place the panel decides what the tools see: Builder hands them its
 * reducer state, Reader the file it parsed, and Reader is read-only — so the
 * proposal tools are absent from its tool set rather than refusing when
 * called.  There is nothing in Reader to apply a proposal to.
 */
export function panelTools({ schema, config, configObj, blocks, registry, readOnly = false }) {
  return createTools({
    schema, blocks, registry, readOnly,
    config: configObj ?? config,
    configShape: configObj ? 'yaml' : 'state',
  })
}

/**
 * Chat with the config, not with the docs.  The loop runs here in the browser
 * (see ai/chat.js): the model's tool calls are answered from the schema, the
 * current builder state, the serializer and the validator, and only the
 * provider the user chose is ever contacted.
 *
 * A propose_* tool call arrives as a proposal on the tool result: it is shown
 * as a review card in the conversation and goes nowhere near the config until
 * the user presses Apply.
 *
 * An "Explain this" click arrives as `explainRequest`: the app resolves the
 * locator against the schema and the config in hand, and the turn is sent with
 * the didactic prompt.  Persona follows the entry point, never a setting, so
 * the text box keeps the terse assistant it always had.
 *
 * Props: connection, schema, config, configObj, blocks, registry, mode,
 *        readOnly, explainRequest, onExplainHandled, onApplyProposal,
 *        onOpenSettings, onClose
 */
export default function AiChatPanel({
  connection, schema, config, configObj, blocks, registry, mode, readOnly = false,
  explainRequest, onExplainHandled, onApplyProposal, onOpenSettings, onClose,
}) {
  const [turns, setTurns] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [decisions, setDecisions] = useState({})     // proposal id → 'applied' | 'rejected'
  const [reviewing, setReviewing] = useState(null)   // proposal shown in the full diff
  const bottomRef = useRef(null)
  const abortRef = useRef(null)
  // Read by send(), which must not be rebuilt on every turn: an "Explain this"
  // click would then re-fire the effect that sends it.
  const turnsRef = useRef(turns)
  const busyRef = useRef(false)
  useEffect(() => { turnsRef.current = turns }, [turns])

  const provider = getProvider(connection.provider)

  // Rebuilt on every edit so the tools always see the live config.
  const tools = useMemo(
    () => panelTools({ schema, config, configObj, blocks, registry, readOnly }),
    [schema, config, configObj, blocks, registry, readOnly])

  // Both prompts up front: which one is used is decided per exchange.
  const systems = useMemo(() => ({
    terse: buildSystemPrompt({ schema, mode, persona: 'terse' }),
    didactic: buildSystemPrompt({ schema, mode, persona: 'didactic' }),
  }), [schema, mode])

  // Reader holds its config as the parsed file; Builder serialises its state.
  const currentObj = useMemo(
    () => configObj ?? buildYamlObject(config, schema),
    [configObj, config, schema])
  // Cheap "has the config moved since this was proposed?" check for the cards.
  const currentKey = useMemo(() => JSON.stringify(currentObj), [currentObj])

  function decide(proposal, verdict) {
    if (verdict === 'applied') onApplyProposal?.(proposal)
    setDecisions(d => ({ ...d, [proposal.id]: verdict }))
    setReviewing(null)
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'nearest' }) }, [turns, busy])

  useEffect(() => () => abortRef.current?.abort(), [])

  const send = useCallback(async (text, { persona = 'terse', label = null } = {}) => {
    const question = text.trim()
    if (!question || busyRef.current) return
    busyRef.current = true
    setInput('')
    setError(null)
    const base = [...turnsRef.current, { ...userTurn(question), persona, ...(label ? { label } : {}) }]
    setTurns(base)
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await runAssistantTurn({
        provider, model: connection.model, apiKey: connection.apiKey,
        system: systems[persona] ?? systems.terse,
        turns: base, tools, signal: controller.signal,
        // The persona travels with the turn: only a didactic answer offers
        // follow-up chips.
        onTurn: turn => setTurns(prev => [...prev, { ...turn, persona }]),
      })
    } catch (err) {
      if (err?.name !== 'AbortError') setError(err?.message || String(err))
      // So the settings model field can warn about this one next time.
      if (err?.noToolSupport) rememberNoToolSupport(connection.provider, connection.model)
    } finally {
      abortRef.current = null
      busyRef.current = false
      setBusy(false)
    }
  }, [connection, provider, systems, tools])

  // An "Explain this" click: resolved here, where the schema and the config
  // both are.  A click during an exchange is not dropped — it goes as soon as
  // the panel is free.
  useEffect(() => {
    if (!explainRequest || busy) return
    const target = buildExplainTarget({ locator: explainRequest.locator, blocks, configObj: currentObj })
    onExplainHandled?.(explainRequest.id)
    if (target) send(explainQuestion(target), { persona: 'didactic', label: explainLabel(target) })
  }, [explainRequest, busy, blocks, currentObj, send, onExplainHandled])

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700">
      {reviewing && (
        <ProposalDiff proposal={reviewing} configA={currentObj} blocks={blocks}
          onApply={() => decide(reviewing, 'applied')}
          onReject={() => decide(reviewing, 'rejected')}
          onClose={() => setReviewing(null)} />
      )}
      <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 shrink-0">
        <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">🤖 Assistant</span>
        <span className="text-xs font-mono text-slate-500 truncate">{provider.label} · {connection.model}</span>
        {readOnly && (
          <span className="text-xs text-slate-500 shrink-0" title="Reader is an inspector: the assistant cannot propose edits here">read-only</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <PanelBtn onClick={() => { setTurns([]); setDecisions({}) }} disabled={!turns.length || busy}>Clear</PanelBtn>
          <PanelBtn onClick={onOpenSettings}>Settings</PanelBtn>
          <PanelBtn onClick={onClose} title="Hide the assistant">×</PanelBtn>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {!turns.length && (
          <div className="text-xs text-slate-500 space-y-2 py-2">
            <p>
              {readOnly ? (
                <>
                  I can read this release&apos;s block schema, the file you loaded, the reference configs and the
                  validator. I cannot change anything here — that is what &ldquo;Open in Builder&rdquo; is for.
                </>
              ) : (
                <>
                  I can read this release&apos;s block schema, your current config, the reference configs and the
                  validator, and — if you ask for a change — propose edits for you to review before anything is
                  applied. For finding an option by name, the app&apos;s search (⌘F) is faster than I am.
                </>
              )}
            </p>
            <p>
              For any single option or block, the ⓘ bubble next to it has an <span className="text-blue-700 dark:text-blue-300">✨ Explain this</span>{' '}
              action — that answer comes back written for someone meeting it for the first time.
            </p>
            <div className="flex flex-col items-start gap-1">
              {(readOnly ? READER_SUGGESTIONS : SUGGESTIONS).map(s => (
                <button key={s} type="button" onClick={() => send(s)}
                  className="text-left px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) => (
          <Turn key={i} turn={turn}
            decisions={decisions} currentKey={currentKey}
            followUpsLive={i === turns.length - 1 && !busy}
            followUpsOk={followUpsWanted(turn, turns[i - 1])}
            onAsk={q => send(q, { persona: 'didactic' })}
            onDecide={decide} onReview={setReviewing} />
        ))}

        {busy && <p className="text-xs text-slate-500">thinking…</p>}
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-700 flex items-end gap-2 shrink-0">
        <textarea
          value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
          rows={1} placeholder="Ask about this configuration…"
          className="flex-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm text-slate-900 dark:text-slate-100 resize-none max-h-24" />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()}
            className="text-sm px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
            Stop
          </button>
        ) : (
          <button type="button" onClick={() => send(input)} disabled={!input.trim()}
            className="text-sm font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white">
            Send
          </button>
        )}
      </div>
    </div>
  )
}

/** The full side-by-side diff, over the app, with the decision still to make. */
function ProposalDiff({ proposal, configA, blocks, onApply, onReject, onClose }) {
  // Esc closes the review, and stops the app reading it as "leave builder mode".
  useEffect(() => {
    function handler(e) {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 md:p-8">
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-full h-full max-w-7xl flex flex-col overflow-hidden">
        <DiffView
          configA={configA} configB={proposal.configObj} blocks={blocks}
          labelA="A — Your config" labelB="B — Proposed" closeLabel="✕ Close"
          onClose={onClose} />
        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 shrink-0">
          <span className="text-sm text-slate-700 dark:text-slate-300 truncate">{proposal.summary}</span>
          {proposal.kind === 'config' && (
            <span className="text-xs text-yellow-700 dark:text-yellow-400 shrink-0">
              replaces your whole configuration and clears the undo history
            </span>
          )}
          <button type="button" onClick={onApply}
            className="ml-auto text-sm font-semibold px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white shrink-0">
            Apply
          </button>
          <button type="button" onClick={onReject}
            className="text-sm font-semibold px-3 py-1.5 rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
            Reject
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Chips invite a student one step deeper, so only an answer worth going deeper
 * into gets them: not a turn the loop had to rescue (a printed tool call), not
 * one a notice already explains away (the step cap, a stop), and not an answer
 * whose only input was a tool step that failed outright.
 */
export function followUpsWanted(turn, prev) {
  if (turn.persona !== 'didactic' || turn.notice || turn.leakedCall) return false
  if (prev?.role === 'tool' && prev.results?.length && prev.results.every(r => r.isError)) return false
  return true
}

export function Turn({ turn, decisions, currentKey, followUpsLive, followUpsOk = true, onAsk, onDecide, onReview }) {
  // The loop's own corrective turns are transcript, not conversation.
  if (turn.hidden) return null

  if (turn.role === 'user') {
    // An Explain click sends a whole fact sheet; the transcript shows what it
    // was about, with the sheet itself one hover away.
    return (
      <div className="flex justify-end">
        <p title={turn.label ? turn.text : undefined}
          className="max-w-[85%] rounded px-2 py-1 text-sm bg-blue-50 dark:bg-blue-900/40 text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
          {turn.label ? `✨ ${turn.label}` : turn.text}
        </p>
      </div>
    )
  }

  if (turn.role === 'tool') {
    const proposals = turn.results.filter(r => r.proposal)
    return (
      <div className="space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {turn.results.map(r => (
            <span key={r.id} title={r.isError ? r.output : undefined}
              className={`text-xs font-mono px-1.5 py-0.5 rounded ${r.isError
                ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
              {r.isError ? '✗' : '✓'} {r.name}
            </span>
          ))}
        </div>
        {proposals.map(r => (
          <AiProposalCard key={r.proposal.id} proposal={r.proposal}
            status={decisions[r.proposal.id] ?? 'pending'}
            stale={currentKey !== r.proposal.baseKey}
            onApply={() => onDecide(r.proposal, 'applied')}
            onReject={() => onDecide(r.proposal, 'rejected')}
            onReview={() => onReview(r.proposal)} />
        ))}
      </div>
    )
  }

  if (!turn.text && !turn.notice) return null
  // Only a didactic answer is asked for follow-ups, so only there are they
  // split off the text.
  const { body, followUps } = turn.persona === 'didactic'
    ? splitFollowUps(turn.text)
    : { body: turn.text, followUps: [] }
  // The list is split off either way, so suppressing the chips never leaves it
  // behind in the body as markup.
  const chips = followUpsOk ? followUps : []
  return (
    <div className="group/msg relative text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
      {body && (
        <>
          <AiMarkdown>{body}</AiMarkdown>
          <CopyButton text={body} label="Copy"
            className="absolute -top-1 right-0 opacity-0 group-hover/msg:opacity-100 focus:opacity-100" />
        </>
      )}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {chips.map(q => (
            <button key={q} type="button" disabled={!followUpsLive} onClick={() => onAsk?.(q)}
              title={followUpsLive ? 'Ask this next' : 'Already moved on from this answer'}
              className="text-xs text-left px-2 py-0.5 rounded-full border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40 disabled:opacity-40 disabled:hover:bg-transparent">
              {q}
            </button>
          ))}
        </div>
      )}
      {/* The step cap, the Stop button and a printed tool call end an exchange, they do not fail it. */}
      {turn.notice && <p className="text-xs italic text-slate-500 mt-0.5">{turn.notice}</p>}
    </div>
  )
}

function PanelBtn({ children, onClick, disabled, title }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      className="text-xs px-1.5 py-0.5 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40">
      {children}
    </button>
  )
}
