import { describe, it, expect } from 'vitest'
import { escapeAction, ESC_WINDOW_MS } from '../utils/doubleEscape.js'

// The effect in App.jsx owns the timer; these cover the decisions it makes.
const inMode = { mode: 'builder', showSplash: false, searchOpen: false, typing: false, armed: false }

describe('Esc twice → mode selector', () => {
  it('arms on the first press and leaves on the second', () => {
    expect(escapeAction('Escape', inMode)).toBe('arm')
    expect(escapeAction('Escape', { ...inMode, armed: true })).toBe('leave')
  })

  it('ignores every other key, armed or not', () => {
    expect(escapeAction('Enter', inMode)).toBe('ignore')
    expect(escapeAction('e', { ...inMode, armed: true })).toBe('ignore')
    expect(escapeAction('Esc', inMode)).toBe('ignore')
  })

  it('does nothing on the menu itself', () => {
    expect(escapeAction('Escape', { ...inMode, mode: null })).toBe('ignore')
  })

  it('yields to the splash screen, which Esc already skips', () => {
    expect(escapeAction('Escape', { ...inMode, showSplash: true })).toBe('ignore')
  })

  it('yields to the search overlay, which Esc already closes', () => {
    expect(escapeAction('Escape', { ...inMode, searchOpen: true })).toBe('ignore')
    expect(escapeAction('Escape', { ...inMode, searchOpen: true, armed: true })).toBe('ignore')
  })

  it('never fires while typing, so Esc can cancel a field edit', () => {
    expect(escapeAction('Escape', { ...inMode, typing: true })).toBe('ignore')
    expect(escapeAction('Escape', { ...inMode, typing: true, armed: true })).toBe('ignore')
  })

  it('works the same in reader and intnote', () => {
    for (const mode of ['reader', 'intnote']) {
      expect(escapeAction('Escape', { ...inMode, mode })).toBe('arm')
      expect(escapeAction('Escape', { ...inMode, mode, armed: true })).toBe('leave')
    }
  })

  it('allows a comfortable but deliberate window', () => {
    expect(ESC_WINDOW_MS).toBeGreaterThanOrEqual(600)
    expect(ESC_WINDOW_MS).toBeLessThanOrEqual(2000)
  })
})
