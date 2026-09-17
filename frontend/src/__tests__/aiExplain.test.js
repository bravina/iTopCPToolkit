import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  blockLocator, buildExplainTarget, explainLabel, explainQuestion, locatorFromPath,
  optionLocator, splitFollowUps,
} from '../ai/explain.js'
import { buildSystemPrompt } from '../ai/systemPrompt.js'
import { panelTools } from '../components/AiChatPanel.jsx'
import { ExplainAction } from '../components/InfoPopover.jsx'
import AnnotatedYamlView from '../components/AnnotatedYamlView.jsx'
import { ExplainProvider } from '../contexts/ExplainContext.js'
import { effectiveBlocks } from '../utils/schema.js'
import { initialConfig } from '../utils/configState.js'
import { buildRegistryFromState } from '../utils/collectionRegistry.js'
import { SCHEMA } from './fixtures/schema.js'

const BLOCKS = effectiveBlocks(SCHEMA.blocks, [])

/** A loaded file, the way Reader holds it — and what Builder serialises to. */
const CONFIG = {
  Jets: [{
    containerName: 'AnaJets',
    jetCollection: 'AntiKt4EMPFlow',
    runJvtSelection: false,
    ptCuts: [25000, 30000],
    JVT: [{ selectionName: 'jvt' }],
  }],
  Electrons: { containerName: 'AnaElectrons' },
}

const target = (locator, configObj = CONFIG) =>
  buildExplainTarget({ locator, blocks: BLOCKS, configObj })

describe('buildSystemPrompt personas', () => {
  it('defaults to the terse chat-box persona', () => {
    const fallback = buildSystemPrompt({ schema: SCHEMA, mode: 'builder' })
    expect(fallback).toBe(buildSystemPrompt({ schema: SCHEMA, mode: 'builder', persona: 'terse' }))
    expect(fallback).toContain('You are here for synthesis')
    expect(fallback).not.toContain('Explain this')
    expect(fallback).not.toContain('Follow-ups:')
  })

  it('keeps the tool-grounding and proposal rules in the didactic persona', () => {
    const prompt = buildSystemPrompt({ schema: SCHEMA, mode: 'builder', persona: 'didactic' })
    expect(prompt).toContain('must come from a tool result in this conversation, not from memory')
    expect(prompt).toContain('propose_edits')
    expect(prompt).toContain('what it does, mechanically')
    expect(prompt).toContain('why it matters physically')
    expect(prompt).toContain('what people typically choose')
    expect(prompt).toContain('what quietly breaks')
  })

  // The point of the whole feature: a student cannot catch a confident wrong
  // claim, so the answer has to say which sentences are checkable.
  it('makes the didactic persona separate the two registers', () => {
    const prompt = buildSystemPrompt({ schema: SCHEMA, persona: 'didactic' })
    expect(prompt).toContain('SEPARATE THE TWO REGISTERS, VISIBLY, IN THE ANSWER ITSELF')
    expect(prompt).toContain('from describe_block, from current_config and from reviewed')
    expect(prompt).toContain('**Background — from general knowledge, verify before relying on it:**')
    expect(prompt).toContain('keep every unsourced claim below that line')
    expect(prompt).toContain('never attribute background to the toolkit')
    expect(prompt).toContain('ATLAS specifics')
  })

  it('makes the didactic persona use the glossary without trusting it blindly', () => {
    const prompt = buildSystemPrompt({ schema: SCHEMA, persona: 'didactic' })
    expect(prompt).toContain('explain_concept')
    expect(prompt).toContain('reviewed: false')
    expect(prompt).toContain('not yet reviewed')
  })

  it('asks the didactic persona for two or three follow-ups, in one parseable form', () => {
    const prompt = buildSystemPrompt({ schema: SCHEMA, persona: 'didactic' })
    expect(prompt).toContain('two or three follow-up questions')
    expect(prompt).toContain('\nFollow-ups:\n- why is the default 25 GeV?')
  })

  // A failed call once became "there is no runSystematics option in CommonServices".
  it('tells both personas that a failed tool call is not evidence of absence', () => {
    for (const persona of ['terse', 'didactic']) {
      const prompt = buildSystemPrompt({ schema: SCHEMA, mode: 'builder', persona })
      expect(prompt).toContain('means your call was wrong')
      expect(prompt).toContain('A failed call is never evidence of absence')
      expect(prompt).toContain('{ block, option }')
      expect(prompt).toContain('"Block.option" is not a sub-block')
    }
  })

  it('makes the resolved fact sheet authoritative for the clicked target', () => {
    const prompt = buildSystemPrompt({ schema: SCHEMA, persona: 'didactic' })
    expect(prompt).toContain('For that option or block it is authoritative')
    expect(prompt).toContain('describe_block is for looking up *other* things')
    expect(prompt).toContain('never report the thing as')
  })

  it('tells Reader it cannot edit, and drops the proposal rules there', () => {
    const prompt = buildSystemPrompt({ schema: SCHEMA, mode: 'reader', persona: 'didactic' })
    expect(prompt).toContain('read-only inspector')
    expect(prompt).toContain('Open in Builder')
    expect(prompt).not.toContain('propose_edits')
  })
})

describe('locators', () => {
  it('reads an annotated-YAML path back into a locator', () => {
    expect(locatorFromPath('Jets')).toEqual({ kind: 'block', blockName: 'Jets' })
    expect(locatorFromPath('Jets[0].minPt')).toMatchObject(
      { kind: 'option', blockName: 'Jets', optionName: 'minPt', subName: null, instance: 0 })
    expect(locatorFromPath('Jets[1].JVT[0].selectionName')).toMatchObject(
      { kind: 'option', blockName: 'Jets', optionName: 'selectionName', subName: 'JVT', instance: 1 })
    expect(locatorFromPath('')).toBe(null)
  })
})

describe('buildExplainTarget', () => {
  it('assembles the schema entry, the value set and the rest of the block', () => {
    const t = target(optionLocator({ blockName: 'Jets', optionName: 'runJvtSelection' }))
    expect(t.kind).toBe('option')
    expect(t.block).toMatchObject({ name: 'Jets', known: true })
    expect(t.block.classes).toEqual(['PreJets', 'SmallRJets', 'LargeRJets'])
    expect(t.option).toMatchObject({
      name: 'runJvtSelection', type: 'bool', default: true, declaredBy: 'SmallRJets',
      required: false, expert: false, choices: null, role: null,
    })
    // set, and not what the factory would have used
    expect(t.value).toEqual({ set: true, current: false, matchesDefault: false })
    expect(t.siblings.map(s => s.name)).toEqual(['containerName', 'jetCollection', 'ptCuts'])
    expect(t.path).toBe('Jets.runJvtSelection')
  })

  it('carries choices, units and the meta role through', () => {
    const jes = target(optionLocator({ blockName: 'Jets', optionName: 'systematicsModelJES' }))
    expect(jes.option.choices).toEqual(['All', 'Category'])
    const pt = target(optionLocator({ blockName: 'Jets', optionName: 'minPt' }))
    expect(pt.option).toMatchObject({ unit: 'MeV', default: 25000.0, declaredBy: 'LargeRJets' })
    expect(pt.value).toEqual({ set: false, current: null, matchesDefault: true })
    const sel = target(locatorFromPath('Jets[0].JVT[0].selectionName'))
    expect(sel.sub).toMatchObject({ name: 'JVT' })
    expect(sel.option).toMatchObject({ name: 'selectionName', role: 'selection', default: 'jvt' })
    expect(sel.value).toEqual({ set: true, current: 'jvt', matchesDefault: true })
  })

  it('prefers the value the caller clicked on over the serialised one', () => {
    const t = target(optionLocator({ blockName: 'Jets', optionName: 'minPt', value: 30000 }))
    expect(t.value).toEqual({ set: true, current: 30000, matchesDefault: false })
  })

  it('describes a block, with the options it actually sets', () => {
    const t = target(blockLocator('Jets'))
    expect(t.kind).toBe('block')
    expect(t.option).toBe(null)
    expect(t.block.docstring).toBe('')          // the fixture's group classes have none
    expect(t.siblings.map(s => s.name)).toContain('jetCollection')
    // sub-block mappings are not options
    expect(t.siblings.map(s => s.name)).not.toContain('JVT')
  })

  it('says so rather than inventing an entry the release does not have', () => {
    const t = target(optionLocator({ blockName: 'Jets', optionName: 'nonesuch' }))
    expect(t.known).toBe(false)
    expect(t.option).toEqual({ name: 'nonesuch', known: false })
    expect(explainQuestion(t)).toContain('notInThisRelease: true')
  })
})

describe('explainQuestion', () => {
  const t = target(optionLocator({ blockName: 'Jets', optionName: 'runJvtSelection' }))
  const question = explainQuestion(t)

  it('asks plainly and attaches the resolved facts as YAML', () => {
    expect(question).toContain('Explain the `runJvtSelection` option of `Jets`')
    expect(question).toContain('```yaml')
    expect(question).toContain('option: runJvtSelection')
    expect(question).toContain('type: bool')
    expect(question).toContain('default: true')
    expect(question).toContain('declaredBy: SmallRJets')
    expect(question).toContain('currentValue: false')
    expect(question).toContain('differsFromDefault: true')
    expect(question).toContain('alsoSetInThisBlock:')
    expect(question).toContain('jetCollection: AntiKt4EMPFlow')
  })

  it('labels the turn by what was clicked, not by the fact sheet', () => {
    expect(explainLabel(t)).toBe('Explain Jets.runJvtSelection')
    expect(explainLabel(target(blockLocator('Jets')))).toBe('Explain the Jets block')
  })
})

describe('splitFollowUps', () => {
  it('takes the trailing offer off the answer', () => {
    const { body, followUps } = splitFollowUps(
      'JVT suppresses pileup jets.\n\nFollow-ups:\n- why is the default 25 GeV?\n- what breaks if I turn this off?\n')
    expect(body).toBe('JVT suppresses pileup jets.')
    expect(followUps).toEqual(['why is the default 25 GeV?', 'what breaks if I turn this off?'])
  })

  it('accepts the heading the model is likely to write, and offers at most three', () => {
    const { body, followUps } = splitFollowUps(
      'Answer.\n\n**Follow-ups**\n1. one\n2. two\n3. three\n4. four\n')
    expect(body).toBe('Answer.')
    expect(followUps).toEqual(['one', 'two', 'three'])
  })

  it('leaves an ordinary answer alone', () => {
    const plain = 'Set `jetCollection` first:\n- AntiKt4EMPFlow\n- AntiKt4EMTopo\n'
    expect(splitFollowUps(plain)).toEqual({ body: plain, followUps: [] })
    expect(splitFollowUps('Just a sentence.').followUps).toEqual([])
    expect(splitFollowUps(undefined)).toEqual({ body: '', followUps: [] })
  })
})

describe('the panel tool set', () => {
  const builderCtx = () => {
    const config = initialConfig(SCHEMA.blocks)
    const blocks = effectiveBlocks(SCHEMA.blocks, [])
    return { schema: SCHEMA, config, blocks, registry: buildRegistryFromState(config, blocks) }
  }

  it('gives Builder the proposal tools, over its reducer state', () => {
    const tools = panelTools(builderCtx())
    expect(tools.configShape).toBe('state')
    expect(tools.names).toContain('propose_edits')
    expect(tools.names).toContain('propose_config')
  })

  // Reader is an inspector: there is nothing to apply a proposal to.
  it('withholds them from Reader, and binds the tools to the loaded file', async () => {
    const tools = panelTools({ schema: SCHEMA, configObj: CONFIG, blocks: BLOCKS, readOnly: true })
    expect(tools.configShape).toBe('yaml')
    expect(tools.names).not.toContain('propose_edits')
    expect(tools.names).not.toContain('propose_config')
    expect(tools.defs.map(d => d.name)).not.toContain('propose_edits')
    expect(tools.names).toContain('describe_block')
    expect(tools.names).toContain('explain_concept')
    const { result } = await tools.run('current_config', {})
    expect(result.yaml).toContain('AntiKt4EMPFlow')
    expect((await tools.run('propose_edits', {})).ok).toBe(false)
  })
})

describe('the Explain action in the info bubble', () => {
  const render = props => renderToStaticMarkup(
    createElement(ExplainAction, { locator: blockLocator('Jets'), ...props }))

  it('asks when the assistant is connected', () => {
    const html = render({ status: 'ready' })
    expect(html).toContain('Explain this')
    expect(html).not.toContain('connect an assistant')
    expect(html).toContain('on your own API key')
  })

  it('offers to connect instead of sitting there dead', () => {
    const html = render({ status: 'disconnected' })
    expect(html).toContain('Explain this')
    expect(html).toContain('connect an assistant')
  })

  it('is absent when the build has no assistant, or nothing was resolved', () => {
    expect(render({ status: 'off' })).toBe('')
    expect(render({ status: 'ready', locator: null })).toBe('')
  })
})

describe('the annotated YAML view', () => {
  const render = status => renderToStaticMarkup(createElement(
    ExplainProvider, { value: { status, explain: () => {}, connect: () => {} } },
    createElement(AnnotatedYamlView, { configObj: CONFIG, blocks: BLOCKS })))

  // Reader's block headers carry no docstring in this fixture, so the bubble
  // is there only because there is something to explain.
  it('gives every schema-known line something to click when the assistant is there', () => {
    const on = render('ready')
    const off = render('off')
    const bubbles = html => (html.match(/aria-label="Show help"/g) || []).length
    expect(bubbles(on)).toBeGreaterThan(bubbles(off))
    // and the line layout keeps its spacer where no bubble is shown
    expect(off).toContain('w-[1.1rem]')
  })
})
