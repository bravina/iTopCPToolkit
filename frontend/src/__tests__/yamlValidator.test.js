import { describe, it, expect } from 'vitest'
import { validateConfig, buildIssueMap, matchesExpertRule } from '../utils/yamlValidator.js'
import { effectiveBlocks, customEntryFromCatalogue } from '../utils/schema.js'
import { resolveCustomEntriesSync } from '../utils/yamlToConfig.js'
import { SCHEMA, CATALOGUE } from './fixtures/schema.js'

function validate(obj) {
  return validateConfig(obj, effectiveBlocks(SCHEMA.blocks, resolveCustomEntriesSync(obj, SCHEMA)))
}
const msgs = issues => issues.map(i => `${i.severity}:${i.path}:${i.message}`)

describe('validateConfig', () => {
  it('accepts a clean config', () => {
    const issues = validate({
      CommonServices: { runSystematics: false },
      Jets: [{ containerName: 'AnaJets', JVT: {}, PtEtaSelection: [{ minPt: 25000 }] }],
      Output: { treeName: 'reco', vars: ['a'] },
    })
    expect(issues).toEqual([])
  })

  it('flags unknown blocks and unused options with errors', () => {
    const issues = validate({ Nope: {}, Jets: { containerName: 'A', bogus: 1, JVT: { alsoBogus: 2 } } })
    expect(msgs(issues)).toContain("error:Nope:Unknown block 'Nope' — not in the factory and not declared in AddConfigBlocks")
    expect(msgs(issues)).toContain("error:Jets[0].bogus:Option 'bogus' is not used by block 'Jets'")
    expect(msgs(issues)).toContain("error:Jets[0].JVT[0].alsoBogus:Option 'alsoBogus' is not used by block 'JVT'")
  })

  it('warns on type mismatches and values outside choices', () => {
    const issues = validate({ Jets: { containerName: 'A', minPt: 'high', runJvtSelection: 'yes', ptCuts: 3, systematicsModelJES: 'Bogus' } })
    const m = msgs(issues)
    expect(m).toContain('warning:Jets[0].minPt:Expected float, got string')
    expect(m).toContain('warning:Jets[0].runJvtSelection:Expected bool, got string')
    expect(m).toContain('warning:Jets[0].ptCuts:Expected list, got number')
    expect(m).toContain("warning:Jets[0].systematicsModelJES:'Bogus' is not one of: All, Category")
    expect(issues.every(i => i.severity === 'warning')).toBe(true)
  })

  it('warns about missing required options, but not for inherited ones in sub-blocks', () => {
    const issues = validate({ Jets: { JVT: {} }, Electrons: { containerName: 'E', WorkingPoint: {} } })
    const m = msgs(issues)
    expect(m).toContain("warning:Jets[0].containerName:Required option 'containerName' is not set")
    expect(m).toContain("warning:Electrons[0].WorkingPoint[0].selectionName:Required option 'selectionName' is not set")
    expect(m.some(x => x.includes('JVT[0].containerName'))).toBe(false)
  })

  it('warns on expert-mode values and names the runtime flag', () => {
    const issues = validate({ CommonServices: { systematicsHistogram: 'h', propertyOverrides: { 'a.b': 1 } } })
    expect(issues).toHaveLength(2)
    expect(issues[0].message).toMatch(/CommonServices\.enableExpertMode/)
  })

  it('warns on deprecated SAVE lines', () => {
    const issues = validate({ EventSelection: { selectionName: 's', selectionCuts: 'EL_N 25000 >= 1\nSAVE\n' } })
    expect(msgs(issues)).toContain("warning:EventSelection[0].selectionCuts:'SAVE' is deprecated — the event filter is created automatically; remove the SAVE line")
  })

  it('checks AddConfigBlocks entries and validates custom blocks through the catalogue', () => {
    const issues = validate({
      AddConfigBlocks: [
        { modulePath: 'TopCPToolkit.TutorialConfig', functionName: 'TutorialConfig', algName: 'Tutorial' },
        { algName: 'broken' },
      ],
      Tutorial: { tutorialOption: 'x', nope: 1 },
    })
    const m = msgs(issues)
    expect(m).toContain('error:AddConfigBlocks[1]:AddConfigBlocks entry needs modulePath, functionName and algName')
    expect(m).toContain('warning:Tutorial[0].tutorialOption:Expected int, got string')
    expect(m).toContain("error:Tutorial[0].nope:Option 'nope' is not used by block 'Tutorial'")
  })

  it('does not check options of opaque custom blocks, but says so', () => {
    const issues = validate({
      AddConfigBlocks: [{ modulePath: 'Unknown.Mod', functionName: 'X', algName: 'Custom' }],
      Custom: { anything: 1 },
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('warning')
    expect(issues[0].message).toMatch(/cannot be checked/)
  })

  it('reports non-mapping instances', () => {
    const issues = validate({ Jets: ['oops'], Electrons: { containerName: 'E', WorkingPoint: [5] } })
    expect(msgs(issues)).toContain('error:Jets[0]:Block instance must be a mapping, got string')
    expect(msgs(issues)).toContain('error:Electrons[0].WorkingPoint[0]:Sub-block instance must be a mapping, got number')
  })

  it('warns when a required dependency block is absent', () => {
    const blocks = effectiveBlocks(SCHEMA.blocks, [customEntryFromCatalogue({
      ...CATALOGUE[0], algName: 'Needy',
      block: { ...CATALOGUE[0].block, name: 'Needy', dependencies: [{ blockName: 'Jets', required: true }] },
    })])
    const issues = validateConfig({ Needy: {} }, blocks)
    expect(msgs(issues)).toContain("warning:Needy:'Needy' requires block 'Jets', which is not present")
    expect(validateConfig({ Needy: {}, Jets: { containerName: 'A' } }, blocks)).toEqual([])
  })

  it('never throws on junk input', () => {
    expect(() => validate(null)).not.toThrow()
    expect(() => validate({ AddConfigBlocks: 'x', Jets: 5 })).not.toThrow()
  })
})

describe('matchesExpertRule', () => {
  it('handles markers, literals and the "any deviation" rule', () => {
    const opt = { default: 'd' }
    expect(matchesExpertRule(true, 'd', opt)).toBe(false)
    expect(matchesExpertRule(true, 'x', opt)).toBe(true)
    expect(matchesExpertRule('nonemptystring', 'x')).toBe(true)
    expect(matchesExpertRule('nonemptylist', [])).toBe(false)
    expect(matchesExpertRule('positiveint', 3)).toBe(true)
    expect(matchesExpertRule('Loose', 'Loose')).toBe(true)
    expect(matchesExpertRule(5, '5')).toBe(true)
  })
})

describe('buildIssueMap', () => {
  it('groups by path', () => {
    const map = buildIssueMap([{ path: 'a', m: 1 }, { path: 'a', m: 2 }, { path: 'b', m: 3 }])
    expect(map.a).toHaveLength(2)
    expect(map.b).toHaveLength(1)
  })
})
