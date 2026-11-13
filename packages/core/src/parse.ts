/**
 * 纯函数集合：解析与判定。
 *
 * 这些函数不碰文件、不碰网络、不依赖 DSH——所以能被单元测试固定住。
 * 历史上有四个 bug 都出在这里，测试优先覆盖它们。
 */
import type { DeliveryCheck, Member, Room } from './types.js'

/** 从文本里抽 @ 提及的名字，`@所有人` 不算。 */
export function parseMentions(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/@([^\s@，,。.:：]+)/g)) {
    const name = match[1]
    if (name === undefined) continue
    if (name === '所有人' || name.toLowerCase() === 'all') continue
    found.push(name)
  }
  return found
}

/**
 * 决定一条消息该由谁接。
 *
 * @param room - 房间
 * @param mentions - 文本里的 @ 名字
 */
export function resolveTargets(room: Room, mentions: string[]): Member[] {
  const members = room.members ?? []
  if (members.length === 0) return []

  if (mentions.length > 0) {
    const matched = members.filter((m) => mentions.includes(m.name) || mentions.includes(m.botId))
    if (matched.length > 0) return matched
  }

  if (members.length === 1) return members
  const host = members.find((m) => m.role === 'host')
  // 多个 Bot 又没总管、又没 @ 谁：不抢话，谁都不接
  return host === undefined ? [] : [host]
}

/**
 * 解析总管任务里的依赖标记：`[依赖:@老周]` / `[depends:老周,小柯]`。
 *
 * 标记会从任务正文里删掉；名字去重、去 `@`。
 *
 * @param text - 总管派给某个 Bot 的任务原文
 */
export function extractPlanDependencies(text: string): { task: string; names: string[] } {
  const names = new Set<string>()
  const pattern = /\[(?:依赖|depends?)\s*[:：]?\s*([^\]]+)\]/gi
  const task = text
    .replace(pattern, (_match, raw: string) => {
      for (const piece of raw.split(/[,，、\s]+/)) {
        const name = piece.replace(/^@/, '').trim()
        if (name !== '') names.add(name)
      }
      return ''
    })
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { task, names: [...names] }
}

/** 从任务文本里抽文件路径，用作软写锁声明。 */
export function extractFiles(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/[A-Za-z0-9_@\-./\\]+\.[A-Za-z0-9]{1,6}\b/g)) {
    const path = match[0]
    const looksLikeFile =
      path.includes('/') ||
      path.includes('\\') ||
      /\.(ts|tsx|js|jsx|json|md|css|html|py|yml|yaml|toml)$/i.test(path)
    if (looksLikeFile) found.add(path.replaceAll('\\', '/'))
    if (found.size >= 5) break
  }
  return [...found]
}

/** 把工具参数压成一行摘要。 */
export function summarizeArgs(raw: string): string {
  if (raw === '') return ''
  let text = raw.replace(/\s+/g, ' ').trim()
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    for (const key of ['command', 'description', 'path', 'file_path', 'pattern', 'query']) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim() !== '') {
        text = value.replace(/\s+/g, ' ').trim()
        break
      }
    }
  } catch {
    /* 不是 JSON 就用原文 */
  }
  return text.length > 80 ? text.slice(0, 80) + '…' : text
}

/** 把模型给的各种写法归一成三态。 */
export function normalizeVerdict(value: unknown): DeliveryCheck['verdict'] {
  const text = String(value ?? '').toLowerCase()
  // 先判否定：'不通过' 里含 '通过'，顺序反了就会把 fail 认成 pass
  if (text === 'fail' || text.includes('不通过') || text.includes('失败') || text === 'false') {
    return 'fail'
  }
  if (text === 'pass' || text.includes('通过') || text === 'true') return 'pass'
  return 'unsure'
}

/** 解析判定结果，三级容错，最后才落到"存疑"。 */
export function parseChecks(raw: string, points: string[]): DeliveryCheck[] {
  // ① JSON 数组
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown
      if (Array.isArray(parsed) && parsed.length >= points.length) {
        return points.map((point, index) => {
          const item = parsed[index] as Record<string, unknown> | undefined
          return {
            point,
            verdict: normalizeVerdict(item?.verdict ?? item?.result),
            reason: String(item?.reason ?? item?.why ?? '（没有给出理由）').slice(0, 300)
          }
        })
      }
    } catch {
      /* 往下走 */
    }
  }

  // ② 逐行匹配：每行里出现验收点开头几个字，再找 pass/fail
  const lines = raw.split('\n')
  const perLine: DeliveryCheck[] = []
  for (const point of points) {
    const hit = lines.find((line) => line.includes(point.slice(0, 6)))
    if (hit === undefined) continue
    perLine.push({
      point,
      verdict: normalizeVerdict(hit),
      reason: hit.replace(/\s+/g, ' ').trim().slice(0, 300)
    })
  }
  if (perLine.length === points.length && perLine.some((c) => c.verdict !== 'unsure')) {
    return perLine
  }

  // ③ 兜底：全存疑，但把模型原话留一句，方便人工复核
  const digest = raw.replace(/\s+/g, ' ').trim().slice(0, 200)
  return points.map((point) => ({
    point,
    verdict: 'unsure' as const,
    reason: digest === '' ? '模型没有给出判定' : `模型没有按格式判定：${digest}`
  }))
}

/**
 * 验收标准的三种形态。
 *
 * - `file:路径`  文件必须存在
 * - `cmd:命令`   命令必须以退出码 0 结束
 * - 其它          交给模型判（自由文本）
 */
export type CheckSpec =
  | { kind: 'file'; value: string }
  | { kind: 'cmd'; value: string }
  | { kind: 'text'; value: string }

/**
 * 规范化一条验收标准：去掉手打的序号、项目符号和最外层的反引号。
 *
 * 用户常把 "1. `xxx`" 整行粘进来，不去掉的话界面会显示 "1. 1. `xxx`"。
 *
 * @param line - 原始一行
 */
export function normalizeAcceptanceLine(line: string): string {
  let text = line.trim()
  text = text.replace(/^(?:\d+[.)]|[-*])\s+/, '')
  text = text.replace(/^`([\s\S]*)`$/, '$1')
  return text.trim()
}

/**
 * 解析一条验收标准，判断它是可机器验证的谓词还是自由文本。
 *
 * @param line - 一条验收标准
 */
export function parseCheckSpec(line: string): CheckSpec {
  const text = normalizeAcceptanceLine(line)
  if (text.startsWith('file:')) return { kind: 'file', value: text.slice(5).trim() }
  if (text.startsWith('cmd:')) return { kind: 'cmd', value: text.slice(4).trim() }
  return { kind: 'text', value: text }
}

/**
 * 验收标准全是文字类时给一句提醒（不是错误）。
 *
 * 文字标准也能用；但要文件、要命令通过，就该写成 `file:` / `cmd:`——
 * 否则模型只能判"文字里有没有提到"，判不了"事情有没有做成"。
 *
 * @param lines - 验收标准
 * @returns 需要提醒时返回一句话，否则 undefined
 */
export function acceptanceWarning(lines: string[]): string | undefined {
  const clean = lines.map((line) => line.trim()).filter((line) => line !== '')
  if (clean.length === 0) return undefined
  if (clean.some((line) => parseCheckSpec(line).kind !== 'text')) return undefined
  return (
    '这些验收标准全是文字判定：模型只能看"文字里有没有提到"，不能证明"事情做成了"。' +
    '建议至少有一条写成 file:路径 或 cmd:命令，让机器来判。'
  )
}

/**
 * 解析 `git status --porcelain` 的输出，取出变更路径。
 *
 * porcelain 每行是 `XY path`：前两位是状态码，第 3 位起是路径。
 * 曾经写成 slice(3) 导致所有路径少掉首字母。
 */
export function parseGitStatus(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(2).trim())
    .filter((path) => path !== '')
    .slice(0, 50)
}
