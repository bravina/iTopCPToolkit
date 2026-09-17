import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import AiMarkdown from '../components/AiMarkdown.jsx'

const render = md => renderToStaticMarkup(createElement(AiMarkdown, null, md))

describe('AiMarkdown', () => {
  // react-markdown 9 dropped the `inline` prop; relying on it put every
  // inline span through the block branch and broke the sentence around it.
  it('keeps inline code inline', () => {
    const html = render('The `Jets` block, and then some.')
    expect(html).not.toContain('<pre')
    expect(html).toContain('<code')
    expect(html).toContain('Jets')
    // still one flowing paragraph, comma and all
    expect(html).toMatch(/<p[^>]*>The <code[^>]*>Jets<\/code> block, and then some\.<\/p>/)
  })

  it('renders a fenced block as a scrollable pre', () => {
    const html = render('```yaml\nJets:\n  - jetCollection: AntiKt4\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('jetCollection: AntiKt4')
    // the inline chrome must not leak into the block
    expect(html).not.toMatch(/<pre[^>]*>\s*<code[^>]*px-1/)
  })

  it('offers a copy button on a code block', () => {
    const html = render('```\nx: 1\n```')
    expect(html).toContain('Copy')
    expect(html).toContain('Copy to clipboard')
  })

  it('still renders lists, links and emphasis', () => {
    const html = render('- one\n- **two** and [docs](https://example.org)\n')
    expect(html).toContain('<ul')
    expect(html).toContain('<strong')
    expect(html).toContain('href="https://example.org"')
    expect(html).toContain('rel="noreferrer"')
  })
})
