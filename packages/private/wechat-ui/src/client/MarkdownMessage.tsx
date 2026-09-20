import type { ReactNode } from 'react'
import { LOCAL_HTML_TOKEN, previewTargetOf, type MessagePreviewTarget } from './previewTarget.ts'

const INLINE_PATTERN = new RegExp(
  String.raw`(\[([^\]\n]+)\]\(([^)\s]+)\)|` +
    '`([^`\\n]+)`' +
    String.raw`|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|(?<!\*)\*([^*\n]+)\*(?!\*)|(?:https?:\/\/|www\.|file:\/\/)` +
    '[^\\s<>"\'`]+' +
    `|\\((${LOCAL_HTML_TOKEN})\\)|「(${LOCAL_HTML_TOKEN})」|(${LOCAL_HTML_TOKEN}))`,
  'giu',
)
// Raw URL matching runs independently from Markdown token matching while a
// response streams. Never let closing emphasis/strikethrough markers become
// part of the navigated URL (for example `https://example.test**`).
const TRAILING_URL_PUNCTUATION = /[)*~,.，。！？!?;；:：\]】》]+$/u

/** URLs rendered by the message, normalized exactly like their clickable anchors. */
export function messageUrls(text: string): string[] {
  const urls: string[] = []
  for (const match of text.matchAll(INLINE_PATTERN)) {
    let raw: string | undefined
    if (match[3] !== undefined) raw = match[3]
    else if (match[4] !== undefined && previewTargetOf(match[4]) !== undefined) raw = match[4]
    else if (match[9] !== undefined) raw = match[9]
    else if (match[10] !== undefined) raw = match[10]
    else if (match[11] !== undefined) raw = match[11]
    else if (match[2] === undefined && match[4] === undefined && match[5] === undefined
      && match[6] === undefined && match[7] === undefined && match[8] === undefined) {
      const token = match[0] ?? ''
      const trailing = token.match(TRAILING_URL_PUNCTUATION)?.[0] ?? ''
      raw = trailing === '' ? token : token.slice(0, -trailing.length)
    }
    if (raw === undefined) continue
    const target = previewTargetOf(raw, match[2])
    if (target?.kind === 'browser' && !urls.includes(target.url)) urls.push(target.url)
  }
  return urls
}

function linkNode(
  label: ReactNode,
  rawHref: string,
  key: string,
  onPreview: ((target: MessagePreviewTarget) => void) | undefined,
  linkLabel?: string,
): ReactNode {
  const target = previewTargetOf(rawHref, linkLabel)
  if (target === undefined) return <span key={key}>{label}</span>
  return (
    <span className="diywx-message-link-group" key={key}>
      {target.kind === 'browser'
        ? <a className="diywx-message-link" href={target.url} target="_blank" rel="noopener noreferrer">{label}</a>
        : <button className="diywx-message-link" type="button" onClick={() => { onPreview?.(target) }}>{label}</button>}
      {onPreview !== undefined && (
        <button className="diywx-inline-preview" type="button" title="在右侧打开" onClick={() => { onPreview(target) }}>右侧打开</button>
      )}
    </span>
  )
}

function inlineNodes(text: string, keyPrefix: string, onPreview: ((target: MessagePreviewTarget) => void) | undefined): ReactNode[] {
  const result: ReactNode[] = []
  let cursor = 0
  let tokenIndex = 0
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index
    const raw = match[0]
    if (start === undefined || raw === undefined) continue
    if (start > cursor) result.push(text.slice(cursor, start))
    const key = `${keyPrefix}-${tokenIndex++}`
    if (match[2] !== undefined && match[3] !== undefined) {
      result.push(linkNode(match[2], match[3], key, onPreview, match[2]))
    } else if (match[4] !== undefined) {
      result.push(previewTargetOf(match[4]) === undefined
        ? <code key={key}>{match[4]}</code>
        : linkNode(<code>{match[4]}</code>, match[4], key, onPreview, match[4]))
    } else if (match[5] !== undefined || match[6] !== undefined) {
      result.push(<strong key={key}>{inlineNodes(match[5] ?? match[6] ?? '', `${key}-strong`, onPreview)}</strong>)
    } else if (match[7] !== undefined) {
      result.push(<del key={key}>{inlineNodes(match[7], `${key}-del`, onPreview)}</del>)
    } else if (match[8] !== undefined) {
      result.push(<em key={key}>{inlineNodes(match[8], `${key}-em`, onPreview)}</em>)
    } else if (match[9] !== undefined) {
      result.push(linkNode(match[9], match[9], key, onPreview, match[9]))
    } else if (match[10] !== undefined) {
      result.push(linkNode(match[10], match[10], key, onPreview, match[10]))
    } else if (match[11] !== undefined) {
      result.push(linkNode(match[11], match[11], key, onPreview, match[11]))
    } else {
      const trailing = raw.match(TRAILING_URL_PUNCTUATION)?.[0] ?? ''
      const label = trailing === '' ? raw : raw.slice(0, -trailing.length)
      result.push(linkNode(label, label, key, onPreview, label))
      if (trailing !== '') result.push(trailing)
    }
    cursor = start + raw.length
  }
  if (cursor < text.length) result.push(text.slice(cursor))
  return result
}

function lineNodes(lines: readonly string[], keyPrefix: string, onPreview: ((target: MessagePreviewTarget) => void) | undefined): ReactNode[] {
  const result: ReactNode[] = []
  lines.forEach((line, index) => {
    if (index > 0) result.push(<br key={`${keyPrefix}-br-${index}`} />)
    result.push(...inlineNodes(line, `${keyPrefix}-${index}`, onPreview))
  })
  return result
}

function cellsOf(line: string): string[] {
  return line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map(cell => cell.trim())
}

function isTableDivider(line: string): boolean {
  const cells = cellsOf(line)
  return cells.length > 1 && cells.every(cell => /^:?-{3,}:?$/u.test(cell))
}

function startsBlock(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? ''
  const next = lines[index + 1] ?? ''
  return /^\s*```/u.test(line)
    || /^\s{0,3}#{1,6}\s+/u.test(line)
    || /^\s*>\s?/u.test(line)
    || /^\s*[-+*]\s+/u.test(line)
    || /^\s*\d+[.)]\s+/u.test(line)
    || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)
    || (line.includes('|') && isTableDivider(next))
}

export function MarkdownMessage({ text, onPreview }: { text: string; onPreview?: (target: MessagePreviewTarget) => void }) {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n')
  const blocks: ReactNode[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (line.trim() === '') {
      index += 1
      continue
    }

    const fence = line.match(/^\s*```\s*([\w.+-]*)\s*$/u)
    if (fence !== null) {
      const code: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/u.test(lines[index] ?? '')) code.push(lines[index++] ?? '')
      if (index < lines.length) index += 1
      const language = fence[1] || undefined
      blocks.push(
        <div className="diywx-code-block code-block" data-language={language} key={`code-${index}`}>
          {language !== undefined && <span className="diywx-code-language">{language}</span>}
          <pre className="diywx-markdown-code"><code data-language={language}>{code.join('\n')}</code></pre>
        </div>,
      )
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/u)
    if (heading !== null) {
      const level = Math.min(heading[1]?.length ?? 2, 4)
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4'
      blocks.push(<Tag key={`heading-${index}`}>{inlineNodes(heading[2] ?? '', `heading-${index}`, onPreview)}</Tag>)
      index += 1
      continue
    }

    if (/^\s*>\s?/u.test(line)) {
      const quote: string[] = []
      while (index < lines.length && /^\s*>\s?/u.test(lines[index] ?? '')) quote.push((lines[index++] ?? '').replace(/^\s*>\s?/u, ''))
      blocks.push(<blockquote key={`quote-${index}`}>{lineNodes(quote, `quote-${index}`, onPreview)}</blockquote>)
      continue
    }

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/u)
    if (unordered !== null) {
      const items: string[] = []
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^\s*[-+*]\s+(.+)$/u)
        if (item === null) break
        items.push(item[1] ?? '')
        index += 1
      }
      blocks.push(<ul key={`ul-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineNodes(item, `ul-${index}-${itemIndex}`, onPreview)}</li>)}</ul>)
      continue
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/u)
    if (ordered !== null) {
      const items: string[] = []
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^\s*\d+[.)]\s+(.+)$/u)
        if (item === null) break
        items.push(item[1] ?? '')
        index += 1
      }
      blocks.push(<ol key={`ol-${index}`}>{items.map((item, itemIndex) => <li key={itemIndex}>{inlineNodes(item, `ol-${index}-${itemIndex}`, onPreview)}</li>)}</ol>)
      continue
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u.test(line)) {
      blocks.push(<hr key={`hr-${index}`} />)
      index += 1
      continue
    }

    if (line.includes('|') && isTableDivider(lines[index + 1] ?? '')) {
      const header = cellsOf(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim() !== '') rows.push(cellsOf(lines[index++] ?? ''))
      blocks.push(
        <div className="diywx-markdown-table-wrap" key={`table-${index}`}>
          <table><thead><tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{inlineNodes(cell, `th-${index}-${cellIndex}`, onPreview)}</th>)}</tr></thead>
            <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{header.map((_, cellIndex) => <td key={cellIndex}>{inlineNodes(row[cellIndex] ?? '', `td-${index}-${rowIndex}-${cellIndex}`, onPreview)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      )
      continue
    }

    const paragraph: string[] = [line]
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() !== '' && !startsBlock(lines, index)) paragraph.push(lines[index++] ?? '')
    blocks.push(<p key={`paragraph-${index}`}>{lineNodes(paragraph, `paragraph-${index}`, onPreview)}</p>)
  }

  return <div className="diywx-markdown">{blocks}</div>
}
