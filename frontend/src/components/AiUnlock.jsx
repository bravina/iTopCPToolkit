import { useEffect, useState } from 'react'
import { BrandName } from '../App.jsx'
import { aiUnlocked, setAiUnlocked } from '../ai/settings.js'
import { aiGateConfigured, checkAiAccess } from '../api.js'

/**
 * The soft-launch unlock page, served at /withai and linked from nowhere.
 *
 * It asks the backend whether a password is configured at all, then posts the
 * attempt; the password itself never reaches the bundle.  A success is
 * remembered in `localStorage`, so the group can use the normal URL from then
 * on, and "Lock again" here removes it.
 *
 * What this is: a way to hand out a link without handing out the feature.
 * What it is not: access control.  The assistant's code ships in the bundle
 * either way and the unlock is a flag in this browser, so devtools defeats it.
 * That is enough here — the assistant is bring-your-own-key, so an uninvited
 * user reaches no budget of ours and no CERN service.
 */
export default function AiUnlock() {
  const [configured, setConfigured] = useState(null)   // null while asking
  const [unlocked, setUnlocked] = useState(() => aiUnlocked())
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    aiGateConfigured().then(yes => { if (alive) setConfigured(yes) })
    return () => { alive = false }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      if (await checkAiAccess(password)) {
        setAiUnlocked(true)
        setUnlocked(true)
        setPassword('')
      } else {
        setError('That password is not right.')
      }
    } catch (err) {
      setError(err.message || 'That password is not right.')
    } finally {
      setBusy(false)
    }
  }

  function handleLock() {
    setAiUnlocked(false)
    setUnlocked(false)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <p className="text-lg font-bold mb-1"><BrandName /></p>
        <p className="text-sm text-slate-500 mb-5">AI assistant — early access</p>

        {unlocked ? (
          <div className="space-y-3">
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              ✓ The assistant is unlocked in this browser.
            </p>
            <p className="text-xs text-slate-500">
              It stays unlocked on the normal address until you lock it again here,
              and it is still bring-your-own-key: nothing works until you connect a
              provider with your own API key.
            </p>
            <div className="flex items-center gap-2">
              <a href="/"
                className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white transition-colors">
                Open iTopCPToolkit
              </a>
              <button type="button" onClick={handleLock}
                className="text-sm px-3 py-1.5 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 transition-colors">
                Lock again
              </button>
            </div>
          </div>
        ) : configured === false ? (
          <p className="text-sm text-slate-500">
            Nothing to unlock here. <a href="/" className="text-blue-600 dark:text-blue-400 hover:underline">Back to the app</a>
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-sm text-slate-600 dark:text-slate-400" htmlFor="ai-password">
              Enter the password you were given.
            </label>
            <input
              id="ai-password" type="password" autoFocus autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            <div className="flex items-center gap-2">
              <button type="submit" disabled={busy || !password}
                className="text-sm px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors">
                {busy ? 'Checking…' : 'Unlock'}
              </button>
              <a href="/" className="text-sm text-slate-500 hover:underline">Back to the app</a>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
