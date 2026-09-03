/**
 * api.js — thin wrappers around the Flask endpoints.
 */

export const API_BASE = import.meta.env.VITE_API_URL || ''

async function asJson(resp) {
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
  return data
}

/** GET /api/schema → the schema document (blocks, catalogue, examples, versions, …). */
export async function fetchSchema() {
  return asJson(await fetch(`${API_BASE}/api/schema`))
}

/**
 * POST /api/introspect with an AddConfigBlocks entry → its schema block.
 * Throws with the backend's message when the module cannot be imported.
 */
export async function introspectEntry(entry) {
  const data = await asJson(await fetch(`${API_BASE}/api/introspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modulePath: entry.modulePath, functionName: entry.functionName, algName: entry.algName,
      pos: entry.pos ?? null, superBlocks: entry.superBlocks ?? null,
    }),
  }))
  return data.block
}

/** GET /api/examples/<path> → YAML text of one reference config. */
export async function fetchExample(path) {
  const resp = await fetch(`${API_BASE}/api/examples/${path}`)
  if (!resp.ok) throw new Error(`Cannot load example '${path}' (HTTP ${resp.status})`)
  return resp.text()
}
