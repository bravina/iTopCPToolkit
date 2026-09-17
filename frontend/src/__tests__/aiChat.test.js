import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { runAssistantTurn, userTurn, leakedToolCall, MAX_TOOL_STEPS, TEXT_CALL_NOTICE } from '../ai/chat.js'
import { Turn, followUpsWanted } from '../components/AiChatPanel.jsx'
import { getProvider } from '../ai/providers.js'
import { buildSystemPrompt } from '../ai/systemPrompt.js'
import { createTools } from '../ai/tools.js'
import { effectiveBlocks } from '../utils/schema.js'
import { initialConfig } from '../utils/configState.js'
import { buildRegistryFromState } from '../utils/collectionRegistry.js'
import { SCHEMA } from './fixtures/schema.js'

/** A provider whose replies are scripted; records what each request contained. */
function scriptedProvider(...replies) {
  const seen = []
  return {
    seen,
    send: async ({ turns, tools, system }) => {
      seen.push({ turns: [...turns], toolNames: tools.map(t => t.name), system })
      const next = replies.shift()
      if (next instanceof Error) throw next
      return { text: '', toolCalls: [], raw: null, stopReason: 'end_turn', ...next }
    },
  }
}

function liveTools() {
  const config = initialConfig(SCHEMA.blocks)
  const blocks = effectiveBlocks(SCHEMA.blocks, [])
  return createTools({ schema: SCHEMA, config, blocks, registry: buildRegistryFromState(config, blocks) })
}

const run = (provider, tools, turns, extra = {}) => runAssistantTurn({
  provider, tools, turns, model: 'm', apiKey: 'k', system: 'SYS', ...extra,
})

/** An Anthropic-shaped tool-calling reply, so the transcript can be replayed. */
function toolReply(id, name = 'list_blocks') {
  return {
    text: '',
    toolCalls: [{ id, name, input: {} }],
    raw: [{ type: 'tool_use', id, name, input: {} }],
    stopReason: 'tool_use',
  }
}

function abortError() {
  const err = new Error('The operation was aborted.')
  err.name = 'AbortError'
  return err
}

/** What an adapter would actually put on the wire for this transcript. */
async function wireBody(providerId, turns) {
  let body = null
  const fetchImpl = async (url, init) => {
    body = JSON.parse(init.body)
    return { ok: true, status: 200, json: async () => ({ content: [], choices: [{ message: {} }], candidates: [], message: {} }) }
  }
  await getProvider(providerId).send({ model: 'm', apiKey: 'k', system: 's', turns, tools: [], fetchImpl })
  return body
}

/** tool_use ids with no tool_result in the very next message — the 400 we hit. */
function orphanToolUse(messages) {
  const orphans = []
  messages.forEach((msg, i) => {
    const uses = Array.isArray(msg.content) ? msg.content.filter(b => b.type === 'tool_use') : []
    const next = messages[i + 1]
    const answered = Array.isArray(next?.content)
      ? next.content.filter(b => b.type === 'tool_result').map(b => b.tool_use_id)
      : []
    for (const use of uses) if (!answered.includes(use.id)) orphans.push(use.id)
  })
  return orphans
}

const rolesAlternate = msgs => msgs.every((m, i) => i === 0 || m.role !== msgs[i - 1].role)

describe('runAssistantTurn', () => {
  it('returns a plain answer without touching the tools', async () => {
    const provider = scriptedProvider({ text: 'Jets owns JVT.' })
    const added = await run(provider, liveTools(), [userTurn('who owns JVT?')])
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({ role: 'assistant', text: 'Jets owns JVT.' })
    expect(provider.seen).toHaveLength(1)
    expect(provider.seen[0].toolNames).toContain('describe_block')
  })

  it('answers a tool call from the schema and feeds the result back', async () => {
    const provider = scriptedProvider(
      { text: 'looking', toolCalls: [{ id: 't1', name: 'describe_block', input: { name: 'Jets' } }] },
      { text: 'jetCollection is a str with no default.' },
    )
    const added = await run(provider, liveTools(), [userTurn('what type is Jets.jetCollection?')])

    expect(added.map(t => t.role)).toEqual(['assistant', 'tool', 'assistant'])
    const [result] = added[1].results
    expect(result).toMatchObject({ id: 't1', name: 'describe_block', isError: false })
    expect(JSON.parse(result.output).options.some(o => o.name === 'jetCollection')).toBe(true)

    // the second request carries the whole transcript, tool result included
    expect(provider.seen[1].turns.map(t => t.role)).toEqual(['user', 'assistant', 'tool'])
  })

  it('runs several calls from one reply and keeps their ids', async () => {
    const provider = scriptedProvider(
      {
        toolCalls: [
          { id: 'a', name: 'list_blocks', input: { category: 'Output' } },
          { id: 'b', name: 'validate_config', input: {} },
        ],
      },
      { text: 'done' },
    )
    const added = await run(provider, liveTools(), [userTurn('status?')])
    expect(added[1].results.map(r => r.id)).toEqual(['a', 'b'])
    expect(added[1].results.every(r => !r.isError)).toBe(true)
  })

  it('hands a failed tool back as an error result instead of throwing', async () => {
    const provider = scriptedProvider(
      { toolCalls: [{ id: 'x', name: 'describe_block', input: { name: 'NoSuchBlock' } }] },
      { text: 'That block does not exist in this release.' },
    )
    const added = await run(provider, liveTools(), [userTurn('describe NoSuchBlock')])
    expect(added[1].results[0]).toMatchObject({ isError: true })
    expect(added[1].results[0].output).toContain('No block named')
    expect(added[2].text).toContain('does not exist')
  })

  it('stops after the step cap and answers from what it gathered', async () => {
    const provider = scriptedProvider(
      toolReply('toolu_1'), toolReply('toolu_2'), toolReply('toolu_3'),
      { text: 'Jets and Electrons are the two you need.', raw: [{ type: 'text', text: 'done' }] },
    )
    const added = await run(provider, liveTools(), [userTurn('loop')], { maxSteps: 3 })

    // three tool steps, then one last request with the tools withheld
    expect(provider.seen).toHaveLength(4)
    expect(provider.seen[3].toolNames).toEqual([])
    expect(added.map(t => t.role)).toEqual(['assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant'])
    expect(added.at(-1)).toMatchObject({
      stopReason: 'max_tool_steps',
      text: 'Jets and Electrons are the two you need.',
    })
    expect(added.at(-1).notice).toContain('3-step')
  })

  it('leaves a capped exchange replayable, with every tool_use answered', async () => {
    const provider = scriptedProvider(
      toolReply('toolu_1'), toolReply('toolu_2'),
      { text: 'Here is the summary.', raw: [{ type: 'text', text: 'Here is the summary.' }] },
    )
    const base = [userTurn('set up jets and electrons')]
    const added = await run(provider, liveTools(), base, { maxSteps: 2 })

    const next = [...base, ...added, userTurn('now the electrons')]
    const { messages } = await wireBody('anthropic', next)
    expect(orphanToolUse(messages)).toEqual([])
    expect(rolesAlternate(messages)).toBe(true)
  })

  it('answers the outstanding calls when the user stops mid-exchange', async () => {
    const controller = new AbortController()
    const provider = scriptedProvider(toolReply('toolu_stop'))
    const tools = { defs: [], run: async () => { controller.abort(); throw abortError() } }
    const live = []
    await expect(run(provider, tools, [userTurn('go')], {
      signal: controller.signal, onTurn: t => live.push(t),
    })).rejects.toThrow(/aborted/)

    expect(live.map(t => t.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(live[1].results[0]).toMatchObject({ id: 'toolu_stop', isError: true })
    expect(live[1].results[0].output).toContain('Stopped by the user')
    expect(live.at(-1).notice).toContain('Stopped at your request')

    const { messages } = await wireBody('anthropic', [userTurn('go'), ...live, userTurn('what happened?')])
    expect(orphanToolUse(messages)).toEqual([])
    expect(rolesAlternate(messages)).toBe(true)
  })

  it('closes the exchange off when a tool run throws', async () => {
    const provider = scriptedProvider(toolReply('toolu_boom'))
    const tools = { defs: [], run: async () => { throw new Error('boom') } }
    const live = []
    await expect(run(provider, tools, [userTurn('go')], { onTurn: t => live.push(t) })).rejects.toThrow('boom')

    expect(live.map(t => t.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(live[1].results[0].output).toContain('boom')
    expect(live.at(-1).notice).toContain('error')

    const { messages } = await wireBody('anthropic', [userTurn('go'), ...live, userTurn('retry')])
    expect(orphanToolUse(messages)).toEqual([])
  })

  it('closes the exchange off when the provider fails mid-loop', async () => {
    const provider = scriptedProvider(toolReply('toolu_1'), new Error('Anthropic HTTP 500'))
    const live = []
    await expect(run(provider, liveTools(), [userTurn('go')], { onTurn: t => live.push(t) }))
      .rejects.toThrow('HTTP 500')
    expect(live.map(t => t.role)).toEqual(['assistant', 'tool', 'assistant'])
    const { messages } = await wireBody('anthropic', [userTurn('go'), ...live, userTurn('retry')])
    expect(orphanToolUse(messages)).toEqual([])
    expect(rolesAlternate(messages)).toBe(true)
  })

  it('leaves room for a multi-container setup with a rejected proposal', () => {
    expect(MAX_TOOL_STEPS).toBeGreaterThanOrEqual(10)
  })

  it('reports each turn as it is appended and lets the caller\'s history stand', async () => {
    const seenLive = []
    const turns = [userTurn('hi')]
    const provider = scriptedProvider(
      { toolCalls: [{ id: 't', name: 'current_config', input: {} }] },
      { text: 'nothing enabled yet' },
    )
    await run(provider, liveTools(), turns, { onTurn: t => seenLive.push(t.role) })
    expect(seenLive).toEqual(['assistant', 'tool', 'assistant'])
    expect(turns).toHaveLength(1)     // the caller's array is never mutated
  })

  it('carries a proposal on the tool result without showing the model the state', async () => {
    const provider = scriptedProvider(
      { toolCalls: [{ id: 'p1', name: 'propose_edits', input: {
        summary: 'Enable Jets',
        operations: [{ type: 'SET_BLOCK_ENABLED', name: 'Jets', enabled: true }],
      } }] },
      { text: 'Proposed — press Apply to accept it.' },
    )
    const added = await run(provider, liveTools(), [userTurn('enable Jets please')])
    const [result] = added[1].results
    expect(result.isError).toBe(false)
    expect(result.proposal.actions).toEqual([{ type: 'SET_BLOCK_ENABLED', name: 'Jets', enabled: true }])
    expect(JSON.parse(result.output).status).toContain('has NOT changed')
    expect(result.output).not.toContain('_id')
  })

  it('lets a provider failure surface to the caller', async () => {
    const provider = scriptedProvider(new Error('Anthropic HTTP 401: bad key'))
    await expect(run(provider, liveTools(), [userTurn('hi')])).rejects.toThrow('HTTP 401')
  })
})

describe('buildSystemPrompt', () => {
  it('names the release and binds factual claims to tool results', () => {
    const prompt = buildSystemPrompt({ schema: { versions: { ab: '25.2.110', tct: 'v3.7.0' } }, mode: 'builder' })
    expect(prompt).toContain('AnalysisBase 25.2.110')
    expect(prompt).toContain('TopCPToolkit v3.7.0')
    expect(prompt).toContain('builder mode')
    expect(prompt).toMatch(/must come from a tool result/)
    expect(prompt).toContain('describe_block')
    expect(prompt).toContain('validate_config')
  })

  it('says so when the image has no TopCPToolkit, and never mandates a refusal', () => {
    const prompt = buildSystemPrompt({ schema: { versions: { ab: '25.2.110', tct: null } } })
    expect(prompt).toContain('no TopCPToolkit in this image')
    expect(prompt).not.toMatch(/refuse|I'm sorry/i)
  })
})

// The exact blob a llama3.1:8b run put in front of a user, invented tool name
// and all.
const PRINTED_CALL = '{"name": "describe_config", "parameters": {"includeGeneric":"true"}}'

/** A text reply, shaped the way an adapter would hand it back. */
const textReply = text => ({ text, toolCalls: [], raw: [{ type: 'text', text }], stopReason: 'stop' })

describe('leakedToolCall', () => {
  it('spots a call printed as the whole message', () => {
    expect(leakedToolCall(PRINTED_CALL)).toEqual({ name: 'describe_config', body: '' })
  })

  it('keeps the prose and takes only the trailing blob', () => {
    const leak = leakedToolCall('Let me look that up.\n\n{"name":"describe_block","arguments":{"name":"Jets"}}')
    expect(leak).toEqual({ name: 'describe_block', body: 'Let me look that up.' })
  })

  it('sees through the wrappers and tags the text-mode models use', () => {
    expect(leakedToolCall('{"tool_call": {"name": "list_blocks", "arguments": {}}}').name).toBe('list_blocks')
    expect(leakedToolCall('{"type":"function","function":{"name":"validate_config","arguments":"{}"}}').name)
      .toBe('validate_config')
    expect(leakedToolCall('<tool_call>\n{"name":"current_config","parameters":{}}\n</tool_call>').name)
      .toBe('current_config')
  })

  it('leaves JSON the answer is deliberately showing alone', () => {
    const fenced = 'A proposal looks like this:\n\n```json\n{"name":"propose_edits","parameters":{"summary":"x"}}\n```'
    expect(leakedToolCall(fenced)).toBeNull()
    expect(leakedToolCall('Send `{"name":"describe_block","arguments":{}}` to look one up.')).toBeNull()
  })

  it('leaves anything that is not shaped like a call alone', () => {
    expect(leakedToolCall('{"name":"Jets"}')).toBeNull()                                  // no arguments
    expect(leakedToolCall('{"name":"Jets","parameters":{},"enabled":true}')).toBeNull()    // a key too many
    expect(leakedToolCall('{"name":"x","parameters":{}} — and that is why.')).toBeNull()   // not the remainder
    expect(leakedToolCall('Jets owns JVT.')).toBeNull()
    expect(leakedToolCall('')).toBeNull()
  })
})

describe('a tool call printed as text', () => {
  it('is never shown as the answer, and the model is told which tools exist', async () => {
    const provider = scriptedProvider(textReply(PRINTED_CALL), textReply('Jets owns JVT.'))
    const added = await run(provider, liveTools(), [userTurn('what is in Jets?')])

    expect(added.map(t => t.role)).toEqual(['assistant', 'user', 'assistant'])
    expect(added[0]).toMatchObject({ text: '', leakedCall: 'describe_config', stopReason: 'text_tool_call' })
    expect(added[1]).toMatchObject({ role: 'user', hidden: true })
    expect(added[1].text).toContain('no tool called "describe_config"')
    expect(added[1].text).toContain('describe_block')
    expect(added.at(-1).text).toBe('Jets owns JVT.')
    // nothing the panel would render carries the JSON
    expect(added.filter(t => !t.hidden).some(t => (t.text || '').includes('describe_config'))).toBe(false)
  })

  it('keeps whatever prose came with it', async () => {
    const provider = scriptedProvider(
      textReply(`Looking that up.\n\n${PRINTED_CALL}`), textReply('done'))
    const added = await run(provider, liveTools(), [userTurn('go')])
    expect(added[0].text).toBe('Looking that up.')
  })

  it('leaves the transcript replayable, with the correction in it', async () => {
    const provider = scriptedProvider(textReply(PRINTED_CALL), textReply('Jets owns JVT.'))
    const base = [userTurn('what is in Jets?')]
    const added = await run(provider, liveTools(), base)

    expect(provider.seen[1].turns.map(t => t.role)).toEqual(['user', 'assistant', 'user'])
    const { messages } = await wireBody('anthropic', [...base, ...added, userTurn('and electrons?')])
    expect(orphanToolUse(messages)).toEqual([])
    expect(rolesAlternate(messages)).toBe(true)
  })

  it('gives up on a notice rather than on silence when it happens twice', async () => {
    const provider = scriptedProvider(textReply(PRINTED_CALL), textReply(PRINTED_CALL))
    const added = await run(provider, liveTools(), [userTurn('go')])

    expect(provider.seen).toHaveLength(2)          // corrected once, not again
    expect(added.map(t => t.role)).toEqual(['assistant', 'user', 'assistant'])
    expect(added.at(-1)).toMatchObject({ text: '', notice: TEXT_CALL_NOTICE, leakedCall: 'describe_config' })
  })

  it('is stripped from the answer written after the step cap too', async () => {
    const provider = scriptedProvider(
      textReply(PRINTED_CALL), textReply(`Nothing came back.\n\n${PRINTED_CALL}`))
    const added = await run(provider, liveTools(), [userTurn('go')], { maxSteps: 1 })

    expect(provider.seen).toHaveLength(2)
    expect(provider.seen[1].toolNames).toEqual([])  // the tools-withheld request still works
    expect(added.at(-1)).toMatchObject({ text: 'Nothing came back.', stopReason: 'max_tool_steps', raw: null })
    expect(added.at(-1).notice).toContain('1-step')
  })

  it('leaves a normal answer that contains a fenced example untouched', async () => {
    const answer = 'A proposal looks like:\n\n```json\n{"name":"propose_edits","parameters":{"summary":"x"}}\n```'
    const provider = scriptedProvider(textReply(answer))
    const added = await run(provider, liveTools(), [userTurn('what does a proposal look like?')])
    expect(added).toHaveLength(1)
    expect(added[0].text).toBe(answer)
    expect(added[0].leakedCall).toBeUndefined()
  })
})

describe('follow-up chips', () => {
  const answer = 'JVT suppresses pileup jets.\n\nFollow-ups:\n- why is the default 25 GeV?'
  const didactic = extra => ({ role: 'assistant', persona: 'didactic', text: answer, ...extra })
  const failedTools = { role: 'tool', results: [{ id: 't', name: 'describe_block', isError: true, output: 'Error: no such option' }] }

  const render = (turn, prev) => renderToStaticMarkup(createElement(Turn, {
    turn, decisions: {}, currentKey: '', followUpsLive: true,
    followUpsOk: followUpsWanted(turn, prev), onAsk: () => {},
  }))

  it('are offered under a good didactic answer', () => {
    const html = render(didactic())
    expect(html).toContain('why is the default 25 GeV?')
    expect(html).toContain('JVT suppresses pileup jets')
  })

  it('are not offered under an answer built on a tool call that failed', () => {
    const html = render(didactic(), failedTools)
    expect(html).toContain('JVT suppresses pileup jets')
    expect(html).not.toContain('why is the default 25 GeV?')
  })

  it('are not offered on a notice-only or rescued turn', () => {
    expect(followUpsWanted(didactic({ notice: 'Answered after the 12-step tool limit.' }))).toBe(false)
    expect(followUpsWanted(didactic({ leakedCall: 'describe_config' }))).toBe(false)
    expect(followUpsWanted({ role: 'assistant', persona: 'didactic', text: '', notice: 'Stopped at your request.' }))
      .toBe(false)
    // a partly successful tool step is still something to go deeper into
    expect(followUpsWanted(didactic(), {
      role: 'tool',
      results: [{ id: 'a', isError: true }, { id: 'b', isError: false }],
    })).toBe(true)
  })

  it('never turn the follow-up list back into body markup when suppressed', () => {
    expect(render(didactic(), failedTools)).not.toContain('Follow-ups')
  })

  it('renders the loop\'s corrective turn as nothing at all', () => {
    expect(render({ role: 'user', hidden: true, text: 'That was not a tool call — …' })).toBe('')
  })
})
