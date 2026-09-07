import { describe, it, expect, afterEach } from 'vitest'
import { THEMES, THEME_KEY, isDarkTheme, nextTheme } from '../hooks/useTheme.js'

// The hook itself needs a DOM; these tests cover the pure decisions it makes.
function withSystemDark(dark, fn) {
  const prev = globalThis.window
  globalThis.window = { matchMedia: q => ({ matches: q.includes('dark') && dark }) }
  try { return fn() } finally { globalThis.window = prev }
}

afterEach(() => { delete globalThis.window })

describe('theme preference', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('starts the cycle over from an unknown stored value', () => {
    expect(nextTheme('sepia')).toBe('system')
  })

  it('lists system first, so it is the default', () => {
    expect(THEMES[0]).toBe('system')
    expect(THEME_KEY).toBe('itopcptoolkit.theme')
  })

  it('resolves an explicit choice without asking the OS', () => {
    withSystemDark(true, () => expect(isDarkTheme('light')).toBe(false))
    withSystemDark(false, () => expect(isDarkTheme('dark')).toBe(true))
  })

  it('follows the OS when set to system', () => {
    withSystemDark(true, () => expect(isDarkTheme('system')).toBe(true))
    withSystemDark(false, () => expect(isDarkTheme('system')).toBe(false))
  })
})
