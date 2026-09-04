import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

/**
 * A small ⓘ button that shows a markdown+LaTeX popover on hover/focus.
 *
 * The bubble is interactive: the pointer can travel from the button into the
 * bubble (a ~150 ms grace period keeps it open across the gap) so links inside
 * it are clickable.  Clicking the button *pins* the bubble open; a pinned
 * bubble ignores hover and closes on Escape, a second click, or a click
 * outside it.
 *
 * Uses position:fixed with measured coordinates so it is never clipped
 * by overflow:hidden/auto ancestor containers, and never goes off-screen.
 */
const CLOSE_DELAY = 150

export default function InfoPopover({ info }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [style, setStyle] = useState({})
  const btnRef = useRef(null)
  const popRef = useRef(null)
  const timerRef = useRef(null)
  const hoverRef = useRef({ btn: false, pop: false })
  const pinnedRef = useRef(false)
  const POPOVER_W = 320

  useEffect(() => { pinnedRef.current = pinned }, [pinned])

  const calcStyle = useCallback(() => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    // Horizontal: prefer opening leftward (aligns right edge with button)
    const left = r.right - POPOVER_W
    const clampedLeft = Math.max(8, Math.min(left, vw - POPOVER_W - 8))

    // Vertical: prefer below, flip above if not enough room
    const below = r.bottom + 6
    const above = r.top - 6

    const s = {
      position: 'fixed',
      zIndex: 9999,
      width: POPOVER_W,
      left: clampedLeft,
    }

    // Tentatively open below; if less than 200px below, open above
    if (vh - r.bottom > 200) {
      s.top = below
      s.maxHeight = Math.min(380, vh - below - 8)
    } else {
      s.bottom = vh - above
      s.maxHeight = Math.min(380, above - 8)
    }

    setStyle(s)
  }, [])

  const cancelClose = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** Close after the grace period, unless pinned or the pointer came back. */
  const scheduleClose = useCallback(() => {
    cancelClose()
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (pinnedRef.current) return
      if (hoverRef.current.btn || hoverRef.current.pop) return
      setOpen(false)
    }, CLOSE_DELAY)
  }, [cancelClose])

  const closeNow = useCallback(() => {
    cancelClose()
    hoverRef.current = { btn: false, pop: false }
    setPinned(false)
    setOpen(false)
  }, [cancelClose])

  function togglePin(e) {
    e.preventDefault()
    e.stopPropagation()
    cancelClose()
    if (pinned) {
      setPinned(false)
      setOpen(false)
    } else {
      setPinned(true)
      setOpen(true)
    }
  }

  // Recompute the position whenever the bubble opens, and keep it anchored
  // while it is open (the page or an inner panel may scroll under it).
  useEffect(() => {
    if (!open) return
    calcStyle()
    const onMove = () => calcStyle()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, calcStyle])

  // Escape closes (and unpins) whenever the bubble is showing.
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeNow()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, closeNow])

  // While pinned, a click anywhere outside the button/bubble dismisses it.
  useEffect(() => {
    if (!pinned) return
    function onDown(e) {
      if (btnRef.current?.contains(e.target)) return   // handled by the click toggle
      if (popRef.current?.contains(e.target)) return
      closeNow()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pinned, closeNow])

  // Never leave a timer behind.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  if (!info) return null

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={() => { hoverRef.current.btn = true; cancelClose(); setOpen(true) }}
        onMouseLeave={() => { hoverRef.current.btn = false; scheduleClose() }}
        onFocus={() => { cancelClose(); setOpen(true) }}
        onBlur={() => scheduleClose()}
        onClick={togglePin}
        aria-expanded={open}
        aria-label={pinned ? 'Hide help' : 'Show help'}
        title={pinned ? 'Click to unpin' : 'Click to pin open'}
        className={`ml-1 focus:outline-none text-xs leading-none select-none rounded transition-colors ${
          pinned
            ? 'text-blue-300 ring-1 ring-blue-400/70'
            : 'text-slate-500 hover:text-blue-300'
        }`}
      >
        ⓘ
      </button>

      {open && (
        <div
          ref={popRef}
          style={style}
          onMouseEnter={() => { hoverRef.current.pop = true; cancelClose() }}
          onMouseLeave={() => { hoverRef.current.pop = false; scheduleClose() }}
          className={`bg-slate-800 border rounded-lg shadow-2xl p-3 text-xs text-slate-200 leading-relaxed overflow-y-auto ${
            pinned ? 'border-blue-400/70' : 'border-slate-600'
          }`}
        >
          {pinned && (
            <button
              type="button"
              onClick={closeNow}
              title="Unpin"
              className="float-right ml-2 -mt-0.5 text-slate-500 hover:text-blue-300 leading-none"
            >
              📌
            </button>
          )}
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              code: ({ children }) => (
                <code className="bg-slate-700 px-1 rounded font-mono break-all">{children}</code>
              ),
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer"
                  className="text-blue-400 underline hover:text-blue-300 break-all">{children}</a>
              ),
              p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc ml-4 mb-1 space-y-0.5">{children}</ul>,
              li: ({ children }) => <li>{children}</li>,
            }}
          >
            {info}
          </ReactMarkdown>
        </div>
      )}
    </span>
  )
}
