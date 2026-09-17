import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ResizablePanels from '../components/ResizablePanels.jsx'

const panel = key => createElement('p', { key }, key)
const render = props =>
  renderToStaticMarkup(createElement(ResizablePanels, props, [panel('a'), panel('b')]))

describe('ResizablePanels', () => {
  it('lays panels out in a row by default and sizes them by width', () => {
    const html = render({ initialSizes: [30, 70] })
    expect(html).toContain('flex-row')
    expect(html).toContain('width:30%')
    expect(html).toContain('cursor-col-resize')
  })

  it('lays them out in a column and sizes them by height when vertical', () => {
    const html = render({ direction: 'vertical', initialSizes: [60, 40] })
    expect(html).toContain('flex-col')
    expect(html).toContain('height:60%')
    expect(html).toContain('height:40%')
    expect(html).toContain('cursor-row-resize')
    expect(html).not.toContain('cursor-col-resize')
  })

  it('keeps the divider affordance in both directions', () => {
    for (const direction of ['horizontal', 'vertical']) {
      const html = render({ direction })
      expect(html).toContain('hover:bg-blue-500')
      expect(html).toContain('active:bg-blue-400')
      expect(html).toContain('Drag to resize')
    }
  })

  // select-none on the container was inherited by every panel's content, so
  // nothing in the app — the assistant's answers included — could be selected.
  it('does not suppress text selection while idle', () => {
    expect(render({})).not.toContain('select-none')
    expect(render({ direction: 'vertical' })).not.toContain('select-none')
  })

  it('renders caller-controlled sizes', () => {
    const html = render({ direction: 'vertical', sizes: [25, 75], onSizesChange: () => {} })
    expect(html).toContain('height:25%')
    expect(html).toContain('height:75%')
  })
})
