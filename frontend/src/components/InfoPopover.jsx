import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

/**
 * A small ⓘ button that shows a markdown+LaTeX popover on hover/focus.
 * Positions itself above or below depending on available space.
 */
export default function InfoPopover({ info }) {
  const [open, setOpen] = useState(false)
  const [above, setAbove] = useState(false)
  const btnRef = useRef(null)

  useEffect(() => {
    if (open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      // Flip above if less than 220px below
      setAbove(window.innerHeight - rect.bottom < 220)
    }
  }, [open])

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
        className="ml-1 text-slate-400 hover:text-blue-300 focus:outline-none text-xs leading-none"
        aria-label="Show help"
      >
        ⓘ
      </button>

      {open && (
        <div
          className={`absolute z-50 left-4 w-80 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3 text-xs text-slate-200 leading-relaxed pointer-events-none
            ${above ? 'bottom-full mb-2' : 'top-full mt-2'}`}
          // Inline max-height so it never overflows viewport
          style={{ maxHeight: '40vh', overflowY: 'auto' }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              // Keep inline code styled nicely
              code: ({ children }) => (
                <code className="bg-slate-700 px-1 rounded font-mono">{children}</code>
              ),
              // Links open in new tab
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer"
                  className="text-blue-400 underline hover:text-blue-300">{children}</a>
              ),
              p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
            }}
          >
            {info}
          </ReactMarkdown>
        </div>
      )}
    </span>
  )
}
