import { describe, it, expect } from 'vitest'
import {
  stripSave, splitCutLines, joinCutLines, parseCutLine, serializeCutLine, defaultArgs,
} from '../utils/eventSelection.js'

const KEYWORDS = {
  EL_N: { info: 'electron count', args: [
    { name: 'sel', type: 'str', optional: true }, { name: 'ptmin', type: 'float' },
    { name: 'sign', type: 'sign' }, { name: 'count', type: 'int' } ] },
  OS: { info: 'opposite sign', args: [] },
  EXPR: { info: 'expression', freeText: true },
  RUN_NUMBER: { args: [{ name: 'sign', type: 'sign' }, { name: 'ref', type: 'int' }] },
}

describe('SAVE handling and line splitting', () => {
  it('strips SAVE lines and reports it', () => {
    expect(stripSave('EL_N 25000 >= 1\nSAVE\n')).toEqual({ text: 'EL_N 25000 >= 1\n', hadSave: true })
    expect(stripSave('EL_N 25000 >= 1').hadSave).toBe(false)
  })
  it('splits and joins', () => {
    const lines = splitCutLines('  EL_N 25000 >= 1 \n\n# c\nOS')
    expect(lines.map(l => l.raw)).toEqual(['EL_N 25000 >= 1', '# c', 'OS'])
    expect(new Set(lines.map(l => l.id)).size).toBe(3)
    expect(joinCutLines(lines)).toBe('EL_N 25000 >= 1\n# c\nOS')
  })
})

describe('parseCutLine', () => {
  it('is opaque without a keyword spec', () => {
    const p = parseCutLine('EL_N 25000 >= 1', null)
    expect(p).toEqual({ keyword: 'EL_N', raw: 'EL_N 25000 >= 1', spec: null, args: null, error: null })
  })
  it('fills required and optional arguments', () => {
    expect(parseCutLine('EL_N 25000 >= 1', KEYWORDS).args).toEqual({ sel: '', ptmin: '25000', sign: '>=', count: '1' })
    expect(parseCutLine('EL_N tight 25000 >= 1', KEYWORDS).args).toEqual({ sel: 'tight', ptmin: '25000', sign: '>=', count: '1' })
    expect(parseCutLine('OS', KEYWORDS).args).toEqual({})
    expect(parseCutLine('EXPR dR(jet[0],jet[1]) > 0.4', KEYWORDS).args).toEqual({ text: 'dR(jet[0],jet[1]) > 0.4' })
  })
  it('reports unknown keywords and bad argument counts', () => {
    expect(parseCutLine('BOGUS 1', KEYWORDS).error).toBe("Unknown keyword 'BOGUS'")
    const bad = parseCutLine('EL_N 1', KEYWORDS)
    expect(bad.args).toBeNull()
    expect(bad.error).toBe('EL_N expects 3–4 arguments, got 1')
    expect(parseCutLine('RUN_NUMBER >= 1 2', KEYWORDS).error).toBe('RUN_NUMBER expects 2 arguments, got 3')
  })
  it('ignores blank lines and comments', () => {
    expect(parseCutLine('# hi', KEYWORDS).keyword).toBeNull()
  })
})

describe('serializeCutLine', () => {
  it('round-trips through parseCutLine', () => {
    for (const line of ['EL_N 25000 >= 1', 'EL_N tight 25000 >= 1', 'OS', 'EXPR pt(el[0]) > 30000', 'RUN_NUMBER >= 400000']) {
      const p = parseCutLine(line, KEYWORDS)
      expect(serializeCutLine(p.keyword, p.args, KEYWORDS)).toBe(line)
    }
  })
  it('defaultArgs gives empty values with >= for signs', () => {
    expect(defaultArgs('EL_N', KEYWORDS)).toEqual({ sel: '', ptmin: '', sign: '>=', count: '' })
    expect(defaultArgs('EXPR', KEYWORDS)).toEqual({ text: '' })
    expect(defaultArgs('NOPE', KEYWORDS)).toBeNull()
  })
})
