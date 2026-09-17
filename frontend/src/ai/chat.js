/**
 * chat.js — the tool-use loop, run in the browser.
 *
 * One user message can take several round trips: the model asks for tools, we
 * answer them locally from the schema and the config, and hand the results
 * back until it replies with prose.  The transcript is provider-neutral (see
 * providers.js); every entry is appended, never rewritten, so a provider that
 * needs its own blocks replayed verbatim gets them from `raw`.
 *
 * Because it is replayed, the transcript must never be left mid-exchange: an
 * assistant turn holding tool calls has to be followed by its results, or every
 * later request in the conversation is rejected ("`tool_use` ids were found
 * without `tool_result` blocks").  Whatever ends the exchange — the step cap,
 * an abort, a throw — closes the open calls out first.
 *
 * A turn the loop writes itself — the corrective for a printed tool call — is
 * marked `hidden`: it belongs to the transcript the provider replays, not to
 * the conversation the user reads.
 */

// One provider round trip per step.  Six was too few: "set up a jet container
// and an electron container" spends a lookup or two per container, a proposal,
// and another proposal after the user rejects the first.  Twelve covers that
// with room to spare and still bounds what a confused model can spend.
export const MAX_TOOL_STEPS = 12

// One corrective round trip for a printed tool call: a model that ignores it
// twice is not going to call the tool, and the step cap still bounds the rest.
const MAX_TEXT_CALL_RETRIES = 1

export function userTurn(text) {
  return { role: 'user', text }
}

const errText = (err) => err?.message || String(err)

// ── A tool call written out as text ──────────────────────────────────────────

/**
 * A weak model sometimes prints its tool call instead of making one, and the
 * panel would render the JSON as if it were the answer.
 *
 * What counts as one is deliberately narrow: a bare JSON object carrying a
 * call's key set — a `name` plus its arguments and nothing else — standing as
 * the whole message or its entire trailing remainder, outside every fenced or
 * inline code span.  An answer that *shows* the user a JSON blob fences it, and
 * a JSON object with any other key (a proposal, a schema slice) is prose data,
 * not a call.
 */
const CALL_ARGS = ['parameters', 'arguments', 'input', 'args']
const CALL_FIELDS = new Set(['name', 'id', 'type', 'tool', 'index', ...CALL_ARGS])
const CALL_WRAPPERS = ['tool_call', 'toolCall', 'function_call', 'functionCall', 'function', 'tool_use']
const TOOL_NAME = /^[A-Za-z_][\w.-]{0,63}$/
// Tags the text-mode models wrap a printed call in.
const CALL_TAGS = /<\/?\|?(?:tool_call|tool_use|function_call|function|python_tag)\|?[^>]*>/gi

/** Blank out code spans, keeping every offset so the parse can use the original. */
function maskCode(text) {
  const blank = s => ' '.repeat(s.length)
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, blank)
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(CALL_TAGS, blank)
}

/** Span of the top-level `{…}` that runs to the end of the text, if there is one. */
function trailingObject(masked) {
  let depth = 0, start = -1, inString = false, escaped = false
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') { if (!depth) start = i; depth++ }
    else if (ch === '}' && depth) {
      depth--
      if (!depth && !masked.slice(i + 1).trim()) return { start, end: i + 1 }
    }
  }
  return null
}

function callShape(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (depth < 3) {
    for (const key of CALL_WRAPPERS) {
      if (value[key] && typeof value[key] === 'object') return callShape(value[key], depth + 1)
    }
    if (Array.isArray(value.tool_calls) && value.tool_calls.length === 1) {
      return callShape(value.tool_calls[0], depth + 1)
    }
  }
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (!TOOL_NAME.test(name)) return null
  // `name` on its own belongs to plenty of legitimate JSON; a call also carries
  // its arguments, and carries nothing else.
  if (!CALL_ARGS.some(k => k in value)) return null
  if (Object.keys(value).some(k => !CALL_FIELDS.has(k))) return null
  return { name }
}

/** `{ name, body }` for a printed call, `null` for anything else. */
export function leakedToolCall(text) {
  const src = String(text ?? '')
  if (!src.includes('{')) return null
  const span = trailingObject(maskCode(src))
  if (!span) return null
  let parsed
  try { parsed = JSON.parse(src.slice(span.start, span.end)) } catch { return null }
  const call = callShape(parsed)
  return call ? { name: call.name, body: src.slice(0, span.start).trimEnd() } : null
}

const toolNames = tools => tools?.names ?? (tools?.defs ?? []).map(d => d.name)

/** Fed back as the user turn of the retry; the model gets one chance to redo it. */
export function textCallCorrection(name, names) {
  const known = names.includes(name)
  const whichTool = !names.length
    ? 'No tools are available on this request — answer in prose.'
    : known
      ? `Call ${name} through the tool-calling interface instead.`
      : `There is no tool called "${name}". The tools are: ${names.join(', ')}.`
  return `That was not a tool call — it was JSON printed as text, so nothing ran. ${whichTool} `
    + 'Make a real tool call or answer in prose; never print a call.'
}

export const TEXT_CALL_NOTICE =
  'The model wrote a tool call as text instead of calling the tool, so nothing ran. '
  + 'Ask again, or switch to a model with stronger tool support.'

/** Run one exchange to completion. Returns the turns appended to `turns`. */
export async function runAssistantTurn({
  provider, model, apiKey, system, turns, tools, signal, fetchImpl,
  onTurn = () => {}, maxSteps = MAX_TOOL_STEPS,
}) {
  const history = [...turns]
  const added = []

  const append = (turn) => {
    history.push(turn)
    added.push(turn)
    onTurn(turn)
  }

  // Calls the model has made and we have not answered yet.
  let pending = null

  const answerPending = (note) => {
    if (!pending) return
    append({
      role: 'tool',
      results: pending.map(call => ({
        id: call.id, name: call.name, isError: true, output: `Error: ${note}`,
      })),
    })
    pending = null
  }

  // Ending on an assistant turn also keeps the roles alternating, which the
  // Gemini and Anthropic transcripts both want.
  const closeWith = (notice) => append({
    role: 'assistant', text: '', notice, toolCalls: [], raw: null, stopReason: 'stopped',
  })

  let corrections = 0

  try {
    for (let step = 0; step < maxSteps; step++) {
      const reply = await provider.send({
        model, apiKey, system, tools: tools.defs, turns: history, signal, fetchImpl,
      })

      // A printed tool call is never shown as an answer: the JSON is dropped
      // from the text (`raw` still replays what the model actually said) and
      // the model is told, once, to call the tool properly.  A second one ends
      // the exchange on a notice rather than on silence.
      const leaked = reply.toolCalls.length ? null : leakedToolCall(reply.text)
      if (leaked) {
        const retrying = corrections++ < MAX_TEXT_CALL_RETRIES
        append({
          role: 'assistant',
          text: leaked.body,
          ...(retrying ? {} : { notice: TEXT_CALL_NOTICE }),
          leakedCall: leaked.name,
          toolCalls: [],
          raw: reply.raw,
          stopReason: 'text_tool_call',
        })
        if (!retrying) return added
        append({ role: 'user', hidden: true, text: textCallCorrection(leaked.name, toolNames(tools)) })
        continue
      }

      append({
        role: 'assistant',
        text: reply.text,
        toolCalls: reply.toolCalls,
        raw: reply.raw,
        stopReason: reply.stopReason,
      })
      if (!reply.toolCalls.length) return added
      pending = reply.toolCalls

      const results = await Promise.all(reply.toolCalls.map(async (call) => {
        const outcome = await tools.run(call.name, call.input)
        return {
          id: call.id,
          name: call.name,
          isError: !outcome.ok,
          output: outcome.ok ? JSON.stringify(outcome.result) : `Error: ${outcome.error}`,
          // A proposal travels with the result for the panel to offer; the
          // providers only ever read the fields above.
          ...(outcome.proposal ? { proposal: outcome.proposal } : {}),
        }
      }))
      append({ role: 'tool', results })
      pending = null
    }
  } catch (err) {
    const aborted = signal?.aborted
    answerPending(aborted ? 'Stopped by the user before this ran.' : `Could not be run: ${errText(err)}`)
    closeWith(aborted ? 'Stopped at your request.' : 'Stopped after an error.')
    throw err
  }

  // Out of steps, with the results already in hand: one more request with the
  // tools withheld, so the model writes an answer from what it gathered instead
  // of dead-ending on the cap.  Offering no tools is the ceiling — this request
  // cannot start another round.
  try {
    const reply = await provider.send({
      model, apiKey, system, tools: [], turns: history, signal, fetchImpl,
    })
    // Nothing left to retry with here, so a printed call is only stripped.
    const leaked = leakedToolCall(reply.text)
    append({
      role: 'assistant',
      text: (leaked ? leaked.body : reply.text)
        || `Stopped after ${maxSteps} tool steps without a final answer. Ask again, more narrowly.`,
      notice: `Answered after the ${maxSteps}-step tool limit.`,
      ...(leaked ? { leakedCall: leaked.name } : {}),
      toolCalls: [],
      // No tools were offered, so drop the blocks of any the model invented
      // rather than replaying a tool call nothing will answer.
      raw: reply.toolCalls.length || leaked ? null : reply.raw,
      stopReason: 'max_tool_steps',
    })
  } catch (err) {
    closeWith(signal?.aborted
      ? 'Stopped at your request.'
      : `Stopped after the ${maxSteps}-step tool limit.`)
    throw err
  }
  return added
}
