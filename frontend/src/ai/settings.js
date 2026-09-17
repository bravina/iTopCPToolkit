/**
 * settings.js — where the assistant's configuration lives.
 *
 * The provider and model are a preference (localStorage); the API key is a
 * secret and stays in `sessionStorage`, so it dies with the tab and never
 * reaches the Flask backend — every provider call is made from the browser.
 *
 * The feature is off unless it is turned on: `VITE_AI_ENABLED` decides between
 * off, gated behind a password, and on (see `aiBuildMode`), and outside a dev
 * server off is the default.  With it available but no key entered, the UI is
 * limited to the "connect" affordance.
 */

import { getProvider } from './providers.js'

const PREF_KEY = 'itopcptoolkit.ai.v1'
const KEY_PREFIX = 'itopcptoolkit.ai.key.'
const UNLOCK_KEY = 'itopcptoolkit.ai.unlocked.v1'

/**
 * How this build ships the assistant.  `VITE_AI_ENABLED` is baked in by Vite,
 * so one bundle cannot mean different things at different URLs:
 *
 *   'off'   — 0, unset outside a dev server, or anything unrecognised:
 *             no AI UI exists anywhere.
 *   'gated' — the code is in the bundle but renders nothing until this browser
 *             is unlocked at /withai with the password the server holds.
 *   'on'    — 1/true, and a dev server by default: always available.
 */
export function aiBuildMode(env = import.meta.env) {
  const flag = env?.VITE_AI_ENABLED
  if (flag === undefined || flag === '') return env?.DEV ? 'on' : 'off'
  if (flag === '1' || flag === 'true') return 'on'
  if (flag === 'gated') return 'gated'
  return 'off'
}

/**
 * The one route in an otherwise single-screen app: where a gated build is
 * unlocked.  Deliberately unlinked — it is only ever arrived at by being told.
 */
export const AI_UNLOCK_PATH = '/withai'

export function isAiUnlockPath(pathname = '') {
  return pathname.replace(/\/+$/, '').toLowerCase() === AI_UNLOCK_PATH
}

/** Has this browser been let through the gate?  Survives visits; see aiEnabled. */
export function aiUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === '1' } catch { return false }
}

export function setAiUnlocked(on) {
  try {
    if (on) localStorage.setItem(UNLOCK_KEY, '1')
    else localStorage.removeItem(UNLOCK_KEY)
  } catch { /* quota / private mode */ }
}

/**
 * Is the assistant available right now?  Every AI affordance hangs off this.
 *
 * A gated build is a soft launch, not access control.  It keeps the password —
 * and so the feature — out of a link that gets forwarded, but the assistant's
 * modules are in the bundle whatever the answer here, and the unlock is a flag
 * in this browser that devtools can set directly.  That is enough because the
 * assistant is bring-your-own-key: there is no budget and no CERN service
 * behind it for an uninvited user to reach.
 */
export function aiEnabled(env = import.meta.env) {
  const mode = aiBuildMode(env)
  return mode === 'on' || (mode === 'gated' && aiUnlocked())
}

/** What "Explain this" should offer: nothing, an invitation to connect, or an ask. */
export function explainStatus(available, connection) {
  if (!available) return 'off'
  return connection ? 'ready' : 'disconnected'
}

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    const data = raw ? JSON.parse(raw) : null
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

export function savePrefs(prefs) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)) } catch { /* quota / private mode */ }
}

export function loadKey(providerId) {
  try { return sessionStorage.getItem(KEY_PREFIX + providerId) || '' } catch { return '' }
}

export function saveKey(providerId, key) {
  try {
    if (key) sessionStorage.setItem(KEY_PREFIX + providerId, key)
    else sessionStorage.removeItem(KEY_PREFIX + providerId)
  } catch { /* ignore */ }
}

export function clearKey(providerId) { saveKey(providerId, '') }

const NO_TOOLS_KEY = 'itopcptoolkit.ai.notools.v1'

const noToolsId = (providerId, model) => `${providerId}/${model}`

function noToolsList() {
  try {
    const raw = JSON.parse(localStorage.getItem(NO_TOOLS_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

/**
 * Models the provider has already refused to run tools on.  Remembered so the
 * model field can warn about a hand-typed one — the picker's own probe only
 * covers providers that can be asked in advance.
 */
export function rememberNoToolSupport(providerId, model) {
  if (!providerId || !model) return
  const id = noToolsId(providerId, model)
  const list = noToolsList()
  if (list.includes(id)) return
  try { localStorage.setItem(NO_TOOLS_KEY, JSON.stringify([...list, id].slice(-50))) } catch { /* quota */ }
}

export function hasNoToolSupport(providerId, model) {
  return !!providerId && !!model && noToolsList().includes(noToolsId(providerId, model))
}

/**
 * The stored connection, or null when nothing usable is configured — which
 * includes a remembered provider whose key is gone because this is a new tab.
 */
export function loadConnection(provider = getProvider) {
  const prefs = loadPrefs()
  if (!prefs.provider || !prefs.model) return null
  const apiKey = loadKey(prefs.provider)
  if (!apiKey && provider(prefs.provider)?.requiresKey !== false) return null
  return { provider: prefs.provider, model: prefs.model, apiKey }
}
