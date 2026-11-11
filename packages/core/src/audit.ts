/**
 * 审计导出：把一个房间发生的所有事压成 JSONL。
 *
 * 为什么要这个：房间跑完只留下一堆消息，出问题时很难回答
 * 「第几步、哪个 Bot、调了什么工具、花了多少」。JSONL 一行一条，能直接丢进脚本里筛。
 */
import type { Message } from './types.js'

/** 审计记录：一行一个。 */
export interface AuditRecord {
  /** 发生时间（ISO）。 */
  at: string
  /** 消息类型：human / bot / tool / system / assignment。 */
  kind: string
  /** 谁做的：human 或 botId。 */
  from: string
  /** 说了什么 / 做了什么。 */
  text: string
  /** 工具调用的参数与输出（已截断）。 */
  tool?: { name: string; input: string; output: string }
  /** 任务卡的状态与结论。 */
  card?: { status: string; result?: string; planId?: string }
}

/** 单条输出保留多少字符，防止 JSONL 变成几百 MB。 */
const TOOL_OUTPUT_LIMIT = 4000

/** 截断并保持单行。 */
function clip(value: unknown, limit = TOOL_OUTPUT_LIMIT): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  const flat = text.replace(/\r?\n/g, '\\n')
  return flat.length > limit ? flat.slice(0, limit) + '…（截断）' : flat
}

/**
 * 把消息整理成审计记录。
 *
 * @param messages - 该房间的消息（调用方负责过滤房间）
 */
export function auditRecords(messages: Message[]): AuditRecord[] {
  return messages.map((message) => {
    const payload = (message.payload ?? {}) as Record<string, unknown>
    const record: AuditRecord = {
      at: message.createdAt,
      kind: message.kind,
      from: message.kind === 'human' ? 'human' : (message.botId ?? message.from),
      text: clip(message.text, 2000)
    }

    if (message.kind === 'tool') {
      record.tool = {
        name: String(payload.name ?? ''),
        input: clip(payload.input, 1000),
        output: clip(payload.output)
      }
    }

    if (message.kind === 'assignment') {
      record.card = {
        status: String(payload.status ?? ''),
        ...(typeof payload.result === 'string' ? { result: clip(payload.result, 500) } : {}),
        ...(typeof payload.planId === 'string' ? { planId: payload.planId } : {})
      }
    }

    return record
  })
}

/**
 * 记录数组 → JSONL 文本（每行一个 JSON，末尾带换行）。
 *
 * @param records - 审计记录
 */
export function toJsonl(records: AuditRecord[]): string {
  if (records.length === 0) return ''
  return records.map((record) => JSON.stringify(record)).join('\n') + '\n'
}
