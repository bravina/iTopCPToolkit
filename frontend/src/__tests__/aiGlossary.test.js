import { describe, it, expect } from 'vitest'
import {
  GLOSSARY_FIELDS, conceptWords, getEntry, glossaryEntries, glossaryProblems, glossaryVersion,
  matchConcept, parseGlossary,
} from '../ai/glossary.js'

const ids = result => result.matches.map(e => e.id)

describe('the shipped glossary', () => {
  it('parses, is versioned and validates clean', () => {
    expect(glossaryProblems()).toEqual([])
    expect(typeof glossaryVersion()).toBe('number')
    expect(glossaryEntries().length).toBeGreaterThan(0)
  })

  it('gives every entry the full shape, with prose fields present even when empty', () => {
    for (const entry of glossaryEntries()) {
      expect(entry.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
      expect(entry.title.length).toBeGreaterThan(0)
      expect(Array.isArray(entry.aliases)).toBe(true)
      expect(Array.isArray(entry.see_also)).toBe(true)
      expect(Array.isArray(entry.refs)).toBe(true)
      expect(typeof entry.reviewed).toBe('boolean')
      for (const field of GLOSSARY_FIELDS) expect(typeof entry[field]).toBe('string')
    }
  })

  it('ships its seed entries unreviewed — the physics is not ours to assert', () => {
    // Flipping one of these to true is a physicist's act, not a refactor's.
    expect(glossaryEntries().filter(e => e.reviewed)).toEqual([])
  })

  it('looks an entry up by id', () => {
    expect(getEntry('jvt').title).toBe('Jet Vertex Tagger')
    expect(getEntry('no-such-entry')).toBeNull()
  })
})

describe('conceptWords', () => {
  it('splits camelCase, runs of capitals and punctuation alike', () => {
    expect(conceptWords('runNNJvtUpdate')).toEqual(['run', 'nn', 'jvt', 'update'])
    expect(conceptWords('b-tagging')).toEqual(['b', 'tagging'])
    expect(conceptWords('%SYS%')).toEqual(['sys'])
    expect(conceptWords('Jets.JVT')).toEqual(['jets', 'jvt'])
    expect(conceptWords(null)).toEqual([])
  })
})

describe('matching', () => {
  it('matches an option name through an alias, whatever its case', () => {
    expect(ids(matchConcept('jvtWP'))[0]).toBe('jvt')
    expect(ids(matchConcept('JVTWP'))[0]).toBe('jvt')
    expect(ids(matchConcept('runJvtSelection'))[0]).toBe('jvt')
  })

  it('matches a block or sub-block name', () => {
    expect(ids(matchConcept('Jets.JVT'))[0]).toBe('jvt')
    expect(ids(matchConcept('PileupReweighting'))[0]).toBe('pileup')
  })

  it('matches plain concept words, hyphenated or not', () => {
    expect(ids(matchConcept('b-tagging'))[0]).toBe('flavour-tagging')
    expect(ids(matchConcept('B-Tagging'))[0]).toBe('flavour-tagging')
    expect(ids(matchConcept('flavour tagging'))[0]).toBe('flavour-tagging')
    expect(ids(matchConcept('pileup'))[0]).toBe('pileup')
  })

  it('finds the concept inside a whole question', () => {
    expect(ids(matchConcept('what does JVT actually do?'))[0]).toBe('jvt')
    expect(ids(matchConcept('why do I need pileup reweighting'))[0]).toBe('pileup')
  })

  it('takes a list of strings — an Explain target is more than one word', () => {
    expect(ids(matchConcept(['Jets', 'jvtWP', 'bool']))[0]).toBe('jvt')
  })

  it('is deterministic and capped', () => {
    const once = ids(matchConcept('pileup jets'))
    expect(ids(matchConcept('pileup jets'))).toEqual(once)
    expect(once.length).toBeLessThanOrEqual(3)
    expect(ids(matchConcept('pileup jets', { limit: 1 }))).toEqual([once[0]])
  })

  it('offers near misses instead of a match when the query only nearly lands', () => {
    const near = matchConcept('pileups')
    expect(near.matches).toEqual([])
    expect(near.suggestions.map(e => e.id)).toContain('pileup')
  })

  it('returns nothing at all for a query with nothing to offer', () => {
    const miss = matchConcept('luminosity')
    expect(miss.matches).toEqual([])
    expect(miss.suggestions.map(e => e.id)).not.toContain('jvt')
  })

  it('treats an empty query as a miss rather than a match', () => {
    expect(matchConcept('')).toEqual({ matches: [], suggestions: [] })
    expect(matchConcept(null)).toEqual({ matches: [], suggestions: [] })
  })
})

describe('parseGlossary', () => {
  const doc = entries => `version: 1\nentries:\n${entries}`

  it('keeps a well-formed entry and normalises its optional fields', () => {
    const { version, entries, problems } = parseGlossary(doc(
      '  - id: reviewed-one\n'
      + '    title: A reviewed entry\n'
      + '    what: It does a thing.\n'
      + '    reviewed: true\n',
    ))
    expect(problems).toEqual([])
    expect(version).toBe(1)
    expect(entries).toEqual([{
      id: 'reviewed-one', title: 'A reviewed entry', aliases: [], see_also: [], refs: [],
      reviewed: true, what: 'It does a thing.', why: '', choosing: '', pitfalls: '',
    }])
  })

  it('drops an entry with no reviewed flag, and says why', () => {
    const { entries, problems } = parseGlossary(doc('  - id: nameless\n    title: No flag\n'))
    expect(entries).toEqual([])
    expect(problems[0]).toContain('reviewed must be true or false')
  })

  it('reports a bad id, a duplicate, a missing title and a ref with no url', () => {
    const { entries, problems } = parseGlossary(doc(
      '  - id: Not An Id\n    title: Bad id\n    reviewed: false\n'
      + '  - id: dup\n    title: First\n    reviewed: false\n'
      + '  - id: dup\n    title: Second\n    reviewed: false\n'
      + '  - id: untitled\n    reviewed: false\n'
      + '  - id: refless\n    title: Refs\n    reviewed: false\n    refs:\n      - title: no url\n',
    ))
    expect(entries.map(e => e.id)).toEqual(['dup'])
    expect(problems.join('\n')).toMatch(/must be lower-case/)
    expect(problems.join('\n')).toMatch(/duplicate id 'dup'/)
    expect(problems.join('\n')).toMatch(/a title is required/)
    expect(problems.join('\n')).toMatch(/every ref needs a url/)
  })

  it('flags a see_also that points nowhere', () => {
    const { entries, problems } = parseGlossary(doc(
      '  - id: lonely\n    title: Lonely\n    reviewed: false\n    see_also: [ghost]\n',
    ))
    expect(entries.map(e => e.id)).toEqual(['lonely'])
    expect(problems[0]).toContain("unknown entry 'ghost'")
  })

  it('survives a document that is not a glossary at all', () => {
    expect(parseGlossary('- just\n- a list\n').problems[0]).toContain('must be a mapping')
    expect(parseGlossary('entries: [}').problems[0]).toContain('unparseable YAML')
    expect(parseGlossary('version: 1\nentries: nope\n').problems).toContain('entries must be a list')
  })
})
