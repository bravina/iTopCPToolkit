import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AI_UNLOCK_PATH, aiBuildMode, aiEnabled, aiUnlocked, explainStatus, isAiUnlockPath, setAiUnlocked,
} from '../ai/settings.js'
import { AiHeaderButton } from '../App.jsx'
import AiUnlock from '../components/AiUnlock.jsx'
import { Toolbar } from '../components/ConfigReader.jsx'
import { ExplainAction } from '../components/InfoPopover.jsx'

const GATED = { VITE_AI_ENABLED: 'gated' }
const ON = { VITE_AI_ENABLED: '1' }
const OFF = {}

/** localStorage does not exist in the test environment; the gate reads it. */
function fakeStorage() {
  const map = new Map()
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  }
}

beforeEach(() => { globalThis.localStorage = fakeStorage() })
afterEach(() => { delete globalThis.localStorage })

const markup = el => renderToStaticMarkup(el)

describe('the three build states', () => {

  it('is absent without the flag — today\'s behaviour, unlock or no unlock', () => {
    expect(aiBuildMode(OFF)).toBe('off')
    expect(aiEnabled(OFF)).toBe(false)
    setAiUnlocked(true)
    expect(aiEnabled(OFF)).toBe(false)
  })

  it('treats an explicit 0, and anything unrecognised, as off', () => {
    setAiUnlocked(true)
    for (const flag of ['0', 'yes', 'GATED', 'off']) {
      expect(aiBuildMode({ VITE_AI_ENABLED: flag, DEV: true })).toBe('off')
      expect(aiEnabled({ VITE_AI_ENABLED: flag, DEV: true })).toBe(false)
    }
  })

  it('is always on at 1, true, or on a dev server', () => {
    expect(aiBuildMode(ON)).toBe('on')
    expect(aiBuildMode({ VITE_AI_ENABLED: 'true' })).toBe('on')
    expect(aiBuildMode({ DEV: true })).toBe('on')
    expect(aiEnabled(ON)).toBe(true)          // no unlock needed
    expect(aiEnabled({ DEV: true })).toBe(true)
  })

  it('waits for an unlock when gated', () => {
    expect(aiBuildMode(GATED)).toBe('gated')
    expect(aiEnabled(GATED)).toBe(false)
    setAiUnlocked(true)
    expect(aiEnabled(GATED)).toBe(true)
  })
})

describe('the unlock', () => {

  it('persists, so the group can use the normal URL afterwards', () => {
    expect(aiUnlocked()).toBe(false)
    setAiUnlocked(true)
    expect(aiUnlocked()).toBe(true)
    expect(localStorage.getItem('itopcptoolkit.ai.unlocked.v1')).toBe('1')
  })

  it('can be revoked', () => {
    setAiUnlocked(true)
    setAiUnlocked(false)
    expect(aiUnlocked()).toBe(false)
    expect(aiEnabled(GATED)).toBe(false)
  })

  it('survives storage that refuses to co-operate', () => {
    globalThis.localStorage = {
      getItem() { throw new Error('private mode') },
      setItem() { throw new Error('private mode') },
      removeItem() { throw new Error('private mode') },
    }
    expect(() => setAiUnlocked(true)).not.toThrow()
    expect(aiUnlocked()).toBe(false)
    expect(aiEnabled(GATED)).toBe(false)
  })
})

describe('the unlock route', () => {

  it('matches /withai only', () => {
    expect(AI_UNLOCK_PATH).toBe('/withai')
    expect(isAiUnlockPath('/withai')).toBe(true)
    expect(isAiUnlockPath('/withai/')).toBe(true)
    expect(isAiUnlockPath('/WithAI')).toBe(true)
    for (const p of ['/', '', '/builder', '/withaiX', '/with-ai']) {
      expect(isAiUnlockPath(p)).toBe(false)
    }
  })

  it('shows a password form, and a way to lock again once unlocked', () => {
    const locked = markup(createElement(AiUnlock))
    expect(locked).toContain('type="password"')
    expect(locked).toContain('Unlock')
    expect(locked).not.toContain('Lock again')

    setAiUnlocked(true)
    const open = markup(createElement(AiUnlock))
    expect(open).toContain('Lock again')
    expect(open).not.toContain('type="password"')
  })
})

/**
 * The point of the whole exercise: a gated build that nobody has unlocked must
 * look exactly like a build with no assistant in it.  Each surface is checked
 * where it actually decides — the Builder's header button, the Reader's
 * toolbar, and the "Explain this" action every ⓘ popover carries.
 */
describe('gated and locked shows no assistant UI', () => {
  const CONNECTION = { provider: 'anthropic', model: 'claude', apiKey: 'sk-x' }
  const LOCATOR = { kind: 'block', block: 'Jets' }
  const READER_PROPS = {
    config: { Jets: {} }, errorCount: 0, warnCount: 0, depCount: 0,
    isDiff: false, showIssues: false, sidebarOpen: true, aiConnected: true, aiOpen: true,
  }

  const surfaces = (available) => ({
    header: markup(createElement(AiHeaderButton,
      { available, connection: CONNECTION, open: true, onClick() {} })),
    reader: markup(createElement(Toolbar, { ...READER_PROPS, aiAvailable: available })),
    explain: markup(createElement(ExplainAction,
      { locator: LOCATOR, status: explainStatus(available, CONNECTION) })),
  })

  it('renders nothing for the assistant while locked', () => {
    const { header, reader, explain } = surfaces(aiEnabled(GATED))
    expect(header).toBe('')
    expect(explain).toBe('')
    expect(reader).not.toContain('🤖')
    expect(reader).not.toContain('Assistant')
    // The rest of the Reader toolbar is untouched.
    expect(reader).toContain('Open in Builder')
  })

  // Even a connection left over from an earlier, ungated visit stays inert.
  it('stays silent with a stored connection and stored preferences', () => {
    expect(explainStatus(aiEnabled(GATED), CONNECTION)).toBe('off')
    expect(explainStatus(aiEnabled(OFF), CONNECTION)).toBe('off')
  })

  it('brings all three back once unlocked', () => {
    setAiUnlocked(true)
    const { header, reader, explain } = surfaces(aiEnabled(GATED))
    expect(header).toContain('🤖')
    expect(reader).toContain('🤖')
    expect(explain).toContain('Explain this')
  })
})
