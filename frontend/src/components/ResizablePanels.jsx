import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * Horizontal resizable panel layout, similar to VS Code.
 *
 * Props:
 *   children      – array of React nodes (the panels)
 *   initialSizes  – array of percentages, e.g. [20, 50, 30] (must sum to 100)
 *   minSize       – minimum % each panel can shrink to (default 8)
 */
export default function ResizablePanels({ children, initialSizes, minSize = 8 }) {
  const panels = Array.isArray(children) ? children : [children]
  const count = panels.length
  const [sizes, setSizes] = useState(
    initialSizes ?? Array(count).fill(100 / count)
  )
  const containerRef = useRef(null)
  const dragging = useRef(null)

  const startDrag = useCallback((e, index) => {
    e.preventDefault()
    dragging.current = { index, startX: e.clientX, startSizes: [...sizes] }
  }, [sizes])

  useEffect(() => {
    function onMove(e) {
      if (!dragging.current || !containerRef.current) return
      const { index, startX, startSizes } = dragging.current
      const totalW = containerRef.current.getBoundingClientRect().width
      const delta = ((e.clientX - startX) / totalW) * 100
      const next = [...startSizes]
      next[index]     = startSizes[index]     + delta
      next[index + 1] = startSizes[index + 1] - delta
      if (next[index] < minSize || next[index + 1] < minSize) return
      setSizes(next)
    }
    function onUp() { dragging.current = null }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [minSize])

  // Build interleaved array: panel, divider, panel, divider, panel ...
  const items = []
  panels.forEach((panel, i) => {
    items.push(
      <div
        key={`panel-${i}`}
        className="flex flex-col overflow-hidden h-full"
        style={{ width: `${sizes[i]}%`, minWidth: 0, flexShrink: 0 }}
      >
        {panel}
      </div>
    )
    if (i < count - 1) {
      items.push(
        <div
          key={`divider-${i}`}
          onMouseDown={e => startDrag(e, i)}
          className="w-1 shrink-0 bg-slate-700 hover:bg-blue-500 cursor-col-resize transition-colors active:bg-blue-400"
          title="Drag to resize"
        />
      )
    }
  })

  return (
    <div ref={containerRef} className="flex flex-1 overflow-hidden h-full select-none">
      {items}
    </div>
  )
}
