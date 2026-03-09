import { buildLines, renderPrefix } from './yamlLineBuilder.js'

const COMMENT_WRAP = 78  // max chars per comment line (excluding leading '# ')

/**
 * Word-wrap `text` into lines of at most `width` characters.
 */
function wrapText(text, width) {
  const words = text.split(/\s+/)
  const lines = []
  let current = ''
  for (const word of words) {
    if (!word) continue
    if (current.length === 0) {
      current = word
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Strip Markdown links to plain text, remove backtick delimiters.
 * Keeps link text.  Preserves newlines so multi-paragraph info
 * becomes multiple comment paragraphs.
 */
function stripMarkdown(info) {
  return info
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // [text](url) → text
    .replace(/\*\*([^*]+)\*\*/g, '$1')          // **bold** → bold
    .replace(/`([^`]+)`/g, '$1')                // `code` → code
    .replace(/\[([^\]]+)\]/g, '$1')             // bare [ref]
}

/**
 * Build comment lines (without the leading indent prefix) for a given info string.
 * Returns an array of strings, each being a full `# ...` comment line.
 */
function buildCommentLines(info, type, label, subLabel) {
  const parts = []

  if (info) {
    const plain = stripMarkdown(info)
    // Split on blank lines to preserve paragraph breaks
    const paragraphs = plain.split(/\n\s*\n/)
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i].replace(/\n/g, ' ').trim()
      if (!para) continue
      const wrapped = wrapText(para, COMMENT_WRAP)
      wrapped.forEach(l => parts.push(`# ${l}`))
      if (i < paragraphs.length - 1) parts.push('#')  // blank separator
    }
  }

  if (type) parts.push(`# Type: ${type}`)
  if (label) parts.push(`# Sub-block: ${label}`)
  if (subLabel) parts.push(`# ↳ ${subLabel}`)

  return parts
}

/**
 * Generate a YAML string with full block-comment annotations above each key.
 */
export function generateAnnotatedYaml(configObj, schema) {
  const lines = buildLines(configObj, schema)
  const output = []

  for (const line of lines) {
    if (line.type === 'blank') {
      output.push('')
      continue
    }

    if (line.type === 'block-header') {
      const blockLabel = line.blockDef?.label ?? ''
      const sep = '─'.repeat(Math.max(0, 60 - blockLabel.length))
      output.push(`# ── ${blockLabel} ${sep}`)
      if (line.unknown) output.push('# ⚠ UNKNOWN BLOCK — not in schema')
      output.push(`${line.key}:`)
      continue
    }

    const prefix = renderPrefix(line.indent, line.isListStart)
    const commentIndent = ' '.repeat(line.indent)  // comments aligned to key indent

    // Build comment block
    const comments = buildCommentLines(
      line.optInfo?.info ?? null,
      line.optInfo?.type ?? null,
      line.subInfo?.def?.label ?? null,
      null,
    )

    if (line.unknown) {
      output.push(`${commentIndent}# ⚠ unknown key`)
    } else if (comments.length > 0) {
      comments.forEach(c => output.push(`${commentIndent}${c}`))
    }

    if (line.type === 'key-only') {
      output.push(`${prefix}${line.key}:`)
    } else if (line.type === 'kv') {
      output.push(`${prefix}${line.key}: ${line.valueStr}`)
    }
  }

  return output.join('\n') + '\n'
}

