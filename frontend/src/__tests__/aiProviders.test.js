import { describe, it, expect, afterEach } from 'vitest'
import {
  PROVIDERS, getProvider, modelsFor, toGeminiSchema, normalizeTurns,
  probeToolSupport, toolSupportFrom, isToolBlocked,
} from '../ai/providers.js'
import {
  aiEnabled, loadConnection, savePrefs, saveKey, clearKey,
  rememberNoToolSupport, hasNoToolSupport,
} from '../ai/settings.js'
import { TOOL_DEFS } from '../ai/tools.js'

/** A fetch stand-in returning the queued payloads and recording what it was sent. */
function fakeFetch(...payloads) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null })
    const next = payloads.shift()
    if (next instanceof Error) throw next
    if (next?.status) return { ok: false, status: next.status, json: async () => next.body ?? {} }
    return { ok: true, status: 200, json: async () => next }
  }
  return { impl, calls }
}

const TURNS = [
  { role: 'user', text: 'which block owns JVT?' },
  { role: 'assistant', text: 'checking', toolCalls: [{ id: 'c1', name: 'list_blocks', input: {} }], raw: [{ type: 'raw' }] },
  { role: 'tool', results: [{ id: 'c1', name: 'list_blocks', output: '{"total":1}', isError: false }] },
]

function memoryStorage() {
  const map = new Map()
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  }
}

describe('provider registry', () => {
  it('knows the four providers and their key requirements', () => {
    expect(PROVIDERS.map(p => p.id)).toEqual(['anthropic', 'openai', 'google', 'ollama'])
    expect(getProvider('anthropic').requiresKey).toBe(true)
    expect(getProvider('ollama').requiresKey).toBe(false)
    expect(getProvider('nope')).toBeNull()
  })

  it('pins current models as the offline fallback only', async () => {
    const anthropic = getProvider('anthropic')
    expect(anthropic.defaultModels).toContain('claude-opus-5')

    const live = await modelsFor(anthropic, {
      apiKey: 'k', fetchImpl: fakeFetch({ data: [{ id: 'claude-opus-5' }, { id: 'claude-haiku-4-5' }] }).impl,
    })
    expect(live).toEqual({ models: ['claude-opus-5', 'claude-haiku-4-5'], source: 'api' })

    const offline = await modelsFor(anthropic, { apiKey: 'k', fetchImpl: fakeFetch({ status: 401 }).impl })
    expect(offline.models).toEqual(anthropic.defaultModels)
    expect(offline.source).toBe('default')
    expect(offline.error).toContain('check the API key')
  })

  it('keeps chat models out of OpenAI\'s full model list', async () => {
    const { models } = await modelsFor(getProvider('openai'), {
      apiKey: 'k',
      fetchImpl: fakeFetch({ data: [{ id: 'gpt-5' }, { id: 'text-embedding-3-large' }, { id: 'dall-e-3' }, { id: 'o3' }] }).impl,
    })
    expect(models).toEqual(['gpt-5', 'o3'])
  })
})

describe('anthropic adapter', () => {
  it('sends the direct-browser-access header, the version and tools in input_schema form', async () => {
    const { impl, calls } = fakeFetch({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn' })
    await getProvider('anthropic').send({
      model: 'claude-opus-5', apiKey: 'sk-ant-test', system: 'SYS', turns: TURNS, tools: TOOL_DEFS, fetchImpl: impl,
    })
    const [call] = calls
    expect(call.url).toBe('https://api.anthropic.com/v1/messages')
    expect(call.headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(call.headers['anthropic-version']).toBe('2023-06-01')
    expect(call.headers['x-api-key']).toBe('sk-ant-test')
    expect(call.body.system).toBe('SYS')
    expect(call.body.tools[0]).toHaveProperty('input_schema')
  })

  it('replays the assistant blocks verbatim and answers tools as tool_result', async () => {
    const { impl, calls } = fakeFetch({ content: [], stop_reason: 'end_turn' })
    await getProvider('anthropic').send({ model: 'm', apiKey: 'k', system: 's', turns: TURNS, tools: [], fetchImpl: impl })
    const msgs = calls[0].body.messages
    expect(msgs[1]).toEqual({ role: 'assistant', content: [{ type: 'raw' }] })
    expect(msgs[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"total":1}' }],
    })
  })

  it('reads text and tool_use blocks out of the reply', async () => {
    const { impl } = fakeFetch({
      content: [
        { type: 'text', text: 'let me look' },
        { type: 'tool_use', id: 'toolu_1', name: 'describe_block', input: { name: 'Jets' } },
      ],
      stop_reason: 'tool_use',
    })
    const reply = await getProvider('anthropic').send({ model: 'm', apiKey: 'k', system: 's', turns: [], tools: [], fetchImpl: impl })
    expect(reply.text).toBe('let me look')
    expect(reply.toolCalls).toEqual([{ id: 'toolu_1', name: 'describe_block', input: { name: 'Jets' } }])
    expect(reply.stopReason).toBe('tool_use')
  })

  it('turns a refusal into something the user can read', async () => {
    const { impl } = fakeFetch({ content: [], stop_reason: 'refusal', stop_details: { category: 'cyber' } })
    const reply = await getProvider('anthropic').send({ model: 'm', apiKey: 'k', system: 's', turns: [], tools: [], fetchImpl: impl })
    expect(reply.text).toContain('cyber')
    expect(reply.toolCalls).toEqual([])
  })
})

describe('openai adapter', () => {
  it('puts the system prompt first and parses tool_calls arguments', async () => {
    const { impl, calls } = fakeFetch({
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant', content: null,
          tool_calls: [{ id: 'call_1', function: { name: 'describe_block', arguments: '{"name":"Jets"}' } }],
        },
      }],
    })
    const reply = await getProvider('openai').send({
      model: 'gpt-5', apiKey: 'sk-test', system: 'SYS', turns: TURNS, tools: TOOL_DEFS, fetchImpl: impl,
    })
    expect(calls[0].headers.Authorization).toBe('Bearer sk-test')
    expect(calls[0].body.messages[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(calls[0].body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"total":1}' })
    expect(calls[0].body.tools[0].type).toBe('function')
    expect(reply.toolCalls).toEqual([{ id: 'call_1', name: 'describe_block', input: { name: 'Jets' } }])
  })

  it('survives arguments that are not valid JSON', async () => {
    const { impl } = fakeFetch({
      choices: [{ message: { tool_calls: [{ id: 'x', function: { name: 'list_blocks', arguments: 'oops' } }] } }],
    })
    const reply = await getProvider('openai').send({ model: 'm', apiKey: 'k', system: 's', turns: [], tools: [], fetchImpl: impl })
    expect(reply.toolCalls[0].input).toEqual({})
  })
})

describe('gemini adapter', () => {
  it('upper-cases schema types and drops parameterless schemas', () => {
    expect(toGeminiSchema({ type: 'object', properties: { filter: { type: 'string' } }, required: [] }))
      .toEqual({ type: 'OBJECT', properties: { filter: { type: 'STRING' } }, required: [] })
    expect(toGeminiSchema({ type: 'object', properties: {}, required: [] })).toBeNull()
  })

  it('sends contents and functionResponse parts, and reads functionCall back', async () => {
    const { impl, calls } = fakeFetch({
      candidates: [{
        finishReason: 'STOP',
        content: { role: 'model', parts: [{ text: 'ok' }, { functionCall: { name: 'list_blocks', args: { filter: 'jet' } } }] },
      }],
    })
    const reply = await getProvider('google').send({
      model: 'gemini-2.5-pro', apiKey: 'AIza', system: 'SYS', turns: TURNS, tools: TOOL_DEFS, fetchImpl: impl,
    })
    expect(calls[0].url).toContain('gemini-2.5-pro:generateContent')
    expect(calls[0].headers['x-goog-api-key']).toBe('AIza')
    expect(calls[0].body.systemInstruction.parts[0].text).toBe('SYS')
    expect(calls[0].body.contents[2].parts[0].functionResponse.name).toBe('list_blocks')
    expect(calls[0].body.tools[0].functionDeclarations.find(d => d.name === 'list_examples').parameters).toBeUndefined()
    expect(reply.text).toBe('ok')
    expect(reply.toolCalls).toEqual([{ id: 'list_blocks-0', name: 'list_blocks', input: { filter: 'jet' } }])
  })
})

describe('ollama adapter', () => {
  it('talks to localhost and needs no key', async () => {
    const { impl, calls } = fakeFetch({ message: { role: 'assistant', content: 'hello' }, done_reason: 'stop' })
    const reply = await getProvider('ollama').send({ model: 'llama3.1', system: 's', turns: TURNS, tools: [], fetchImpl: impl })
    expect(calls[0].url).toBe('http://localhost:11434/api/chat')
    expect(calls[0].headers.Authorization).toBeUndefined()
    expect(calls[0].body.stream).toBe(false)
    expect(reply.text).toBe('hello')
  })
})

describe('tool-calling capability', () => {
  /** An /api/show stand-in: models it knows about answer, the rest 404. */
  function fakeShow(known, { accepts = 'model' } = {}) {
    const calls = []
    const impl = async (url, init = {}) => {
      const body = JSON.parse(init.body)
      calls.push({ url, body })
      const name = body[accepts]
      if (!name) return { ok: false, status: 400, json: async () => ({ error: 'missing model name' }) }
      if (!(name in known)) return { ok: false, status: 404, json: async () => ({ error: 'model not found' }) }
      return { ok: true, status: 200, json: async () => known[name] }
    }
    return { impl, calls }
  }

  it('reads the capabilities array, and only a listed one counts', () => {
    expect(toolSupportFrom({ capabilities: ['completion', 'tools'] })).toBe('yes')
    expect(toolSupportFrom({ capabilities: ['completion'] })).toBe('no')
    // older builds answer /api/show without the field at all
    expect(toolSupportFrom({ model_info: {} })).toBe('unknown')
    expect(toolSupportFrom({ capabilities: [] })).toBe('unknown')
    expect(toolSupportFrom(null)).toBe('unknown')
    expect(isToolBlocked('no')).toBe(true)
    expect(isToolBlocked('yes')).toBe(false)
    expect(isToolBlocked('unknown')).toBe(false)
  })

  it('probes each local model once and marks the ones without tools', async () => {
    const { impl, calls } = fakeShow({
      'llama3:latest': { capabilities: ['completion'] },
      'llama3.1:8b': { capabilities: ['completion', 'tools'] },
    })
    const seen = []
    const caps = await probeToolSupport(getProvider('ollama'), ['llama3:latest', 'llama3.1:8b'], {
      fetchImpl: impl, onResult: (m, s) => seen.push([m, s]),
    })
    expect(caps).toEqual({ 'llama3:latest': 'no', 'llama3.1:8b': 'yes' })
    expect(calls.map(c => c.url)).toEqual(['http://localhost:11434/api/show', 'http://localhost:11434/api/show'])
    expect(calls[0].body).toEqual({ model: 'llama3:latest' })
    expect(seen).toHaveLength(2)
  })

  it('falls back to the older { name } body', async () => {
    const { impl, calls } = fakeShow({ 'llama3.1': { capabilities: ['tools'] } }, { accepts: 'name' })
    const caps = await probeToolSupport(getProvider('ollama'), ['llama3.1'], { fetchImpl: impl })
    expect(caps).toEqual({ 'llama3.1': 'yes' })
    expect(calls.map(c => Object.keys(c.body)[0])).toEqual(['model', 'name'])
  })

  it('leaves a model selectable when the probe says nothing useful', async () => {
    // no capabilities field, and a probe that fails outright: neither is a 'no'
    const quiet = fakeShow({ 'mistral:7b': { license: 'apache' } })
    expect(await probeToolSupport(getProvider('ollama'), ['mistral:7b'], { fetchImpl: quiet.impl }))
      .toEqual({ 'mistral:7b': 'unknown' })

    const offline = async () => { throw new Error('connection refused') }
    const caps = await probeToolSupport(getProvider('ollama'), ['qwen2.5'], { fetchImpl: offline })
    expect(caps).toEqual({ 'qwen2.5': 'unknown' })
    expect(isToolBlocked(caps['qwen2.5'])).toBe(false)
  })

  it('makes no request at all for a provider that cannot be asked', async () => {
    const { impl, calls } = fakeFetch()
    for (const id of ['anthropic', 'openai', 'google']) {
      expect(await probeToolSupport(getProvider(id), ['m1', 'm2'], { fetchImpl: impl })).toEqual({})
    }
    expect(calls).toHaveLength(0)
  })

  it('caps how many models a long list probes', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `m${i}`)
    const { impl, calls } = fakeShow(Object.fromEntries(many.map(m => [m, { capabilities: ['tools'] }])))
    const caps = await probeToolSupport(getProvider('ollama'), many, { fetchImpl: impl, limit: 5 })
    expect(Object.keys(caps)).toHaveLength(5)
    expect(calls).toHaveLength(5)
  })
})

describe('a model that cannot do tool calling', () => {
  it('leads with the human sentence and keeps Ollama\'s own words', async () => {
    const { impl } = fakeFetch({
      status: 400,
      body: { error: 'registry.ollama.ai/library/llama3:latest does not support tools' },
    })
    const err = await getProvider('ollama')
      .send({ model: 'llama3:latest', system: 's', turns: TURNS, tools: TOOL_DEFS, fetchImpl: impl })
      .catch(e => e)
    expect(err.noToolSupport).toBe(true)
    expect(err.model).toBe('llama3:latest')
    expect(err.message).toMatch(/^llama3:latest cannot do tool calling/)
    expect(err.message).toContain('Llama 3.1 or newer')
    expect(err.message).toContain('Ollama HTTP 400: registry.ollama.ai/library/llama3:latest does not support tools')
  })

  it('maps the hosted providers\' version of the same refusal', async () => {
    const openai = await getProvider('openai').send({
      model: 'gpt-legacy', apiKey: 'k', system: 's', turns: TURNS, tools: TOOL_DEFS,
      fetchImpl: fakeFetch({ status: 400, body: { error: { message: "'tools' is not supported with this model" } } }).impl,
    }).catch(e => e)
    expect(openai.noToolSupport).toBe(true)
    expect(openai.message).toMatch(/^gpt-legacy cannot do tool calling/)

    const gemini = await getProvider('google').send({
      model: 'gemini-old', apiKey: 'k', system: 's', turns: TURNS, tools: TOOL_DEFS,
      fetchImpl: fakeFetch({ status: 400, body: { error: { message: 'Function calling is not enabled for models/gemini-old' } } }).impl,
    }).catch(e => e)
    expect(gemini.noToolSupport).toBe(true)
  })

  it('leaves every other failure worded as before', async () => {
    const err = await getProvider('anthropic')
      .send({ model: 'm', apiKey: 'bad', system: 's', turns: TURNS, tools: TOOL_DEFS, fetchImpl: fakeFetch({ status: 401 }).impl })
      .catch(e => e)
    expect(err.noToolSupport).toBeUndefined()
    expect(err.message).toBe('Anthropic HTTP 401 \u2014 check the API key')
  })

  it('remembers the model so a hand-typed one can be warned about', () => {
    globalThis.localStorage = memoryStorage()
    expect(hasNoToolSupport('ollama', 'llama3')).toBe(false)
    rememberNoToolSupport('ollama', 'llama3')
    rememberNoToolSupport('ollama', 'llama3')
    expect(hasNoToolSupport('ollama', 'llama3')).toBe(true)
    expect(hasNoToolSupport('ollama', 'llama3.1')).toBe(false)
    expect(hasNoToolSupport('openai', 'llama3')).toBe(false)
    expect(JSON.parse(localStorage.getItem('itopcptoolkit.ai.notools.v1'))).toEqual(['ollama/llama3'])
    delete globalThis.localStorage
  })
})

describe('finishing with the tools withheld', () => {
  // chat.js asks for a final answer with no tools; an empty list is not the
  // same thing as none, and some providers reject it.
  it('omits the tool list entirely rather than sending an empty one', async () => {
    const anthropic = fakeFetch({ content: [], stop_reason: 'end_turn' })
    await getProvider('anthropic').send({ model: 'm', apiKey: 'k', system: 's', turns: TURNS, tools: [], fetchImpl: anthropic.impl })
    expect(anthropic.calls[0].body).not.toHaveProperty('tools')

    const openai = fakeFetch({ choices: [{ message: {} }] })
    await getProvider('openai').send({ model: 'm', apiKey: 'k', system: 's', turns: TURNS, tools: [], fetchImpl: openai.impl })
    expect(openai.calls[0].body).not.toHaveProperty('tools')

    const google = fakeFetch({ candidates: [{ content: { role: 'model', parts: [] } }] })
    await getProvider('google').send({ model: 'g', apiKey: 'k', system: 's', turns: [], tools: [], fetchImpl: google.impl })
    expect(google.calls[0].body).not.toHaveProperty('tools')

    const ollama = fakeFetch({ message: { content: 'hi' } })
    await getProvider('ollama').send({ model: 'l', system: 's', turns: [], tools: [], fetchImpl: ollama.impl })
    expect(ollama.calls[0].body).not.toHaveProperty('tools')
  })
})

describe('repairing a half-written transcript', () => {
  // What the old step-cap branch persisted: a tool-using turn with no results,
  // then a second assistant turn. Anthropic answered it with a 400.
  const BROKEN = [
    { role: 'user', text: 'set up jets and electrons' },
    {
      role: 'assistant', text: 'working', stopReason: 'tool_use',
      toolCalls: [{ id: 'toolu_1', name: 'propose_edits', input: {} }],
      raw: [{ type: 'tool_use', id: 'toolu_1', name: 'propose_edits', input: {} }],
    },
    { role: 'assistant', text: 'Stopped after 6 tool steps.', toolCalls: [], raw: null },
    { role: 'user', text: 'why did you stop?' },
  ]

  it('answers the orphaned call and folds the doubled assistant turn', () => {
    expect(normalizeTurns(BROKEN).map(t => t.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user'])
    expect(normalizeTurns(BROKEN)[2].results[0]).toMatchObject({ id: 'toolu_1', isError: true })
    // a sound transcript is handed back untouched
    const sound = [BROKEN[0], BROKEN[1], { role: 'tool', results: [{ id: 'toolu_1', name: 'propose_edits', output: '{}' }] }]
    expect(normalizeTurns(sound)).toEqual(sound)
  })

  it('answers a call left outstanding at the very end', () => {
    const tail = normalizeTurns([BROKEN[0], BROKEN[1]])
    expect(tail.map(t => t.role)).toEqual(['user', 'assistant', 'tool'])
    expect(tail[2].results[0].output).toContain('no result')
  })

  it('gives Anthropic a tool_result for every tool_use, with alternating roles', async () => {
    const { impl, calls } = fakeFetch({ content: [], stop_reason: 'end_turn' })
    await getProvider('anthropic').send({ model: 'm', apiKey: 'k', system: 's', turns: BROKEN, tools: [], fetchImpl: impl })
    const msgs = calls[0].body.messages
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(msgs[2].content).toEqual([
      expect.objectContaining({ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true }),
    ])
  })

  it('gives OpenAI a tool message after every assistant tool_calls message', async () => {
    const { impl, calls } = fakeFetch({ choices: [{ message: {} }] })
    await getProvider('openai').send({ model: 'm', apiKey: 'k', system: 's', turns: BROKEN, tools: [], fetchImpl: impl })
    const msgs = calls[0].body.messages
    const orphan = msgs.some((m, i) => m.tool_calls?.length && msgs[i + 1]?.role !== 'tool')
    expect(orphan).toBe(false)
  })

  it('keeps Gemini\'s contents alternating with a functionResponse for the call', async () => {
    // same shape of breakage, with Gemini's own blocks in `raw`
    const broken = BROKEN.map(t => (t.toolCalls?.length
      ? { ...t, raw: { role: 'model', parts: [{ functionCall: { name: 'propose_edits', args: {} } }] } }
      : t))
    const { impl, calls } = fakeFetch({ candidates: [{ content: { role: 'model', parts: [] } }] })
    await getProvider('google').send({ model: 'g', apiKey: 'k', system: 's', turns: broken, tools: [], fetchImpl: impl })
    const contents = calls[0].body.contents
    expect(contents.map(c => c.role)).toEqual(['user', 'model', 'user', 'model', 'user'])
    expect(contents[2].parts[0].functionResponse.name).toBe('propose_edits')
  })
})

describe('feature flag and stored connection', () => {
  afterEach(() => {
    delete globalThis.localStorage
    delete globalThis.sessionStorage
  })

  it('is off unless the build enables it, and on in a dev server', () => {
    expect(aiEnabled({})).toBe(false)
    expect(aiEnabled({ DEV: true })).toBe(true)
    expect(aiEnabled({ VITE_AI_ENABLED: '1' })).toBe(true)
    expect(aiEnabled({ VITE_AI_ENABLED: 'true' })).toBe(true)
    expect(aiEnabled({ VITE_AI_ENABLED: '0', DEV: true })).toBe(false)
  })

  it('keeps the key in sessionStorage and the provider choice in localStorage', () => {
    globalThis.localStorage = memoryStorage()
    globalThis.sessionStorage = memoryStorage()

    expect(loadConnection()).toBeNull()
    savePrefs({ provider: 'anthropic', model: 'claude-opus-5' })
    expect(localStorage.getItem('itopcptoolkit.ai.v1')).toContain('claude-opus-5')

    // remembered provider but no key (a fresh tab) is not a usable connection
    expect(loadConnection()).toBeNull()

    saveKey('anthropic', 'sk-ant-secret')
    expect(localStorage.getItem('itopcptoolkit.ai.key.anthropic')).toBeNull()
    expect(loadConnection()).toEqual({ provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-ant-secret' })

    clearKey('anthropic')
    expect(loadConnection()).toBeNull()
  })

  it('needs no key for a keyless provider', () => {
    globalThis.localStorage = memoryStorage()
    globalThis.sessionStorage = memoryStorage()
    savePrefs({ provider: 'ollama', model: 'llama3.1' })
    expect(loadConnection()).toEqual({ provider: 'ollama', model: 'llama3.1', apiKey: '' })
  })
})
