import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

/**
 * Where an "Explain this" click goes.
 *
 * The action sits inside InfoPopover, which is mounted all over Builder and
 * Reader and several components deep; a context keeps the wiring out of the
 * option list and the sub-block section, which know nothing about the
 * assistant.  Whoever hosts the assistant panel provides the value.
 *
 * status: 'off'          — no assistant in this build; the action is absent
 *         'disconnected' — the action offers to connect instead of asking
 *         'ready'        — the action asks
 */
const ExplainContext = createContext({ status: 'off' })

export const ExplainProvider = ExplainContext.Provider

export function useExplain() {
  return useContext(ExplainContext)
}

/**
 * The host side: one pending request, handed to the panel and cleared once it
 * has been sent.  A request survives a busy panel — the panel picks it up when
 * the current exchange finishes — so the click is never silently dropped.
 */
export function useExplainRequests({ status, onConnect, onAsk }) {
  const [request, setRequest] = useState(null)
  const nextId = useRef(0)

  const explain = useCallback((locator) => {
    onAsk?.()
    nextId.current += 1
    setRequest({ id: nextId.current, locator })
  }, [onAsk])

  const clear = useCallback((id) => {
    setRequest(r => (r && r.id === id ? null : r))
  }, [])

  const value = useMemo(
    () => ({ status, explain, connect: onConnect }),
    [status, explain, onConnect])

  return { value, request, clear }
}
