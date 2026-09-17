/**
 * providers.js — one adapter per LLM provider, all called straight from the
 * browser with the user's own key (BYO): nothing goes through Flask.
 *
 * Each adapter converts the neutral transcript used by chat.js
 *
 *   { role: 'user',      text }
 *   { role: 'assistant', text, toolCalls: [{ id, name, input }], raw }
 *   { role: 'tool',      results: [{ id, name, output, isError }] }
 *
 * into its own wire format and back.  `raw` is the provider's own assistant
 * payload, replayed verbatim on the next request — Anthropic in particular
 * requires the blocks of a tool-using turn (thinking included) to come back
 * unchanged.
 *
 * Model lists are fetched from each provider where an endpoint exists;
 * `defaultModels` is only the offline fallback.
 */

const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 8192
export const OLLAMA_URL = 'http://localhost:11434'

/** What to do about a model with no tool template; shared by the error and the picker. */
export const TOOL_CALLING_ADVICE =
  'pick a model tagged for tool calling (Llama 3.1 or newer, Qwen 2.5, Mistral Small, …)'

/**
 * How each provider says "this model has no tool template".  Fatal here rather
 * than degrading: every fact the assistant states comes from a tool result, so
 * a model without tools cannot answer at all.
 */
const NO_TOOL_SUPPORT = [
  /does not support tools/i,                          // Ollama
  /tools?\b[^.]{0,40}\b(?:is|are) not supported/i,    // OpenAI: "'tools' is not supported with this model"
  /function calling is not (?:enabled|supported)/i,   // Gemini
]

function lacksToolSupport(detail) {
  return NO_TOOL_SUPPORT.some(re => re.test(detail))
}

async function readError(resp, label, model) {
  let detail = ''
  try {
    const data = await resp.json()
    detail = data?.error?.message || data?.error?.error || data?.error || data?.message || ''
    if (typeof detail === 'object') detail = JSON.stringify(detail)
  } catch { /* body was not JSON */ }
  const raw = `${label} HTTP ${resp.status}${detail ? `: ${detail}` : ''}`

  // Lead with the human sentence, keep the provider's own words for debugging.
  if (lacksToolSupport(detail)) {
    const err = new Error(`${model || 'That model'} cannot do tool calling, which this assistant `
      + `needs for every answer — ${TOOL_CALLING_ADVICE}. ${raw}`)
    err.noToolSupport = true
    err.model = model || null
    err.providerDetail = raw
    return err
  }

  const hint = resp.status === 401 || resp.status === 403 ? ' — check the API key' : ''
  return new Error(`${raw}${hint}`)
}

async function postJson(url, { headers, body, signal, label, model, fetchImpl = fetch }) {
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok) throw await readError(resp, label, model)
  return resp.json()
}

async function getJson(url, { headers, signal, label, fetchImpl = fetch }) {
  const resp = await fetchImpl(url, { headers, signal })
  if (!resp.ok) throw await readError(resp, label)
  return resp.json()
}

function parseArgs(raw) {
  if (raw === null || raw === undefined || raw === '') return {}
  if (typeof raw === 'object') return raw
  try { return JSON.parse(raw) } catch { return {} }
}

/** Tool result payload as text — every provider takes a string here. */
function resultText(r) {
  return typeof r.output === 'string' ? r.output : JSON.stringify(r.output)
}

const UNANSWERED = 'Error: no result — the exchange ended before this tool ran.'

/**
 * Last line of defence before a transcript goes on the wire.  chat.js already
 * closes its exchanges off, but a transcript from an older session (or one an
 * exception left half-written) must not poison every later request:
 *
 *  - a tool-using assistant turn with no results after it is answered here, so
 *    no provider sees a `tool_use` / `tool_calls` / `functionCall` it cannot
 *    match;
 *  - two assistant turns in a row are folded into one, because Gemini needs the
 *    roles to alternate and Anthropic merges them regardless.
 */
export function normalizeTurns(turns) {
  const out = []
  const unanswered = calls => ({
    role: 'tool',
    results: calls.map(c => ({ id: c.id, name: c.name, isError: true, output: UNANSWERED })),
  })

  for (const turn of turns) {
    const prev = out[out.length - 1]
    if (prev?.role === 'assistant' && prev.toolCalls?.length && turn.role !== 'tool') {
      out.push(unanswered(prev.toolCalls))
    }
    const last = out[out.length - 1]
    if (turn.role === 'assistant' && last?.role === 'assistant') {
      // Keep whichever half still has calls to replay; a plain text turn is
      // reconstructible from `text`.
      const carrier = turn.toolCalls?.length ? turn : null
      out[out.length - 1] = {
        role: 'assistant',
        text: [last.text, turn.text].filter(Boolean).join('\n\n'),
        toolCalls: carrier?.toolCalls ?? [],
        raw: carrier?.raw ?? null,
      }
      continue
    }
    out.push(turn)
  }

  const tail = out[out.length - 1]
  if (tail?.role === 'assistant' && tail.toolCalls?.length) out.push(unanswered(tail.toolCalls))
  return out
}

// ── Anthropic ────────────────────────────────────────────────────────────────

function anthropicHeaders(apiKey) {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    // Anthropic requires this opt-in for requests made from a browser tab.
    'anthropic-dangerous-direct-browser-access': 'true',
  }
}

function anthropicMessages(turns) {
  return normalizeTurns(turns).map(turn => {
    if (turn.role === 'user') return { role: 'user', content: turn.text }
    if (turn.role === 'tool') {
      return {
        role: 'user',
        content: turn.results.map(r => ({
          type: 'tool_result', tool_use_id: r.id, content: resultText(r),
          ...(r.isError ? { is_error: true } : {}),
        })),
      }
    }
    return { role: 'assistant', content: turn.raw ?? [{ type: 'text', text: turn.text || '' }] }
  })
}

const anthropic = {
  id: 'anthropic',
  label: 'Claude',
  keysUrl: 'https://console.anthropic.com/settings/keys',
  keyPlaceholder: 'sk-ant-…',
  requiresKey: true,
  defaultModels: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],

  async listModels({ apiKey, signal, fetchImpl }) {
    const data = await getJson('https://api.anthropic.com/v1/models?limit=100', {
      headers: anthropicHeaders(apiKey), signal, label: 'Anthropic', fetchImpl,
    })
    return (data.data || []).map(m => m.id)
  },

  async send({ model, apiKey, system, turns, tools, signal, fetchImpl }) {
    const data = await postJson('https://api.anthropic.com/v1/messages', {
      headers: anthropicHeaders(apiKey),
      label: 'Anthropic',
      model,
      signal,
      fetchImpl,
      body: {
        model,
        max_tokens: MAX_TOKENS,
        system,
        // Withheld, not empty: an empty tool list is rejected by some providers.
        ...(tools.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters })) } : {}),
        messages: anthropicMessages(turns),
      },
    })
    const content = data.content || []
    const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim()
    const toolCalls = content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input || {} }))
    return {
      text: data.stop_reason === 'refusal' && !text
        ? `The model declined this request (${data.stop_details?.category ?? 'refusal'}).`
        : text,
      toolCalls,
      raw: content,
      stopReason: data.stop_reason ?? null,
    }
  },
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

const OPENAI_EXCLUDE = /embedding|audio|tts|whisper|transcribe|image|dall-e|moderation|realtime|codex|search|computer/i

function openaiMessages(system, turns) {
  const out = [{ role: 'system', content: system }]
  for (const turn of normalizeTurns(turns)) {
    if (turn.role === 'user') out.push({ role: 'user', content: turn.text })
    else if (turn.role === 'tool') {
      for (const r of turn.results) out.push({ role: 'tool', tool_call_id: r.id, content: resultText(r) })
    } else {
      out.push(turn.raw ?? { role: 'assistant', content: turn.text || '' })
    }
  }
  return out
}

const openai = {
  id: 'openai',
  label: 'ChatGPT',
  keysUrl: 'https://platform.openai.com/api-keys',
  keyPlaceholder: 'sk-…',
  requiresKey: true,
  defaultModels: ['gpt-5.1', 'gpt-5', 'gpt-4.1'],

  async listModels({ apiKey, signal, fetchImpl }) {
    const data = await getJson('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` }, signal, label: 'OpenAI', fetchImpl,
    })
    return (data.data || [])
      .map(m => m.id)
      .filter(id => /^(gpt|o\d)/.test(id) && !OPENAI_EXCLUDE.test(id))
      .sort()
  },

  async send({ model, apiKey, system, turns, tools, signal, fetchImpl }) {
    const data = await postJson('https://api.openai.com/v1/chat/completions', {
      headers: { Authorization: `Bearer ${apiKey}` },
      label: 'OpenAI',
      model,
      signal,
      fetchImpl,
      body: {
        model,
        messages: openaiMessages(system, turns),
        ...(tools.length ? {
          tools: tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        } : {}),
      },
    })
    const msg = data.choices?.[0]?.message ?? {}
    return {
      text: (msg.content || '').trim(),
      toolCalls: (msg.tool_calls || []).map(c => ({
        id: c.id, name: c.function?.name, input: parseArgs(c.function?.arguments),
      })),
      raw: msg,
      stopReason: data.choices?.[0]?.finish_reason ?? null,
    }
  },
}

// ── Google Gemini ────────────────────────────────────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Gemini wants OpenAPI-style upper-case type names and no empty schemas. */
export function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'type') out.type = String(v).toUpperCase()
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([n, s]) => [n, toGeminiSchema(s)]))
    else if (k === 'items') out.items = toGeminiSchema(v)
    else out[k] = v
  }
  if (out.type === 'OBJECT' && !Object.keys(out.properties || {}).length) return null
  return out
}

function geminiContents(turns) {
  return normalizeTurns(turns).map(turn => {
    if (turn.role === 'user') return { role: 'user', parts: [{ text: turn.text }] }
    if (turn.role === 'tool') {
      return {
        role: 'user',
        parts: turn.results.map(r => ({
          functionResponse: { name: r.name, response: { result: resultText(r) } },
        })),
      }
    }
    return turn.raw ?? { role: 'model', parts: [{ text: turn.text || '' }] }
  })
}

const gemini = {
  id: 'google',
  label: 'Gemini',
  keysUrl: 'https://aistudio.google.com/apikey',
  keyPlaceholder: 'AIza…',
  requiresKey: true,
  defaultModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],

  async listModels({ apiKey, signal, fetchImpl }) {
    const data = await getJson(`${GEMINI_BASE}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey }, signal, label: 'Gemini', fetchImpl,
    })
    return (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name).replace(/^models\//, ''))
  },

  async send({ model, apiKey, system, turns, tools, signal, fetchImpl }) {
    const data = await postJson(`${GEMINI_BASE}/models/${model}:generateContent`, {
      headers: { 'x-goog-api-key': apiKey },
      label: 'Gemini',
      model,
      signal,
      fetchImpl,
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: geminiContents(turns),
        ...(tools.length ? {
          tools: [{
            functionDeclarations: tools.map(t => {
              const parameters = toGeminiSchema(t.parameters)
              return { name: t.name, description: t.description, ...(parameters ? { parameters } : {}) }
            }),
          }],
        } : {}),
      },
    })
    const content = data.candidates?.[0]?.content ?? { role: 'model', parts: [] }
    const parts = content.parts || []
    return {
      text: parts.filter(p => p.text).map(p => p.text).join('\n').trim(),
      toolCalls: parts.filter(p => p.functionCall).map((p, i) => ({
        id: `${p.functionCall.name}-${i}`, name: p.functionCall.name, input: p.functionCall.args || {},
      })),
      raw: content,
      stopReason: data.candidates?.[0]?.finishReason ?? null,
    }
  },
}

// ── Ollama (local) ───────────────────────────────────────────────────────────

function ollamaMessages(system, turns) {
  const out = [{ role: 'system', content: system }]
  for (const turn of normalizeTurns(turns)) {
    if (turn.role === 'user') out.push({ role: 'user', content: turn.text })
    else if (turn.role === 'tool') {
      for (const r of turn.results) out.push({ role: 'tool', content: resultText(r) })
    } else {
      out.push(turn.raw ?? { role: 'assistant', content: turn.text || '' })
    }
  }
  return out
}

/**
 * `POST /api/show` carries a `capabilities` array on builds new enough to have
 * one; `tools` in it is the only reliable "this model has a tool template".
 * Anything else — an older build, a listing without the field — is 'unknown',
 * never 'no': a model is not hidden or blocked because the probe said nothing.
 */
export function toolSupportFrom(data) {
  const caps = data?.capabilities
  if (!Array.isArray(caps) || !caps.length) return 'unknown'
  return caps.some(c => String(c).toLowerCase() === 'tools') ? 'yes' : 'no'
}

/** Only a definite 'no' is a blocker. */
export function isToolBlocked(support) {
  return support === 'no'
}

// Newer Ollama takes `{ model }`, older builds only `{ name }`; try both before
// giving up on the probe.
async function ollamaShow(model, { signal, fetchImpl }) {
  let last = null
  for (const key of ['model', 'name']) {
    try {
      return await postJson(`${OLLAMA_URL}/api/show`, {
        body: { [key]: model }, signal, label: 'Ollama', fetchImpl,
      })
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      last = err
    }
  }
  throw last
}

const ollama = {
  id: 'ollama',
  label: 'Ollama (local)',
  keysUrl: 'https://ollama.com/',
  keyPlaceholder: 'No key needed',
  requiresKey: false,
  defaultModels: ['llama3.1'],
  note: 'Runs against http://localhost:11434. Start it with OLLAMA_ORIGINS set to this app\'s origin, '
    + 'and pick a model that supports tool calling.',

  async listModels({ signal, fetchImpl }) {
    const data = await getJson(`${OLLAMA_URL}/api/tags`, { signal, label: 'Ollama', fetchImpl })
    return (data.models || []).map(m => m.name)
  },

  /** One extra request per model, so callers probe lazily — see probeToolSupport. */
  async toolSupport({ model, signal, fetchImpl }) {
    try {
      return toolSupportFrom(await ollamaShow(model, { signal, fetchImpl }))
    } catch (err) {
      if (err?.name === 'AbortError') throw err
      return 'unknown'
    }
  },

  async send({ model, system, turns, tools, signal, fetchImpl }) {
    const data = await postJson(`${OLLAMA_URL}/api/chat`, {
      label: 'Ollama',
      model,
      signal,
      fetchImpl,
      body: {
        model,
        stream: false,
        messages: ollamaMessages(system, turns),
        ...(tools.length ? {
          tools: tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        } : {}),
      },
    })
    const msg = data.message ?? {}
    return {
      text: (msg.content || '').trim(),
      toolCalls: (msg.tool_calls || []).map((c, i) => ({
        id: `${c.function?.name}-${i}`, name: c.function?.name, input: parseArgs(c.function?.arguments),
      })),
      raw: msg,
      stopReason: data.done_reason ?? null,
    }
  },
}

export const PROVIDERS = [anthropic, openai, gemini, ollama]

export function getProvider(id) {
  return PROVIDERS.find(p => p.id === id) ?? null
}

/**
 * Tool-calling support for a handful of models, one probe each.  Hosted
 * providers have no probe and cost nothing here — not a single request.  The
 * local list can be long, so it is capped and run a few at a time, and callers
 * render the list first and let `onResult` mark it as answers arrive.
 */
export async function probeToolSupport(provider, models, {
  signal, fetchImpl, limit = 12, concurrency = 4, onResult,
} = {}) {
  if (typeof provider?.toolSupport !== 'function') return {}
  const queue = [...new Set(models)].filter(Boolean).slice(0, limit)
  const out = {}
  let next = 0
  const worker = async () => {
    while (next < queue.length) {
      const model = queue[next++]
      const support = await provider.toolSupport({ model, signal, fetchImpl })
      out[model] = support
      onResult?.(model, support)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  return out
}

/** Live model list where the provider offers one, pinned defaults otherwise. */
export async function modelsFor(provider, { apiKey, signal, fetchImpl } = {}) {
  try {
    const ids = await provider.listModels({ apiKey, signal, fetchImpl })
    return ids.length ? { models: ids, source: 'api' } : { models: provider.defaultModels, source: 'default' }
  } catch (err) {
    return { models: provider.defaultModels, source: 'default', error: err?.message || String(err) }
  }
}
