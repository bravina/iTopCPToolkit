import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import AiProposalCard from '../components/AiProposalCard.jsx'
import DiffView from '../components/DiffView.jsx'
import {
  OP_TYPES, applyOperations, compileOperations, proposeConfig, proposeOperations,
} from '../ai/proposals.js'
import { createTools } from '../ai/tools.js'
import { effectiveBlocks } from '../utils/schema.js'
import { initialConfig } from '../utils/configState.js'
import { buildYamlObject } from '../utils/yamlSerializer.js'
import { buildRegistryFromState } from '../utils/collectionRegistry.js'
import { SCHEMA } from './fixtures/schema.js'

function ctx(mutate = () => {}) {
  const config = initialConfig(SCHEMA.blocks)
  mutate(config)
  return { config, blocks: effectiveBlocks(SCHEMA.blocks, config.addConfigBlocks), schema: SCHEMA }
}

/** Compile+offer, asserting the model got no error back. */
function propose(operations, mutate) {
  return proposeOperations({ operations, summary: 'test', ...ctx(mutate) })
}

const enableJets = { type: 'SET_BLOCK_ENABLED', name: 'Jets', enabled: true }

describe('the patch vocabulary', () => {
  it('speaks the reducer\'s actions and lands them in the YAML', () => {
    const p = propose([
      enableJets,
      { type: 'SET_OPTION', blockName: 'Jets', key: 'containerName', value: 'AnaJets' },
      { type: 'TOGGLE_SUB_BLOCK', blockName: 'Jets', subName: 'JVT' },
      { type: 'SET_SUB_OPTION', blockName: 'Jets', subName: 'JVT', key: 'selectionName', value: 'myjvt' },
    ])
    expect(p.kind).toBe('edits')
    expect(p.actions.map(a => a.type)).toEqual(
      ['SET_BLOCK_ENABLED', 'SET_OPTION', 'TOGGLE_SUB_BLOCK', 'SET_SUB_OPTION'])
    expect(p.actions[1].instanceId).toBe(p.state.blocks.Jets.instances[0]._id)
    expect(p.configObj).toEqual({ Jets: [{ containerName: 'AnaJets', JVT: [{ selectionName: 'myjvt' }] }] })
    expect(p.labels).toEqual([
      'enable block Jets',
      "Jets[0].containerName = 'AnaJets'",
      'toggle Jets[0].JVT',
      "Jets[0].JVT[0].selectionName = 'myjvt'",
    ])
    expect(p.stats.added).toBeGreaterThan(0)
  })

  it('accepts every operation type, each seeing what the previous ones left', () => {
    const ops = [
      enableJets,
      { type: 'ADD_INSTANCE', blockName: 'Jets' },
      { type: 'SET_OPTION', blockName: 'Jets', instanceId: '1', key: 'containerName', value: 'AnaLargeJets' },
      { type: 'UNSET_OPTION', blockName: 'Jets', instanceId: '1', key: 'containerName' },
      { type: 'REMOVE_INSTANCE', blockName: 'Jets', instanceId: '1' },
      { type: 'TOGGLE_SUB_BLOCK', blockName: 'Jets', subName: 'PtEtaSelection' },
      { type: 'ADD_SUB_INSTANCE', blockName: 'Jets', subName: 'PtEtaSelection' },
      { type: 'SET_SUB_OPTION', blockName: 'Jets', subName: 'PtEtaSelection', subInstanceId: '1', key: 'minPt', value: '30000' },
      { type: 'REMOVE_SUB_INSTANCE', blockName: 'Jets', subName: 'PtEtaSelection', subInstanceId: '0' },
      { type: 'TOGGLE_BLOCK', name: 'Output' },
      { type: 'ADD_CUSTOM_BLOCK', entry: { algName: 'Tutorial' } },
    ]
    const p = propose(ops)
    expect(p.actions).toHaveLength(ops.length)
    expect(new Set(p.actions.map(a => a.type))).toEqual(new Set(OP_TYPES))
    expect(p.configObj.Jets).toEqual([{ PtEtaSelection: [{ minPt: 30000 }] }])
    expect(p.configObj.Output).toEqual({})
    // a catalogue block is declared and enabled in one go, as the sidebar does it
    expect(p.configObj.AddConfigBlocks).toEqual([
      { modulePath: 'TopCPToolkit.TutorialConfig', functionName: 'TutorialConfig', algName: 'Tutorial', pos: 'Output' },
    ])
    expect(p.configObj.Tutorial).toEqual({})
  })

  it('reads a value the way the YAML file would, given the option\'s type', () => {
    const p = propose([
      enableJets,
      { type: 'SET_OPTION', blockName: 'Jets', key: 'containerName', value: 'AnaJets' },
      { type: 'SET_OPTION', blockName: 'Jets', key: 'minPt', value: '30000' },
      { type: 'SET_OPTION', blockName: 'Jets', key: 'ptCuts', value: '[10000, 20000]' },
      { type: 'SET_OPTION', blockName: 'Jets', key: 'runJvtSelection', value: 'false' },
    ])
    expect(p.configObj.Jets[0]).toEqual({
      containerName: 'AnaJets', minPt: 30000, ptCuts: [10000, 20000], runJvtSelection: false,
    })
  })

  it('applies exactly what the proposal previewed', () => {
    const base = ctx()
    const p = proposeOperations({ operations: [enableJets], summary: 's', ...base })
    const applied = applyOperations(base.config, p.actions)
    expect(buildYamlObject(applied, SCHEMA)).toEqual(p.configObj)
    expect(base.config.blocks.Jets.enabled).toBe(false)   // the live config is never touched
  })
})

describe('proposal validation', () => {
  const fails = (operations, mutate) => {
    try {
      propose(operations, mutate)
      throw new Error('expected the proposal to be rejected')
    } catch (err) { return err.message }
  }

  it('rejects an unknown block, and says which one was meant', () => {
    expect(fails([{ type: 'SET_BLOCK_ENABLED', name: 'Jetz', enabled: true }]))
      .toMatch(/No block named 'Jetz'.*Did you mean: Jets/)
  })

  it('rejects an unknown option, an option that is really a sub-block, and a bad type', () => {
    expect(fails([enableJets, { type: 'SET_OPTION', blockName: 'Jets', key: 'contanerName', value: 'x' }]))
      .toMatch(/Option 'contanerName' is not used by block 'Jets'.*Did you mean: containerName/)
    expect(fails([enableJets, { type: 'SET_OPTION', blockName: 'Jets', key: 'JVT', value: 'x' }]))
      .toMatch(/'JVT' is a sub-block of 'Jets'.*TOGGLE_SUB_BLOCK/)
    expect(fails([enableJets, { type: 'SET_OPTION', blockName: 'Jets', key: 'minPt', value: 'not-a-number' }]))
      .toMatch(/Option 'Jets.minPt' is float; got a string/)
  })

  it('rejects a sub-block name that is really an option, and says which operation to use', () => {
    expect(fails([enableJets, { type: 'TOGGLE_SUB_BLOCK', blockName: 'Jets', subName: 'containerName' }]))
      .toMatch(/'containerName' is an option of 'Jets', not a sub-block — use SET_OPTION/)
    // a genuinely unknown sub-block still lists what the block does have
    expect(fails([enableJets, { type: 'TOGGLE_SUB_BLOCK', blockName: 'Jets', subName: 'Nope' }]))
      .toMatch(/Block 'Jets' has no sub-block 'Nope'\. It has: /)
  })

  it('rejects an instance that does not exist', () => {
    expect(fails([enableJets, { type: 'SET_OPTION', blockName: 'Jets', instanceId: '3', key: 'containerName', value: 'x' }]))
      .toMatch(/Block 'Jets' has 1 instance\(s\); there is no index 3/)
    expect(fails([enableJets, { type: 'SET_OPTION', blockName: 'Jets', instanceId: 'no-such-id', key: 'containerName', value: 'x' }]))
      .toMatch(/has no instance with id 'no-such-id'/)
  })

  it('refuses to edit what the YAML would not carry, and says what to add', () => {
    expect(fails([{ type: 'SET_OPTION', blockName: 'Jets', key: 'containerName', value: 'x' }]))
      .toMatch(/Block 'Jets' is not enabled.*SET_BLOCK_ENABLED/s)
    expect(fails([enableJets, { type: 'SET_SUB_OPTION', blockName: 'Jets', subName: 'JVT', key: 'selectionName', value: 'x' }]))
      .toMatch(/Sub-block 'Jets.JVT' is not enabled.*TOGGLE_SUB_BLOCK/s)
    expect(fails([enableJets, { type: 'REMOVE_INSTANCE', blockName: 'Jets', instanceId: '0' }]))
      .toMatch(/single instance, which cannot be removed/)
  })

  it('rejects an unknown operation, an empty list and a non-catalogue custom block', () => {
    expect(fails([{ type: 'RENAME_BLOCK', name: 'Jets' }])).toMatch(/Unknown operation 'RENAME_BLOCK'/)
    expect(fails([])).toMatch(/at least one operation/)
    expect(fails([{ type: 'ADD_CUSTOM_BLOCK', entry: { algName: 'Nope' } }]))
      .toMatch(/No catalogue entry for 'Nope'.*Tutorial/)
  })

  it('reports every bad operation at once, numbered, so one retry can fix them all', () => {
    const msg = fails([
      { type: 'SET_BLOCK_ENABLED', name: 'Jetz', enabled: true },
      { type: 'SET_OPTION', blockName: 'Electrons', key: 'nope', value: 'x' },
    ])
    expect(msg).toContain('operation 0 (SET_BLOCK_ENABLED)')
    expect(msg).toContain('operation 1 (SET_OPTION)')
    expect(msg).toMatch(/nothing was offered to the user/)
  })

  it('rejects a sub-block instance left with no options set', () => {
    // The session that prompted this: a populated WorkingPoint, then a second,
    // empty one from an ADD_SUB_INSTANCE nothing ever filled in.
    const ops = [
      { type: 'SET_BLOCK_ENABLED', name: 'Electrons', enabled: true },
      { type: 'SET_OPTION', blockName: 'Electrons', key: 'containerName', value: 'AnaElectrons' },
      { type: 'TOGGLE_SUB_BLOCK', blockName: 'Electrons', subName: 'WorkingPoint' },
      { type: 'SET_SUB_OPTION', blockName: 'Electrons', subName: 'WorkingPoint', subInstanceId: '0', key: 'selectionName', value: 'loose' },
      { type: 'SET_SUB_OPTION', blockName: 'Electrons', subName: 'WorkingPoint', subInstanceId: '0', key: 'identificationWP', value: 'Tight' },
      { type: 'ADD_SUB_INSTANCE', blockName: 'Electrons', subName: 'WorkingPoint' },
    ]
    expect(fails(ops)).toMatch(/Electrons\[0\]\.WorkingPoint\[1\] would be left with no options set/)

    // filled in, the same six operations are a proposal
    const p = propose([...ops, { type: 'SET_SUB_OPTION', blockName: 'Electrons', subName: 'WorkingPoint',
      subInstanceId: '1', key: 'selectionName', value: 'tight' }])
    expect(p.configObj.Electrons[0].WorkingPoint).toEqual([
      { selectionName: 'loose', identificationWP: 'Tight' }, { selectionName: 'tight' },
    ])
  })

  it('leaves a lone empty instance alone, and judges only the sub-blocks it touched', () => {
    // one instance with nothing set is "this sub-block is on, with its defaults"
    const on = propose([enableJets, { type: 'TOGGLE_SUB_BLOCK', blockName: 'Jets', subName: 'JVT' }])
    expect(on.configObj.Jets).toEqual([{ JVT: {} }])

    // an empty instance the user already had is theirs, not this proposal's fault
    const p = propose([enableJets], config => {
      const sub = config.blocks.Electrons.instances[0].subBlocks.WorkingPoint
      sub.enabled = true
      sub.instances = [{ _id: 'wp0', options: { selectionName: 'loose' } }, { _id: 'wp1', options: {} }]
      config.blocks.Electrons.enabled = true
    })
    expect(p.actions).toHaveLength(1)
  })

  it('offers a proposal that merely worries the validator, with the issues attached', () => {
    const p = propose([{ type: 'SET_BLOCK_ENABLED', name: 'Electrons', enabled: true }])
    expect(p.issues.errors).toEqual([])
    expect(p.issues.warnings.map(w => w.path)).toContain('Electrons[0].containerName')

    const ref = propose([
      { type: 'SET_BLOCK_ENABLED', name: 'EventSelection', enabled: true },
      { type: 'SET_OPTION', blockName: 'EventSelection', key: 'selectionName', value: 'SR' },
      { type: 'SET_OPTION', blockName: 'EventSelection', key: 'electrons', value: 'NoSuchContainer' },
    ])
    expect(ref.issues.warnings.some(w => w.kind === 'dependency')).toBe(true)
  })

  it('compiles nothing when an operation fails, and keeps the state it started from', () => {
    const base = ctx()
    const { actions, errors, state } = compileOperations(
      [enableJets, { type: 'SET_OPTION', blockName: 'Jets', key: 'nope', value: 1 }],
      base)
    expect(errors).toHaveLength(1)
    expect(actions).toHaveLength(1)          // the good one compiled; the caller refuses the lot
    expect(state.blocks.Jets.enabled).toBe(true)
    expect(base.config.blocks.Jets.enabled).toBe(false)
  })
})

describe('a whole config proposal', () => {
  const yamlText = 'Jets:\n  containerName: AnaJets\n  jetCollection: AntiKt4EMPFlowJets\nOutput:\n  treeName: reco\n'

  it('is read the way loading a file is', () => {
    const p = proposeConfig({ yaml: yamlText, summary: 'ttbar reco', ...ctx() })
    expect(p.kind).toBe('config')
    expect(p.labels).toEqual(['Jets', 'Output'])
    expect(p.configObj).toEqual({
      Jets: [{ containerName: 'AnaJets', jetCollection: 'AntiKt4EMPFlowJets' }],
      Output: [{ treeName: 'reco' }],
    })
    expect(p.state.blocks.Jets.enabled).toBe(true)
    expect(p.issues.errors).toEqual([])
  })

  it('keeps a block this release does not know, and surfaces it as an issue', () => {
    const p = proposeConfig({ yaml: 'NoSuchBlock:\n  foo: 1\n', summary: 's', ...ctx() })
    expect(p.state.unknown.NoSuchBlock).toEqual({ foo: 1 })
    expect(p.issues.errors[0].message).toMatch(/Unknown block 'NoSuchBlock'/)
  })

  it('refuses YAML it cannot parse or that is not a mapping of blocks', () => {
    expect(() => proposeConfig({ yaml: 'Jets:\n  - [oops\n', summary: 's', ...ctx() }))
      .toThrow(/YAML parse error/)
    expect(() => proposeConfig({ yaml: '- Jets\n- Output\n', summary: 's', ...ctx() }))
      .toThrow(/must be a mapping/)
    expect(() => proposeConfig({ yaml: '   ', summary: 's', ...ctx() }))
      .toThrow(/needs the YAML of a complete config/)
  })
})

describe('the proposal tools', () => {
  function tools(mutate) {
    const c = ctx(mutate)
    return {
      config: c.config,
      t: createTools({ ...c, registry: buildRegistryFromState(c.config, c.blocks) }),
    }
  }

  it('hands the proposal to the panel and a summary to the model, changing nothing', async () => {
    const { t, config } = tools()
    const before = JSON.stringify(config)
    const out = await t.run('propose_edits', {
      summary: 'Enable Jets',
      operations: [enableJets, { type: 'SET_OPTION', blockName: 'Jets', key: 'containerName', value: 'AnaJets' }],
    })
    expect(out.ok).toBe(true)
    expect(out.proposal.kind).toBe('edits')
    expect(out.proposal.actions).toHaveLength(2)
    expect(out.result).toMatchObject({
      proposalId: out.proposal.id,
      kind: 'edits',
      summary: 'Enable Jets',
      status: expect.stringContaining('has NOT changed'),
    })
    expect(out.result.state).toBeUndefined()          // the model never gets the state
    expect(JSON.stringify(config)).toBe(before)
  })

  it('hands a malformed proposal back as a tool error, with nothing offered', async () => {
    const { t } = tools()
    const out = await t.run('propose_edits', {
      summary: 'oops',
      operations: [{ type: 'SET_OPTION', blockName: 'Jets', key: 'containerName', value: 'x' }],
    })
    expect(out).toEqual({ ok: false, error: expect.stringContaining("Block 'Jets' is not enabled") })
    expect(out.proposal).toBeUndefined()
  })

  it('tells the model a proposal missing a required option is incomplete', async () => {
    const { t } = tools()
    const out = await t.run('propose_edits', {
      summary: 'loose electrons',
      operations: [
        { type: 'SET_BLOCK_ENABLED', name: 'Electrons', enabled: true },
        { type: 'SET_OPTION', blockName: 'Electrons', key: 'containerName', value: 'AnaElectrons' },
        { type: 'TOGGLE_SUB_BLOCK', blockName: 'Electrons', subName: 'WorkingPoint' },
        { type: 'SET_SUB_OPTION', blockName: 'Electrons', subName: 'WorkingPoint', key: 'identificationWP', value: 'Tight' },
      ],
    })
    expect(out.ok).toBe(true)                       // warnings never block the offer
    expect(out.proposal.issues.errors).toEqual([])
    expect(out.result.incomplete).toMatch(/INCOMPLETE.*Electrons\[0\]\.WorkingPoint\[0\]\.selectionName/)
    expect(out.result.incomplete).toMatch(/propose again/)

    // the change list and the issues address the same place the same way
    expect(out.result.changes).toContain("Electrons[0].WorkingPoint[0].identificationWP = 'Tight'")
    expect(out.proposal.issues.warnings.map(w => w.path)).toContain('Electrons[0].WorkingPoint[0].selectionName')
  })

  it('says nothing about incompleteness when every required option is set', async () => {
    const { t } = tools()
    const out = await t.run('propose_edits', {
      summary: 'jets',
      operations: [enableJets, { type: 'SET_OPTION', blockName: 'Jets', key: 'containerName', value: 'AnaJets' }],
    })
    expect(out.result.incomplete).toBeUndefined()
  })

  it('offers a whole config and warns the model what applying it costs', async () => {
    const { t } = tools()
    const out = await t.run('propose_config', { summary: 'ttbar', yaml: 'Output:\n  treeName: reco\n' })
    expect(out.ok).toBe(true)
    expect(out.proposal.kind).toBe('config')
    expect(out.result.note).toMatch(/clears the undo history/)
  })
})


describe('the review step', () => {
  const card = props => renderToStaticMarkup(createElement(AiProposalCard, props))

  it('shows what would change and makes Apply and Reject unmistakable', () => {
    const proposal = propose([
      enableJets,
      { type: 'SET_OPTION', blockName: 'Jets', key: 'containerName', value: 'AnaJets' },
    ])
    const html = card({ proposal })
    expect(html).toContain('Review diff')
    expect(html).toContain('>Apply<')
    expect(html).toContain('>Reject<')
    expect(html).toContain('containerName')
    expect(html).toContain('2 edits')
  })

  it('warns before a whole config replaces the user\'s, and lists its issues', () => {
    const proposal = proposeConfig({ yaml: 'Electrons: {}\n', summary: 'electrons only', ...ctx() })
    const html = card({ proposal })
    expect(html).toContain('clears the undo history')
    expect(html).toContain('Required option')
  })

  it('replaces the buttons with the outcome once the user has decided', () => {
    const proposal = propose([enableJets])
    expect(card({ proposal, status: 'applied' })).toContain('Applied')
    expect(card({ proposal, status: 'applied' })).not.toContain('>Apply<')
    expect(card({ proposal, status: 'rejected' })).toContain('nothing was changed')
  })

  it('diffs a supplied config without asking the user to load one', () => {
    const proposal = propose([enableJets, { type: 'SET_OPTION', blockName: 'Jets', key: 'containerName', value: 'AnaJets' }])
    const html = renderToStaticMarkup(createElement(DiffView, {
      configA: proposal.baseConfigObj, configB: proposal.configObj,
      blocks: ctx().blocks, labelA: 'A — Your config', labelB: 'B — Proposed', onClose: () => {},
    }))
    expect(html).not.toContain('Load Config B')
    expect(html).not.toContain('Load different B')
    expect(html).toContain('B — Proposed')
    expect(html).toContain('AnaJets')
  })
})
