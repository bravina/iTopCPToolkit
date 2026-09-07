import { useCallback, useEffect, useState } from 'react'

/**
 * Colour scheme: 'system' (follow the OS), 'light' or 'dark'.
 *
 * The choice is persisted in localStorage and applied as a `dark` class on
 * <html>, which is what Tailwind's `darkMode: 'class'` keys off.  index.html
 * applies the same rule before the first paint — keep the two in sync.
 */
export const THEME_KEY = 'itopcptoolkit.theme'
export const THEMES = ['system', 'light', 'dark']

const DARK_QUERY = '(prefers-color-scheme: dark)'

function prefersDark() {
  return window.matchMedia?.(DARK_QUERY).matches ?? false
}

function storedTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return THEMES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/** True when `theme` resolves to dark right now. */
export function isDarkTheme(theme) {
  return theme === 'dark' || (theme === 'system' && prefersDark())
}

/** The next theme in the toggle's cycle: system → light → dark → system. */
export function nextTheme(theme) {
  const i = THEMES.indexOf(theme)
  return THEMES[(i < 0 ? 0 : i + 1) % THEMES.length]
}

function applyTheme(theme) {
  const dark = isDarkTheme(theme)
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  // Native widgets (scrollbars, form controls) follow this.
  root.style.colorScheme = dark ? 'dark' : 'light'
  return dark
}

export function useTheme() {
  const [theme, setThemeState] = useState(storedTheme)
  // Re-render when the OS flips while we are following it.
  const [systemDark, setSystemDark] = useState(prefersDark)

  useEffect(() => { applyTheme(theme) }, [theme])

  useEffect(() => {
    const mq = window.matchMedia?.(DARK_QUERY)
    if (!mq) return
    const handler = e => {
      setSystemDark(e.matches)
      applyTheme(storedTheme())
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const setTheme = useCallback(next => {
    setThemeState(next)
    try { localStorage.setItem(THEME_KEY, next) } catch { /* private mode: this session only */ }
  }, [])

  const cycleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = nextTheme(prev)
      try { localStorage.setItem(THEME_KEY, next) } catch { /* private mode: this session only */ }
      return next
    })
  }, [])

  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  return { theme, dark, setTheme, cycleTheme }
}
