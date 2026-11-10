/**
 * 把房间导出成 Markdown。
 *
 * 单独成文件（不依赖 React），这样能被单元测试覆盖。
 */
import type { Message, Room } from './types.js'

/** token 数压成 1.2k / 3.4M 这种。 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'k'
  return String(Math.round(value))
}

/**
 * 生成一份可直接交差的 Markdown。
 *
 * @param room - 房间
 * @param messages - 该房间的消息
 * @param now - 导出时间，测试时可注入
 */
export function buildMarkdown(
  room: Room,
  messages: Message[],
  now: Date = new Date()
): string {
  const lines: string[] = []
  lines.push(`# ${room.name}`, '')
  lines.push(`> ${room.goal}`, '')
  lines.push('## 验收标准', '')
  room.acceptance.forEach((item, index) => lines.push(`${index + 1}. ${item}`))
  lines.push('')

  if (room.delivery !== undefined) {
    const passed = room.delivery.checks.filter((c) => c.verdict === 'pass').length
    lines.push('## 交付结论', '')
    lines.push(`- ${passed}/${room.delivery.checks.length} 通过`)
    lines.push(`- 验收时间：${new Date(room.delivery.at).toLocaleString()}`)
    lines.push(`- 花费：${formatTokens(room.delivery.tokensUsed)}`)
    lines.push(`- 变更文件：${room.delivery.changedFiles.join('、') || '（无）'}`, '')
    for (const check of room.delivery.checks) {
      const icon = check.verdict === 'pass' ? '✅' : check.verdict === 'fail' ? '❌' : '❓'
      lines.push(`### ${icon} ${check.point}`, '', check.reason, '')
    }
  }

  lines.push('## 成员', '')
  for (const member of room.members ?? []) {
    const tag = member.role === 'host' ? '总管' : '执行'
    lines.push(`- ${member.name}（${tag}）· 已用 ${formatTokens(member.tokensUsed ?? 0)}`)
  }
  lines.push('')

  lines.push('## 对话', '')

  // 同一件事会有一开一关两张任务卡，导出只留最后那张（带最终状态与结论）
  const lastCard = new Map<string, number>()
  messages.forEach((message, index) => {
    if (message.kind !== 'assignment') return
    const payload = (message.payload ?? {}) as { to?: unknown; title?: unknown }
    lastCard.set(`${String(payload.to ?? '')}\u0000${String(payload.title ?? '')}`, index)
  })
  const keepCard = new Set(lastCard.values())

  messages.forEach((message, index) => {
    if (message.kind === 'tool') return
    if (message.kind === 'assignment' && !keepCard.has(index)) return
    const who =
      message.kind === 'human'
        ? '我'
        : message.kind === 'system'
          ? '系统'
          : message.kind === 'assignment'
            ? '任务卡'
            : ((room.members ?? []).find((m) => m.botId === message.botId)?.name ?? 'Bot')
    lines.push(`**${who}**：${message.text.replace(/\n/g, '  ')}`, '')
  })

  lines.push('---', '', `由 DSHBot 导出（${now.toISOString().slice(0, 10)}），房间 ${room.id}`)
  return lines.join('\n')
}
