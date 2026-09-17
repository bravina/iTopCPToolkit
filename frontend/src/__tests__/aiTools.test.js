import { describe, it, expect } from 'vitest'
import { createTools, TOOL_DEFS } from '../ai/tools.js'
import { getEntry } from '../ai/glossary.js'
import { effectiveBlocks, customEntryFromCatalogue } from '../utils/schema.js'
import { initialConfig } from '../utils/configState.js'
import { buildRegistryFromState, buildRegistryFromYaml } from '../utils/collectionRegistry.js'
import { SCHEMA, CATALOGUE, block, opt } from './fixtures/schema.js'

const EXAMPLES = [
  { path: 'TopCPToolkit/tutorial/reco.yaml', name: 'tutorial/reco.yaml', source: 'TopCPToolkit' },
]

/** A tool layer over a config built by mutating a fresh builder state. */
function tools(mutate = () => {}, { examples = EXAMPLES, readExample, readOnly } = {}) {
  const schema = { ...SCHEMA, examples }
  const config = initialConfig(SCHEMA.blocks)
  mutate(config)
  const blocks = effectiveBlocks(schema.blocks, config.addConfigBlocks)
  const registry = buildRegistryFromState(config, blocks)
  return createTools({ schema, config, blocks, registry, readExample, readOnly })
}

/** The Reader's tool layer: the config is the parsed YAML object itself. */
function readerTools(configObj, { readOnly = true, configShape } = {}) {
  const schema = { ...SCHEMA, examples: EXAMPLES }
  const blocks = effectiveBlocks(schema.blocks, [])
  const registry = buildRegistryFromYaml(configObj ?? {}, blocks)
  return createTools({ schema, config: configObj, blocks, registry, readOnly, configShape })
}

function enable(config, name, options = {}) {
  const block = config.blocks[name]
  block.enabled = true
  block.instances[0].options = { ...block.instances[0].options, ...options }
  return block.instances[0]
}

describe('tool definitions', () => {
  it('declares an object schema with a name and description for every tool', () => {
    for (const def of TOOL_DEFS) {
      expect(def.name).toMatch(/^[a-z_]+$/)
      expect(def.description.length).toBeGreaterThan(20)
      expect(def.parameters.type).toBe('object')
      expect(def.parameters.properties).toBeTypeOf('object')
      expect(Array.isArray(def.parameters.required)).toBe(true)
    }
  })

  it('exposes exactly the tools the loop can run', async () => {
    const t = tools()
    expect(t.names.sort()).toEqual([
      'current_config', 'describe_block', 'explain_concept', 'list_blocks', 'list_examples',
      'propose_config', 'propose_edits', 'read_example', 'validate_config',
    ])
    expect(t.readOnly).toBe(false)
    expect(t.configShape).toBe('state')
    expect(await t.run('no_such_tool', {})).toEqual({
      ok: false,
      error: expect.stringContaining("Unknown tool 'no_such_tool'"),
    })
  })
})

describe('list_blocks', () => {
  it('lists every schema block with a summary and its sub-blocks', async () => {
    const { result } = await tools().run('list_blocks', {})
    expect(result.total).toBe(SCHEMA.blocks.length)
    const jets = result.blocks.find(b => b.name === 'Jets')
    expect(jets.subBlocks).toEqual(['JVT', 'PtEtaSelection'])
    expect(jets.summary).toBe('')          // the fixture's group classes have no docstring
    expect(jets.enabled).toBe(false)
    const electrons = result.blocks.find(b => b.name === 'Electrons')
    expect(electrons.summary).toBe('Fake Electrons.')
    expect(electrons.options).toBe(2)      // generic options are not counted
  })

  it('filters by substring, by category and by what is enabled', async () => {
    const t = tools(c => enable(c, 'Jets'))
    expect((await t.run('list_blocks', { filter: 'jet' })).result.blocks.map(b => b.name)).toEqual(['Jets'])
    expect((await t.run('list_blocks', { category: 'Output' })).result.blocks.map(b => b.name))
      .toEqual(['Thinning', 'Output'])
    expect((await t.run('list_blocks', { enabledOnly: true })).result.blocks.map(b => b.name)).toEqual(['Jets'])
  })

  it('includes blocks added through AddConfigBlocks', async () => {
    const t = tools(c => { c.addConfigBlocks = [customEntryFromCatalogue(CATALOGUE[0])] })
    const names = (await t.run('list_blocks', { filter: 'tutorial' })).result.blocks.map(b => b.name)
    expect(names).toEqual(['Tutorial'])
  })
})

describe('describe_block', () => {
  it('returns options with type, default, requiredness and choices', async () => {
    const { result } = await tools().run('describe_block', { block: 'Jets' })
    expect(result.interpreted).toEqual({ target: 'block', block: 'Jets', subBlock: null, option: null })
    expect(result.name).toBe('Jets')
    expect(result.subBlocks).toEqual(['JVT', 'PtEtaSelection'])
    const byName = Object.fromEntries(result.options.map(o => [o.name, o]))
    expect(byName.containerName).toMatchObject({ type: 'str', required: true, declaredBy: 'PreJets' })
    expect(byName.systematicsModelJES).toMatchObject({ default: 'Category', choices: ['All', 'Category'] })
    expect(byName.minPt).toMatchObject({ type: 'float', default: 25000, unit: 'MeV' })
    expect(byName.groupName).toBeUndefined()          // generic by default
    expect(result.genericOptionsOmitted).toBeGreaterThan(0)
  })

  it('can include the generic options', async () => {
    const { result } = await tools().run('describe_block', { name: 'Jets', includeGeneric: true })
    expect(result.options.some(o => o.name === 'skipOnData')).toBe(true)
    expect(result.genericOptionsOmitted).toBe(0)
  })

  it('describes a sub-block by field, and through the legacy Parent.Sub', async () => {
    const t = tools()
    const { result } = await t.run('describe_block', { block: 'Jets', subBlock: 'JVT' })
    expect(result).toMatchObject({ parent: 'Jets', name: 'JVT', factoryName: 'Jets.JVT' })
    expect(result.interpreted).toMatchObject({ target: 'subBlock', block: 'Jets', subBlock: 'JVT', option: null })
    expect(result.options.find(o => o.name === 'selectionName').role).toBe('selection')

    const legacy = (await t.run('describe_block', { name: 'Jets.JVT' })).result
    expect(legacy.interpreted).toEqual({ target: 'subBlock', block: 'Jets', subBlock: 'JVT', option: null, from: 'Jets.JVT' })
    expect(legacy.options).toEqual(result.options)
  })

  it('reports expert-only options and marks an unknown block as an error', async () => {
    const t = tools()
    const { result } = await t.run('describe_block', { block: 'CommonServices' })
    expect(result.options.find(o => o.name === 'systematicsHistogram').expertMode).toBe(true)

    const missing = await t.run('describe_block', { block: 'Jetz' })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('Jets')                  // suggests the near miss

    const noBlock = await t.run('describe_block', {})
    expect(noBlock.ok).toBe(false)
    expect(noBlock.error).toContain('describe_block needs a block')
  })

  // The regression: the Explain label is `Block.option`, and a model that
  // copies it used to be told the block had no such sub-block — which it then
  // reported to the user as "there is no such option".
  it('reads Block.option as an option, not as a missing sub-block', async () => {
    const t = tools()
    const legacy = await t.run('describe_block', { name: 'CommonServices.runSystematics' })
    expect(legacy.ok).toBe(true)
    expect(legacy.result.option).toMatchObject({ name: 'runSystematics', type: 'bool', default: true })
    expect(legacy.result.block).toBe('CommonServices')
    expect(legacy.result.interpreted).toEqual({
      target: 'option', block: 'CommonServices', subBlock: null, option: 'runSystematics',
      from: 'CommonServices.runSystematics',
    })
    expect(legacy.result.note).toContain('as the option')    // says how it was read

    // The same dotted string arriving in the `block` field, as a model copying
    // the label would send it.
    const inBlockField = await t.run('describe_block', { block: 'CommonServices.runSystematics' })
    expect(inBlockField.result.option).toEqual(legacy.result.option)

    const structured = await t.run('describe_block', { block: 'CommonServices', option: 'runSystematics' })
    expect(structured.ok).toBe(true)
    expect(structured.result.option).toEqual(legacy.result.option)
    expect(structured.result.interpreted).toEqual({
      target: 'option', block: 'CommonServices', subBlock: null, option: 'runSystematics',
    })
    expect(structured.result.note).toBeUndefined()
  })

  it('describes one option of a sub-block, in its own context', async () => {
    const t = tools()
    const { result } = await t.run('describe_block', { block: 'Jets', subBlock: 'JVT', option: 'selectionName' })
    expect(result).toMatchObject({ block: 'Jets', subBlock: 'JVT' })
    expect(result.option).toMatchObject({ name: 'selectionName', role: 'selection' })
    expect(result.interpreted).toEqual({ target: 'option', block: 'Jets', subBlock: 'JVT', option: 'selectionName' })

    const dotted = (await t.run('describe_block', { name: 'Jets.JVT.selectionName' })).result
    expect(dotted.option).toEqual(result.option)
  })

  // Generic options are hidden from a whole-block listing; asking for one by
  // name is not a reason to claim it does not exist.
  it('returns a generic option asked for by name', async () => {
    const t = tools()
    const { result } = await t.run('describe_block', { block: 'Jets', option: 'skipOnData' })
    expect(result.option).toMatchObject({ name: 'skipOnData', type: 'bool' })
    expect(result.generic).toBe(true)
    expect(result.note).toContain('generic')

    const legacy = await t.run('describe_block', { name: 'CommonServices.skipOnData' })
    expect(legacy.ok).toBe(true)
    expect(legacy.result.option.name).toBe('skipOnData')
  })

  it('answers a name that matches nothing with near misses from both namespaces', async () => {
    const t = tools()
    for (const input of [{ block: 'Jets', option: 'jvtSelection' }, { name: 'Jets.jvtSelection' }]) {
      const miss = await t.run('describe_block', input)
      expect(miss.ok).toBe(false)
      expect(miss.error).toContain("has no sub-block and no option named 'jvtSelection'")
      expect(miss.error).toContain('Options like it: runJvtSelection')
      expect(miss.error).toContain('Sub-blocks like it: JVT')
      expect(miss.error).toContain('includeGeneric: true')   // where to look before concluding
    }

    const inSub = await t.run('describe_block', { block: 'Jets', subBlock: 'JVT', option: 'minPt' })
    expect(inSub.ok).toBe(false)
    expect(inSub.error).toContain("Sub-block 'Jets.JVT' has no option named 'minPt'")
  })

  it('swaps the two namespaces round rather than refusing a near-right address', async () => {
    const t = tools()
    const asOption = (await t.run('describe_block', { block: 'Jets', option: 'JVT' })).result
    expect(asOption).toMatchObject({ parent: 'Jets', name: 'JVT' })
    expect(asOption.note).toContain('sub-block')

    const asSub = (await t.run('describe_block', { block: 'Jets', subBlock: 'minPt' })).result
    expect(asSub.option).toMatchObject({ name: 'minPt', unit: 'MeV' })
    expect(asSub.note).toContain('has no sub-block')
  })

  it('says so when a dotted name could be either a sub-block or an option', async () => {
    const jvtSub = block('JVT', [opt('selectionName', 'str', 'jvt')], { factoryName: 'Jets.JVT' })
    const blocks = [block('Jets', [opt('JVT', 'bool', true), opt('minPt', 'float', 25000)], { subBlocks: [jvtSub] })]
    const config = initialConfig(blocks)
    const t = createTools({
      schema: { ...SCHEMA, blocks }, config, blocks, registry: buildRegistryFromState(config, blocks),
    })
    const { result } = await t.run('describe_block', { name: 'Jets.JVT' })
    expect(result.interpreted).toMatchObject({ target: 'subBlock', subBlock: 'JVT' })
    expect(result.note).toContain('both a sub-block and an option named')
    expect(result.note).toContain("option: 'JVT'")           // how to ask for the other one
  })
})

describe('examples', () => {
  it('lists what the schema document carries', async () => {
    const { result } = await tools().run('list_examples', {})
    expect(result).toEqual({ examples: EXAMPLES, total: 1 })
  })

  it('reads a known example and refuses an unknown path', async () => {
    const t = tools(() => {}, { readExample: async path => `# ${path}\nJets: {}\n` })
    const { result } = await t.run('read_example', { path: EXAMPLES[0].path })
    expect(result.yaml).toContain('Jets: {}')
    expect(result.truncated).toBe(false)
    expect((await t.run('read_example', { path: 'nope.yaml' })).error).toContain('Unknown example')
  })

  it('surfaces a failed fetch as a tool error, not an exception', async () => {
    const t = tools(() => {}, { readExample: async () => { throw new Error('HTTP 404') } })
    expect(await t.run('read_example', { path: EXAMPLES[0].path }))
      .toEqual({ ok: false, error: 'HTTP 404' })
  })
})

describe('current_config', () => {
  it('serialises the live state the same way the preview does', async () => {
    const t = tools(c => {
      enable(c, 'Jets', { containerName: 'AnaJets' })
      c.addConfigBlocks = [customEntryFromCatalogue(CATALOGUE[0])]
    })
    const { result } = await t.run('current_config', {})
    expect(result.enabledBlocks).toContain('Jets')
    expect(result.yaml).toContain('containerName: AnaJets')
    expect(result.customBlocks).toEqual([
      { algName: 'Tutorial', modulePath: 'TopCPToolkit.TutorialConfig', functionName: 'TutorialConfig' },
    ])
  })

  it('reports an empty config rather than failing', async () => {
    const { result } = await tools().run('current_config', {})
    expect(result.enabledBlocks).toEqual([])
    expect(result.yaml).toBe('# No blocks enabled yet\n')
  })
})

describe('validate_config', () => {
  it('is clean for a config that satisfies the schema', async () => {
    const t = tools(c => {
      enable(c, 'Jets', { containerName: 'AnaJets' })
      enable(c, 'Output', { treeName: 'reco' })
    })
    expect((await t.run('validate_config', {})).result).toEqual({ valid: true, errors: [], warnings: [] })
  })

  it('reports missing required options as warnings', async () => {
    const t = tools(c => enable(c, 'Electrons'))
    const { result } = await t.run('validate_config', {})
    expect(result.valid).toBe(true)
    expect(result.warnings.map(w => w.path)).toContain('Electrons[0].containerName')
  })

  it('reports an unresolved container reference from the dependency checker', async () => {
    const t = tools(c => enable(c, 'EventSelection', { selectionName: 'SR', electrons: 'NoSuchContainer' }))
    const { result } = await t.run('validate_config', {})
    const dep = result.warnings.find(w => w.kind === 'dependency')
    expect(dep.path).toBe('EventSelection[0].electrons')
    expect(dep.message).toContain("'NoSuchContainer' is not defined")
  })
})

describe('explain_concept', () => {
  it('finds an entry by alias, by option name and inside a question', async () => {
    const t = tools()
    expect((await t.run('explain_concept', { concept: 'jvtWP' })).result.matches[0].id).toBe('jvt')
    expect((await t.run('explain_concept', { concept: 'B-Tagging' })).result.matches[0].id)
      .toBe('flavour-tagging')
    expect((await t.run('explain_concept', { concept: 'what is pileup?' })).result.matches[0].id)
      .toBe('pileup')
  })

  it('returns the whole entry, empty fields included, with the glossary version', async () => {
    const { result } = await tools().run('explain_concept', { concept: 'JVT' })
    const entry = result.matches.find(m => m.id === 'jvt')
    expect(entry.title).toBe(getEntry('jvt').title)
    expect(entry.what.length).toBeGreaterThan(0)
    expect(entry.choosing).toBe('')            // deliberately unwritten, not omitted
    expect(entry.see_also).toContain('pileup')
    expect(typeof result.glossaryVersion).toBe('number')
  })

  it('flags an unreviewed entry rather than letting it pass as settled', async () => {
    // Every seeded entry is `reviewed: false` — see ai/glossary.yaml.
    const { result } = await tools().run('explain_concept', { concept: 'jvtWP' })
    expect(result.matches[0].reviewed).toBe(false)
    expect(result.unreviewed).toEqual(result.matches.filter(m => !m.reviewed).map(m => m.id))
    expect(result.note).toContain('provisional')
  })

  it('suggests near misses instead of inventing an answer', async () => {
    const { result } = await tools().run('explain_concept', { concept: 'pileups' })
    expect(result.matches).toEqual([])
    expect(result.suggestions.map(s => s.id)).toContain('pileup')
    expect(result.note).toContain('describe_block')
  })

  it('needs a concept', async () => {
    const miss = await tools().run('explain_concept', {})
    expect(miss.ok).toBe(false)
    expect(miss.error).toContain('needs a concept')
  })

  it('is available in Reader too', async () => {
    const t = readerTools({ Jets: { containerName: 'AnaJets' } })
    expect(t.names).toContain('explain_concept')
    expect((await t.run('explain_concept', { concept: 'JVT' })).result.matches[0].id).toBe('jvt')
  })
})

describe('read-only tool sets', () => {
  it('withholds the proposal tools entirely rather than refusing them', async () => {
    const t = tools(c => enable(c, 'Jets', { containerName: 'AnaJets' }), { readOnly: true })
    expect(t.readOnly).toBe(true)
    expect(t.names).not.toContain('propose_edits')
    expect(t.names).not.toContain('propose_config')
    expect(t.defs.map(d => d.name)).not.toContain('propose_edits')

    const refused = await t.run('propose_edits', { summary: 'x', operations: [] })
    expect(refused.ok).toBe(false)
    expect(refused.error).toContain("Unknown tool 'propose_edits'")
    expect(refused.proposal).toBeUndefined()
  })

  it('leaves every read tool in place', async () => {
    const t = tools(c => enable(c, 'Jets', { containerName: 'AnaJets' }), { readOnly: true })
    expect(t.names.sort()).toEqual([
      'current_config', 'describe_block', 'explain_concept', 'list_blocks', 'list_examples',
      'read_example', 'validate_config',
    ])
    expect((await t.run('current_config', {})).result.enabledBlocks).toEqual(['Jets'])
  })

  it('never proposes against a YAML-shaped config, whatever readOnly says', () => {
    const t = readerTools({ Jets: { containerName: 'AnaJets' } }, { readOnly: false })
    expect(t.readOnly).toBe(true)
    expect(t.names).not.toContain('propose_config')
  })
})

describe('a Reader-shaped config', () => {
  const READER_CONFIG = {
    AddConfigBlocks: [
      { modulePath: 'TopCPToolkit.TutorialConfig', functionName: 'TutorialConfig', algName: 'Tutorial' },
    ],
    Jets: { containerName: 'AnaJets' },
    EventSelection: { selectionName: 'SR', electrons: 'NoSuchContainer', selectionCuts: 'GLOBAL' },
    Nonsense: { foo: 1 },
  }

  it('is detected without being told, and can be declared explicitly', () => {
    expect(readerTools(READER_CONFIG).configShape).toBe('yaml')
    expect(readerTools(READER_CONFIG, { configShape: 'yaml' }).configShape).toBe('yaml')
  })

  it('reports the loaded file rather than re-serialising a builder state', async () => {
    const { result } = await readerTools(READER_CONFIG).run('current_config', {})
    expect(result.yaml).toContain('containerName: AnaJets')
    expect(result.enabledBlocks).toEqual(['Jets', 'EventSelection', 'Nonsense'])
    expect(result.unknownBlocks).toEqual(['Nonsense'])
    expect(result.customBlocks).toEqual([
      { algName: 'Tutorial', modulePath: 'TopCPToolkit.TutorialConfig', functionName: 'TutorialConfig' },
    ])
    expect(result.readOnly).toBe(true)
  })

  it('says so when no file is loaded yet', async () => {
    const { result } = await readerTools(null, { configShape: 'yaml' }).run('current_config', {})
    expect(result.yaml).toBe('# No config loaded\n')
    expect(result.enabledBlocks).toEqual([])
  })

  it('marks the blocks present in the file as enabled', async () => {
    const t = readerTools(READER_CONFIG)
    expect((await t.run('list_blocks', { enabledOnly: true })).result.blocks.map(b => b.name))
      .toEqual(['Jets', 'EventSelection'])
    expect((await t.run('list_blocks', { filter: 'electron' })).result.blocks[0].enabled).toBe(false)
  })

  it('runs the same validator and dependency checker the Reader shows', async () => {
    const { result } = await readerTools(READER_CONFIG).run('validate_config', {})
    expect(result.valid).toBe(false)
    expect(result.errors.map(e => e.path)).toContain('Nonsense')
    const dep = result.warnings.find(w => w.kind === 'dependency')
    expect(dep.path).toBe('EventSelection[0].electrons')
    expect(dep.message).toContain("'NoSuchContainer' is not defined")
  })

  it('is clean for a file that satisfies the schema', async () => {
    const t = readerTools({ Jets: { containerName: 'AnaJets' }, Output: { treeName: 'reco' } })
    expect((await t.run('validate_config', {})).result).toEqual({ valid: true, errors: [], warnings: [] })
  })

  it('describes blocks from the same schema in either mode', async () => {
    const a = (await tools().run('describe_block', { name: 'Jets' })).result
    const b = (await readerTools(READER_CONFIG).run('describe_block', { name: 'Jets' })).result
    expect(b).toEqual(a)
  })
})
