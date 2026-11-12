/**
 * Bot 角色卡：房间外的「员工档案」。
 *
 * 一个 Bot 由三样东西定义：他是谁（persona）、一句话专长（expertise，给总管看）、
 * 他该怎么产出（instructions）。工具集不在这里定义，而是引用部署里的 agent preset——
 * 因为 DSH 是按 preset 挂载工具的，硬塞白名单只能是假的。
 */
import { newId, nowIso } from './ids.js'
import type { Member } from './types.js'

/** 一个可复用的 Bot 定义。 */
export interface BotDefinition {
  id: string
  name: string
  avatar: string
  /** 岗位描述：他是谁、擅长什么、工作方式。 */
  persona?: string
  /** 一句话专长，写进总管看到的成员表。 */
  expertise?: string
  /** 输出规范：格式、长度、必须包含什么。 */
  instructions?: string
  /** 部署里的 agent preset id，决定这个 Bot 能用到哪些工具。 */
  agentPreset?: string
  createdAt: string
  updatedAt: string
}

/** 拆分结果。 */
export interface PersonaSplit {
  persona: string
  expertise: string
  instructions: string
}

/** 一段话最多写到哪，防止角色卡变成论文。 */
const PERSONA_LIMIT = 1200

/** 专长只留一句话。 */
const EXPERTISE_LIMIT = 40

type Bucket = 'persona' | 'expertise' | 'instructions'

/** 按关键词判断一段短标题属于哪一类。 */
function bucketOf(text: string): Bucket | undefined {
  if (/^(身份|角色|定位|岗位|人设)/.test(text)) return 'persona'
  if (/^(专长|擅长|能力|领域)/.test(text)) return 'expertise'
  if (/^(输出|格式|规范|要求|风格|禁止|不要|限制|交付|协作)/.test(text)) return 'instructions'
  return undefined
}

/** 判断一行是不是分节标签，返回它属于哪一类。 */
function classify(line: string): Bucket | undefined {
  const isHeading = /^#{1,6}\s/.test(line)
  const text = line.trim().replace(/^#{1,6}\s*/, '')

  // Markdown 小标题：整行就是个短标题
  if (isHeading && text.length <= 12) {
    const bucket = bucketOf(text)
    if (bucket !== undefined) return bucket
  }

  // "身份：xxx" 这种行内标签
  const match = text.match(/^([^：:]{2,12})[：:]\s*(.*)$/)
  if (match === null) return undefined
  return bucketOf(match[1] ?? '')
}

/** 取第一句，压成一句话专长。 */
function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const sentence = flat.split(/[。.;；!！?？\n]/)[0] ?? flat
  const short = sentence.trim()
  return short.length > EXPERTISE_LIMIT ? short.slice(0, EXPERTISE_LIMIT) + '…' : short
}

/**
 * 把用户粘贴的一大段话拆成三块。
 *
 * 先按显式标签拆（`身份：`、`## 输出规范` 之类）；一句标签都没有时，
 * 整段当岗位描述，再从中取第一句当专长——**先保证能用，再谈准**。
 *
 * @param text - 原始文本
 */
export function splitPersona(text: string): PersonaSplit {
  const buckets: Record<Bucket, string[]> = { persona: [], expertise: [], instructions: [] }
  let current: Bucket = 'persona'
  let sawLabel = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '') {
      if (buckets[current].length > 0) buckets[current].push('')
      continue
    }
    const bucket = classify(line)
    if (bucket !== undefined) {
      sawLabel = true
      current = bucket
      // 标签后面同一行可能还有内容，例如 "身份：资深硬件工程师"
      const inline = line.replace(/^#{1,6}\s*/, '').replace(/^[^：:]{2,12}[：:]\s*/, '')
      const inlineLabel = line.match(/^[^：:]{2,12}[：:]\s*(.*)$/)
      const payload = inlineLabel?.[1] ?? (inline === line ? '' : inline)
      if (payload !== undefined && payload.trim() !== '') buckets[current].push(payload.trim())
      continue
    }
    buckets[current].push(line)
  }

  const join = (list: string[]): string => list.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const persona = join(buckets.persona).slice(0, PERSONA_LIMIT)
  const instructions = join(buckets.instructions)
  const expertiseRaw = join(buckets.expertise).replace(/\n/g, ' ').trim()

  const expertiseText =
    expertiseRaw !== '' ? expertiseRaw : sawLabel ? '' : firstSentence(persona)
  const expertise =
    expertiseText.length > EXPERTISE_LIMIT
      ? expertiseText.slice(0, EXPERTISE_LIMIT) + '…'
      : expertiseText

  return { persona, expertise, instructions }
}

/**
 * 造一个 Bot 定义。
 *
 * @param input - 名字必填，其余可选
 */
export function makeBot(input: {
  name: string
  avatar?: string
  persona?: string
  expertise?: string
  instructions?: string
  agentPreset?: string
}): BotDefinition {
  const now = nowIso()
  return {
    id: newId('bot'),
    name: input.name.trim(),
    avatar: input.avatar?.trim() || '🤖',
    ...(input.persona === undefined ? {} : { persona: input.persona }),
    ...(input.expertise === undefined ? {} : { expertise: input.expertise }),
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    ...(input.agentPreset === undefined ? {} : { agentPreset: input.agentPreset }),
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 把库里的角色卡复制成房间成员。
 *
 * 复制而不是引用：房间内改岗位/专长不该反过来改库，库是公共档案。
 *
 * @param bot - 库里的角色卡
 * @param role - 总管或执行，默认执行
 */
export function memberFromBot(bot: BotDefinition, role: 'host' | 'worker' = 'worker'): Member {
  return {
    botId: newId('bot'),
    name: bot.name,
    role,
    avatar: bot.avatar === '' ? '🤖' : bot.avatar,
    status: 'idle',
    tokensUsed: 0,
    defId: bot.id,
    ...(bot.persona === undefined ? {} : { persona: bot.persona }),
    ...(bot.expertise === undefined ? {} : { expertise: bot.expertise }),
    ...(bot.instructions === undefined ? {} : { instructions: bot.instructions }),
    ...(bot.agentPreset === undefined ? {} : { agentPreset: bot.agentPreset })
  }
}
