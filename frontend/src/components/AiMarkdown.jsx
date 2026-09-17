import { useState } from 'react'
import ReactMarkdown from 'react-markdown'

/** Flatten a hast node back to its source text (used for the copy buttons). */
function nodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(nodeText).join('')
}

/** Copy-to-clipboard button, same "✓ Copied" beat as the YAML preview's. */
export function CopyButton({ text, className = '', label = 'Copy' }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button type="button" onClick={handleCopy} title="Copy to clipboard"
      className={`text-xs px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-700/80 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 transition-colors ${className}`}>
      {copied ? '✓ Copied' : label}
    </button>
  )
}

/**
 * The assistant's Markdown.
 *
 * react-markdown 9 dropped the `inline` prop, so block code is recognised by
 * the `pre` it sits in rather than by a flag on `code`: `pre` renders the block
 * (from the node's own text, so the inline styling below never reaches it) and
 * `code` is left to style inline spans only.
 */
export default function AiMarkdown({ children }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="list-disc ml-4 mb-1.5 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal ml-4 mb-1.5 space-y-0.5">{children}</ol>,
        pre: ({ node, children }) => {
          const text = nodeText(node).replace(/\n$/, '')
          return (
            <div className="relative group/code my-1.5">
              <pre className="bg-slate-100 dark:bg-slate-800 rounded p-2 overflow-x-auto">
                <code className="font-mono text-xs">{text || children}</code>
              </pre>
              {text && (
                <CopyButton text={text}
                  className="absolute top-1 right-1 opacity-0 group-hover/code:opacity-100 focus:opacity-100" />
              )}
            </div>
          )
        },
        code: ({ node, children, ...props }) => (
          <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1 rounded" {...props}>{children}</code>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">{children}</a>
        ),
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
      }}
    >
      {children}
    </ReactMarkdown>
  )
}
