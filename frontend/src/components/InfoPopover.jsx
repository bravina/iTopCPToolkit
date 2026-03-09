import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

/**
 * A small ⓘ button that shows a markdown+LaTeX popover on hover/focus.
 * Uses position:fixed with measured coordinates so it is never clipped
 * by overflow:hidden/auto ancestor containers, and never goes off-screen.
 */
export default function InfoPopover({ info }) {
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState({})
  const btnRef = useRef(null)
  const POPOVER_W = 320
  const POPOVER_MIN_H = 40  // rough estimate for initial placement

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

  useEffect(() => {
    if (open) calcStyle()
  }, [open, calcStyle])

  if (!info) return null

  return (
    <span className="relative inline-flex items-center">
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="ml-1 text-slate-500 hover:text-blue-300 focus:outline-none text-xs leading-none select-none"
        aria-label="Show help"
      >
        ⓘ
      </button>

      {open && (
        <div
          style={style}
          className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-3 text-xs text-slate-200 leading-relaxed pointer-events-none overflow-y-auto"
        >
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
