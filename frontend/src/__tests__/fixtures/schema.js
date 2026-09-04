// Schema fixture mirroring the shape served by GET /api/schema (see
// backend/introspect.py and the fake factory in backend/tests).  Frontend
// tests run against this instead of a live backend.

export function opt(name, type, def, extra = {}) {
  return {
    name, type, default: def, factoryDefault: null, info: '', required: false,
    noneAction: 'ignore', expertMode: null, physicalUnit: null, generic: false,
    origin: extra.origin ?? 'Fake', meta: null, ...extra,
  }
}

export const GENERIC = [
  opt('groupName', 'str', '', { generic: true }),
  opt('skipOnData', 'bool', false, { generic: true }),
  opt('skipOnMC', 'bool', false, { generic: true }),
  opt('skipWithSystematics', 'bool', false, { generic: true }),
  opt('onlyForDSIDs', 'list', [], { generic: true }),
  opt('propertyOverrides', 'dict', {}, { generic: true, expertMode: [true] }),
]

export function block(name, options, extra = {}) {
  return {
    name, factoryName: extra.factoryName ?? name, kind: extra.kind ?? 'class',
    category: extra.category ?? 'Objects', label: extra.label ?? name,
    classes: extra.classes ?? [{ module: 'Fake', cls: `${name}Fake`, docstring: `Fake ${name}.` }],
    options: [...options, ...GENERIC],
    dependencies: extra.dependencies ?? [], subBlocks: extra.subBlocks ?? [],
    parents: extra.parents ?? [], error: extra.error ?? null,
    ...(extra.opaque ? { opaque: true } : {}),
  }
}

const jvt = block('JVT', [
  opt('containerName', 'str', ''),
  opt('selectionName', 'str', 'jvt', { meta: { role: 'selection' } }),
], { factoryName: 'Jets.JVT', category: null, parents: ['Jets'] })

const ptEta = (parent) => block('PtEtaSelection', [
  opt('containerName', 'str', ''),
  opt('selectionName', 'str', '', { factoryDefault: '' }),
  opt('minPt', 'float', 0.0, { physicalUnit: 'MeV' }),
  opt('maxEta', 'float', 0.0),
], parent
  ? { factoryName: `${parent}.PtEtaSelection`, category: null, parents: ['Jets', 'Electrons'] }
  : { category: 'Objects' })

const wp = block('WorkingPoint', [
  opt('selectionName', 'str', '', { noneAction: 'error' }),
  opt('identificationWP', 'str', '', { meta: { choices: ['LooseBLayer', 'Medium', 'Tight'] } }),
  opt('isolationWP', 'str', ''),
], { factoryName: 'Electrons.WorkingPoint', category: null, parents: ['Electrons'] })

export const BLOCKS = [
  block('CommonServices', [
    opt('enableExpertMode', 'bool', false),
    opt('systematicsHistogram', 'str', '', { expertMode: [true] }),
    opt('runSystematics', 'bool', true),
  ], { category: 'Core' }),

  block('Jets', [
    opt('containerName', 'str', '', { noneAction: 'error', origin: 'PreJets' }),
    opt('jetCollection', 'str', '', { origin: 'PreJets' }),
    opt('systematicsModelJES', 'str', 'Category', { origin: 'SmallRJets', meta: { choices: ['All', 'Category'] } }),
    opt('ptCuts', 'list', [], { origin: 'SmallRJets' }),
    opt('runJvtSelection', 'bool', true, { origin: 'SmallRJets' }),
    opt('minPt', 'float', 25000.0, { origin: 'LargeRJets', physicalUnit: 'MeV' }),
  ], { kind: 'group', subBlocks: [jvt, ptEta('Jets')],
       classes: ['PreJets', 'SmallRJets', 'LargeRJets'].map(c => ({ module: 'Fake', cls: c, docstring: '' })) }),

  block('Electrons', [
    opt('containerName', 'str', '', { noneAction: 'error' }),
    opt('forceFullSimConfig', 'bool', false),
  ], { subBlocks: [wp, ptEta('Electrons')] }),

  ptEta(null),

  block('OverlapRemoval', [
    opt('electrons', 'str', ''),
    opt('muons', 'str', ''),
    opt('jets', 'str', ''),
    opt('inputLabel', 'str', ''),
  ], { category: 'Selection' }),

  block('EventSelection', [
    opt('selectionName', 'str', '', { noneAction: 'error' }),
    opt('electrons', 'str', '', { meta: { role: 'containerRef' } }),
    opt('selectionCuts', 'str', '', { noneAction: 'error', meta: { multiline: true } }),
    opt('noFilter', 'bool', false, { origin: 'EventSelectionMerger' }),
  ], { kind: 'group', category: 'Selection',
       dependencies: [{ blockName: 'EventSelection', required: true }] }),

  block('Thinning', [
    opt('containerName', 'str', ''),
    opt('outputName', 'str', ''),
    opt('selection', 'str', ''),
  ], { category: 'Output' }),

  block('Output', [
    opt('configName', 'str', 'Output', { factoryDefault: 'Output' }),
    opt('treeName', 'str', 'analysis'),
    opt('vars', 'list', []),
    opt('metaConfig', 'dict', {}),
  ], { category: 'Output' }),
]

export const TUTORIAL_BLOCK = block('Tutorial', [opt('tutorialOption', 'int', 3)], { category: 'TopCPToolkit' })

export const CATALOGUE = [{
  modulePath: 'TopCPToolkit.TutorialConfig', functionName: 'TutorialConfig',
  algName: 'Tutorial', pos: 'Output', superBlocks: null, usedIn: ['tutorial/reco.yaml'],
  block: TUTORIAL_BLOCK,
}]

export const SCHEMA = {
  categories: ['Core', 'Objects', 'Truth', 'Selection', 'Output', 'TopCPToolkit', 'Others'],
  blocks: BLOCKS, catalogue: CATALOGUE, examples: [], keywords: null,
  versions: { app: 'test', ab: null, tct: null, athena: false, pdflatex: false },
}

export function findBlock(blocks, name) {
  return blocks.find(b => b.name === name)
}
