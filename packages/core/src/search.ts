/**
 * 房间消息搜索。
 *
 * 纯函数：输入消息数组与关键词，输出带上下文的匹配片段。
 * 不依赖 DSH，也不读写文件，方便单测与将来的索引替换。
 */
import type { Message } from './types.js'

/** 一条搜索结果。 */
export interface MessageMatch {
  id: string
  kind: string
  /** 消息原始 from（human / botId / system）。 */
  from: string
  botId?: string
  /** 匹配位置附近的一段文字，已压成单行。 */
  snippet: string
  createdAt: string
}

/** 片段前后各留多少字。 */
const SNIPPET_BEFORE = 40
const SNIPPET_AFTER = 80

/**
 * 搜索消息正文（大小写不敏感），按时间从新到旧返回。
 *
 * @param messages - 某个房间的消息
 * @param query - 关键词
 * @param limit - 最多返回几条（默认 20，上限 100）
 */
export function searchMessages(
  messages: Message[],
  query: string,
  limit = 20
): MessageMatch[] {
  const keyword = query.trim()
  if (keyword === '') return []
  const needle = keyword.toLowerCase()
  const max = Math.min(Math.max(Math.round(limit), 1), 100)

  const matches: MessageMatch[] = []
  for (const message of messages) {
    const flat = message.text.replace(/\s+/g, ' ').trim()
    const index = flat.toLowerCase().indexOf(needle)
    if (index < 0) continue

    const start = Math.max(0, index - SNIPPET_BEFORE)
    const end = Math.min(flat.length, index + keyword.length + SNIPPET_AFTER)
    const snippet =
      (start > 0 ? '…' : '') +
      flat.slice(start, end) +
      (end < flat.length ? '…' : '')

    matches.push({
      id: message.id,
      kind: message.kind,
      from: message.from,
      ...(message.botId === undefined ? {} : { botId: message.botId }),
      snippet,
      createdAt: message.createdAt
    })
  }

  matches.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return matches.slice(0, max)
}
