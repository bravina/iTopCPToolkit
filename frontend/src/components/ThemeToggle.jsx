/**
 * Header control cycling the colour scheme: system → light → dark → system.
 * `theme` is the stored preference, `dark` what it currently resolves to.
 */
const LOOK = {
  system: { icon: '◐', label: 'Auto', next: 'light mode' },
  light:  { icon: '☀', label: 'Light', next: 'dark mode' },
  dark:   { icon: '☾', label: 'Dark', next: 'system theme' },
}

export default function ThemeToggle({ theme, dark, onCycle }) {
  const { icon, label, next } = LOOK[theme] ?? LOOK.system
  const current = theme === 'system' ? `system theme (${dark ? 'dark' : 'light'})` : `${theme} mode`

  return (
    <button
      type="button"
      onClick={onCycle}
      title={`Theme: ${current} — switch to ${next}`}
      aria-label={`Theme: ${current}. Switch to ${next}.`}
      className="text-sm px-2.5 py-1 rounded bg-slate-200/50 dark:bg-slate-700/50 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors shrink-0 flex items-center gap-1.5"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="hidden md:inline">{label}</span>
    </button>
  )
}
