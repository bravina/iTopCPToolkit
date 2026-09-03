/**
 * autosave.js — keep the builder state in localStorage so a reload does not
 * lose work.  Every access is guarded: storage may be unavailable or full.
 */

import { initialConfig } from './configState.js'
import { effectiveBlocks } from './schema.js'

const KEY = 'itopcptoolkit.builder.v1'

export function loadAutosave() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return data && data.config && data.config.blocks ? data : null
  } catch {
    return null
  }
}

export function saveAutosave(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now() }))
  } catch { /* quota / private mode — ignore */ }
}

export function clearAutosave() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

/**
 * Re-base a saved config onto the current schema: blocks that still exist
 * keep their saved state, new blocks appear disabled, blocks that vanished
 * from the schema are moved to `unknown` so they are not silently lost.
 */
export function mergeRestored(saved, schema) {
  const customEntries = Array.isArray(saved.addConfigBlocks) ? saved.addConfigBlocks : []
  const blocks = effectiveBlocks(schema?.blocks, customEntries)
  const config = initialConfig(blocks)
  config.addConfigBlocks = customEntries
  config.unknown = { ...(saved.unknown || {}) }
  const known = new Set(blocks.map(b => b.name))
  for (const [name, state] of Object.entries(saved.blocks || {})) {
    if (known.has(name)) config.blocks[name] = state
    else if (state?.enabled) config.unknown[name] = state.instances?.map(i => i.options) ?? []
  }
  return config
}
