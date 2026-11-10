/**
 * 极简 Markdown 解析：只处理 Bot 回复里常见的几类块。
 *
 * 不引第三方库——需要的就这几种，自己写能保证行为和测试一致。
 * 解析结果给 React 渲染用，行内格式（**粗** 与 `代码`）留给渲染层处理。
 */

/** 一个块级元素。 */
export type Block =
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'para'; text: string }

/** 行内片段：普通文字 / 加粗 / 行内代码。 */
export type Inline = { kind: 'text' | 'bold' | 'code'; text: string }

/**
 * 把行内标记切成片段。
 *
 * @param line - 一行文字
 */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) out.push({ kind: 'text', text: line.slice(last, index) })
    const token = match[0]
    if (token.startsWith('**')) out.push({ kind: 'bold', text: token.slice(2, -2) })
    else out.push({ kind: 'code', text: token.slice(1, -1) })
    last = index + token.length
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) })
  return out
}

/**
 * 把一段文本切成块。
 *
 * 支持：围栏代码块、标题（# 到 ###）、有序/无序列表、普通段落。
 *
 * @param text - 原始文本
 */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''

    // 围栏代码块
    const fence = line.match(/^```(\w*)\s*$/)
    if (fence !== null) {
      const lang = fence[1] ?? ''
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      index += 1 // 跳过结束围栏
      blocks.push({ kind: 'code', text: body.join('\n'), lang })
      continue
    }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        text: heading[2] ?? ''
      })
      index += 1
      continue
    }

    // 表格：第一行表头，第二行是 |---|---|
    const isRow = (value: string): boolean => /^\s*\|.*\|\s*$/.test(value)
    const isDivider = (value: string): boolean => /^\s*\|[\s:|-]+\|\s*$/.test(value)
    if (isRow(line) && isDivider(lines[index + 1] ?? '')) {
      const split = (value: string): string[] =>
        value
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((cell) => cell.trim())
      const header = split(line)
      const rows: string[][] = []
      index += 2
      while (index < lines.length && isRow(lines[index] ?? '')) {
        rows.push(split(lines[index] ?? ''))
        index += 1
      }
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    // 列表（连续的行归为一组）
    const bullet = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/)
    if (bullet !== null) {
      const ordered = /\d/.test(bullet[1] ?? '')
      const items: string[] = []
      while (index < lines.length) {
        const current = lines[index] ?? ''
        const hit = current.match(/^\s*([-*]|\d+\.)\s+(.*)$/)
        if (hit === null) break
        if (/\d/.test(hit[1] ?? '') !== ordered) break
        items.push(hit[2] ?? '')
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // 空行
    if (line.trim() === '') {
      index += 1
      continue
    }

    // 段落：连着读到空行或块起始
    const para: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      if (
        current.trim() === '' ||
        /^```/.test(current) ||
        /^#{1,6}\s/.test(current) ||
        /^\s*([-*]|\d+\.)\s+/.test(current)
      ) {
        break
      }
      para.push(current)
      index += 1
    }
    if (para.length > 0) blocks.push({ kind: 'para', text: para.join('\n') })
  }

  return blocks
}
