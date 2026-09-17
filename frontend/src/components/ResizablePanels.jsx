import { useState, useCallback, useRef, useEffect } from 'react'

/** Everything that differs between a row of panels and a column of them. */
const AXES = {
  horizontal: {
    container: 'flex-row',
    panel: 'h-full',
    style: pct => ({ width: `${pct}%`, minWidth: 0, flexShrink: 0 }),
    divider: 'w-1 cursor-col-resize',
    coord: e => e.clientX,
    extent: rect => rect.width,
  },
  vertical: {
    container: 'flex-col',
    panel: 'w-full',
    style: pct => ({ height: `${pct}%`, minHeight: 0, flexShrink: 0 }),
    divider: 'h-1 cursor-row-resize',
    coord: e => e.clientY,
    extent: rect => rect.height,
  },
}

/**
 * Resizable panel layout, similar to VS Code.
 *
 * Props:
 *   children      – array of React nodes (the panels)
 *   initialSizes  – array of percentages, e.g. [20, 50, 30] (must sum to 100)
 *   minSize       – minimum % each panel can shrink to (default 8)
 *   direction     – 'horizontal' (default) or 'vertical'
 *   sizes         – controlled sizes; with onSizesChange, lets the caller keep
 *                   the split across a remount (default: kept internally)
 *   onSizesChange – receives the new sizes while dragging
 */
export default function ResizablePanels({
  children, initialSizes, minSize = 8, direction = 'horizontal', sizes: controlled, onSizesChange,
}) {
  const axis = AXES[direction] ?? AXES.horizontal
  const panels = Array.isArray(children) ? children : [children]
  const count = panels.length
  const [own, setOwn] = useState(
    initialSizes ?? Array(count).fill(100 / count)
  )
  const sizes = controlled ?? own
  const setSizes = onSizesChange ?? setOwn
  const containerRef = useRef(null)
  const dragRef = useRef(null)
  // Text selection is suppressed only while a divider is being dragged —
  // suppressing it always would make the panels' own content uncopyable.
  const [dragging, setDragging] = useState(false)

  const startDrag = useCallback((e, index) => {
    e.preventDefault()
    dragRef.current = { index, start: axis.coord(e), startSizes: [...sizes] }
    setDragging(true)
  }, [sizes, axis])

  useEffect(() => {
    function onMove(e) {
      if (!dragRef.current || !containerRef.current) return
      const { index, start, startSizes } = dragRef.current
      const total = axis.extent(containerRef.current.getBoundingClientRect())
      const delta = ((axis.coord(e) - start) / total) * 100
      const next = [...startSizes]
      next[index]     = startSizes[index]     + delta
      next[index + 1] = startSizes[index + 1] - delta
      if (next[index] < minSize || next[index + 1] < minSize) return
      setSizes(next)
    }
    function onUp() {
      if (!dragRef.current) return
      dragRef.current = null
      setDragging(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [minSize, axis, setSizes])

  // Build interleaved array: panel, divider, panel, divider, panel ...
  const items = []
  panels.forEach((panel, i) => {
    items.push(
      <div
        key={`panel-${i}`}
        className={`flex flex-col overflow-hidden ${axis.panel}`}
        style={axis.style(sizes[i])}
      >
        {panel}
      </div>
    )
    if (i < count - 1) {
      items.push(
        <div
          key={`divider-${i}`}
          onMouseDown={e => startDrag(e, i)}
          className={`${axis.divider} shrink-0 bg-slate-200 dark:bg-slate-700 hover:bg-blue-500 transition-colors active:bg-blue-400`}
          title="Drag to resize"
        />
      )
    }
  })

  return (
    <div
      ref={containerRef}
      className={`flex flex-1 overflow-hidden h-full ${axis.container} ${dragging ? 'select-none' : ''}`}
    >
      {items}
    </div>
  )
}
