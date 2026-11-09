/**
 * 房间编排：一条消息进来，决定谁接、怎么跑、跑完记什么。
 *
 * 这里是 M1 的核心，api.ts 只负责 HTTP。
 *
 * 四件事：
 * 1. 路由：@ 谁谁接；多 Bot 没 @ 没人接；有总管则总管接。
 * 2. 上下文块：每个 Bot 跑之前拼一段房间近况，让它知道别人干了什么。
 * 3. 派活：总管的回复里 @ 到谁，就把活拆给谁，并记一张任务卡。
 * 4. 串行：同一房间一次只跑一轮，避免两个请求打架。
 */
import { newId, nowIso } from '@dshbot/core'
import type { Delivery, DeliveryCheck, Member, Message, Room } from '@dshbot/core'
import { execFileSync } from 'node:child_process'
import { runOnce } from './agent.js'
import type { AgentContext, RunOutcome } from './agent.js'
import { loadDb, saveDb } from './store.js'

/** 上下文块里带多少条近期消息。 */
const RECENT_LIMIT = 12
/** 单条消息在上下文里最多留多少字。 */
const RECENT_ITEM_CHARS = 90
/** 上下文块总长上限，防止反过来压过真正的任务。 */
const CONTEXT_CHAR_LIMIT = 2400
/** 总管一轮最多派几路活，防止一个回复炸出十个任务。 */
const MAX_DISPATCH = 3
/** 同时最多跑几个派出去的 Bot。 */
const DISPATCH_CONCURRENCY = 2

/** 每个房间一条串行队列。 */
const queues = new Map<string, Promise<unknown>>()

/**
 * 把任务排到某个房间的队尾。
 *
 * @param key - 房间 id
 * @param job - 要执行的任务
 */
function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(job)
  queues.set(
    key,
    next.catch(() => undefined)
  )
  return next
}

/** 造一条消息。 */
export function makeMessage(
  roomId: string,
  kind: Message['kind'],
  from: string,
  text: string
): Message {
  return { id: newId('msg'), roomId, kind, from, text, createdAt: nowIso() }
}

/** 抽出 @ 提及的名字，`@所有人` 不算。 */
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
 * 决定这条消息该由谁接。
 *
 * @param room - 房间
 * @param mentions - 文本里的 @ 名字
 * @returns 要跑的成员
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
  return host === undefined ? [] : [host]
}

/** 消息流里最近若干条，压成一行摘要。 */
function recentLines(roomId: string, limit = RECENT_LIMIT): string[] {
  const all = loadDb().messages.filter((m) => m.roomId === roomId && m.kind !== 'tool')
  const tail = all.slice(-limit)
  return tail.map((m) => {
    const who = m.kind === 'human' ? '我' : m.kind === 'system' ? '系统' : m.from === 'bot' ? 'Bot' : m.from
    const text = m.text.replace(/\s+/g, ' ').trim()
    const short = text.length > RECENT_ITEM_CHARS ? text.slice(0, RECENT_ITEM_CHARS) + '…' : text
    return `${who}：${short}`
  })
}

/**
 * 拼这个 Bot 这一轮的上下文块。
 *
 * 不灌别人的会话历史，只给一段现算的房间近况——这是多 Bot 不互相污染的关键。
 *
 * @param room - 房间
 * @param member - 本次要跑的成员
 * @param task - 真正要它做的事
 */
export function buildContext(room: Room, member: Member, task: string): string {
  const members = (room.members ?? []).map((m) => {
    const tag = m.role === 'host' ? '总管' : '执行'
    return `${m.name}（${tag}）`
  })

  const head = [
    `【房间】${room.name}`,
    `目标：${room.goal}`,
    `验收：${room.acceptance.map((a, i) => `${i + 1}. ${a}`).join('  ')}`,
    `成员：${members.join('、')}`,
    member.role === 'host'
      ? '你是本房间的总管：先用 1-2 次工具确认现状，然后给出结论；该派人做的用 @名字 派活，派活时把要求写清楚。不要自己深挖细节。**不要调用 subagent 工具**——房间里的人要用 @名字 指派，不用子代理。'
      : `你是执行 Bot「${member.name}」：只做分给你的那一件事，最多用 5 次工具，够用就下结论。必须给出一段文字结论，不要只调工具不说话。不要调用 subagent 工具。`,
    ...(member.files === undefined || member.files.length === 0
      ? []
      : [`你负责的文件：${member.files.join('、')}。不要动别人的文件。`])
  ]

  const recent = recentLines(room.id)
  const body = recent.length === 0 ? ['（还没有对话）'] : recent

  const block = [...head, '', '【最近动态】', ...body, '', '【你的任务】', task].join('\n')
  return block.length > CONTEXT_CHAR_LIMIT
    ? block.slice(0, CONTEXT_CHAR_LIMIT) + '\n（省略）'
    : block
}

/** 从总管回复里找出要派给谁。 */
function dispatchTargets(room: Room, hostReply: string, self: Member): Member[] {
  const names = parseMentions(hostReply)
  const picked: Member[] = []
  for (const name of names) {
    const member = (room.members ?? []).find((m) => m.name === name && m.botId !== self.botId)
    if (member !== undefined && !picked.some((p) => p.botId === member.botId)) {
      picked.push(member)
      if (picked.length >= MAX_DISPATCH) break
    }
  }
  return picked
}

/** 把总管回复里提到某个人的那一行摘出来，作为这个人的任务。 */
function taskFor(hostReply: string, name: string): string {
  const lines = hostReply.split('\n').map((l) => l.trim()).filter(Boolean)
  const hit = lines.find((l) => l.includes('@' + name))
  return (hit ?? hostReply).slice(0, 400)
}

/** 跑一个成员的一轮，并把结果落盘。 */
async function runMember(
  ctx: AgentContext,
  roomId: string,
  member: Member,
  task: string,
  rawTask: string
): Promise<{ messages: Message[]; outcome?: RunOutcome }> {
  const started = loadDb()
  const seat = started.rooms.find((r) => r.id === roomId)?.members?.find((m) => m.botId === member.botId)
  if (seat !== undefined) {
    seat.status = 'thinking'
    seat.activity = '处理中'
  }
  saveDb(started)

  try {
    const room = started.rooms.find((r) => r.id === roomId)!
    const composed = buildContext(room, member, task)
    const outcome = await runOnce(
      ctx,
      composed,
      room.shared !== '' ? room.shared : process.cwd(),
      member.sessionId,
      member.sessionSeq ?? 0
    )
    const reply = outcome.text !== '' ? outcome.text : '（模型没有返回文字）'

    const toolMessages: Message[] = outcome.tools.map((tool) => {
      const message = makeMessage(
        roomId,
        'tool',
        member.botId,
        `${tool.name} ${summarizeArgs(tool.input)}`
      )
      message.payload = { name: tool.name, input: tool.input, output: tool.output }
      message.botId = member.botId
      return message
    })

    const botMessage = makeMessage(roomId, 'bot', member.botId, reply)
    botMessage.botId = member.botId

    const after = loadDb()
    after.messages.push(...toolMessages, botMessage)
    const done = after.rooms.find((r) => r.id === roomId)
    if (done !== undefined) {
      done.tokensUsed = (done.tokensUsed ?? 0) + outcome.usage.total
      const own = done.members?.find((m) => m.botId === member.botId)
      if (own !== undefined) {
        own.sessionId = outcome.sessionId
        own.sessionSeq = outcome.lastSeq
        own.tokensUsed = (own.tokensUsed ?? 0) + outcome.usage.total
        own.status = 'idle'
        own.activity = undefined
      }
      done.updatedAt = nowIso()
    }
    saveDb(after)

    void rawTask
    return { messages: [...toolMessages, botMessage], outcome }
  } catch (error) {
    const note = makeMessage(
      roomId,
      'system',
      'system',
      `${member.name} 这一轮失败了：${error instanceof Error ? error.message : '未知错误'}`
    )
    note.botId = member.botId
    const broken = loadDb()
    broken.messages.push(note)
    const seat2 = broken.rooms
      .find((r) => r.id === roomId)
      ?.members?.find((m) => m.botId === member.botId)
    if (seat2 !== undefined) {
      seat2.status = 'error'
      seat2.activity = '上一轮失败'
    }
    saveDb(broken)
    return { messages: [note] }
  }
}

/** 把工具参数压成一行摘要。 */
function summarizeArgs(raw: string): string {
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

/** 从任务文本里抽出它可能碰的文件，用作软写锁声明。 */
function extractFiles(text: string): string[] {
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

/** 限量并发跑一批任务，结果按原顺序返回，失败为 null。 */
async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<(R | null)[]> {
  const results: (R | null)[] = new Array(items.length).fill(null)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      const item = items[index]
      if (item === undefined) continue
      try {
        results[index] = await fn(item)
      } catch {
        results[index] = null
      }
    }
  })
  await Promise.all(workers)
  return results
}

/** 读工作区里改过哪些文件。 */
function changedFiles(dir: string): string[] {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 8000
    })
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      // porcelain 是 "XY path"，前两位是状态，后面才是路径
      .map((line) => line.slice(2).trim())
      .filter((path) => path !== '')
      .slice(0, 50)
  } catch {
    return []
  }
}

/** 解析判定结果，容错到"判不出来就标存疑"。 */
function parseChecks(raw: string, points: string[]): DeliveryCheck[] {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown
      if (Array.isArray(parsed)) {
        return points.map((point, index) => {
          const item = parsed[index] as Record<string, unknown> | undefined
          const verdict = String(item?.verdict ?? 'unsure')
          return {
            point,
            verdict:
              verdict === 'pass' || verdict === 'fail' || verdict === 'unsure' ? verdict : 'unsure',
            reason: String(item?.reason ?? '（没有给出理由）').slice(0, 300)
          }
        })
      }
    } catch {
      /* 落到下面的兜底 */
    }
  }
  return points.map((point) => ({
    point,
    verdict: 'unsure' as const,
    reason: '模型没有按格式给出判定，需要人工确认'
  }))
}

/**
 * 交付：看工作区变了什么，再让总管逐条判定验收点。
 *
 * @param ctx - Host 上下文
 * @param roomId - 房间
 * @returns 交付结论
 */
export async function deliverRoom(ctx: AgentContext, roomId: string): Promise<Delivery> {
  const db = loadDb()
  const room = db.rooms.find((r) => r.id === roomId)
  if (room === undefined) throw new Error(`房间不存在：${roomId}`)

  const dir = room.shared !== '' ? room.shared : process.cwd()
  const files = changedFiles(dir)
  const recent = recentLines(roomId, 10).join('\n')

  const judge = [
    '你现在是验收人，只做判定，不要改任何文件。',
    `房间：${room.name}`,
    `目标：${room.goal}`,
    '验收标准：',
    ...room.acceptance.map((a, i) => `${i + 1}. ${a}`),
    '',
    '房间最近动态：',
    recent,
    '',
    `工作区（${dir}）里变更的文件：`,
    files.length === 0 ? '（没有检测到变更）' : files.join('\n'),
    '',
    '请逐条判定每个验收标准，只输出一个 JSON 数组，不要额外文字。',
    '格式：[{"verdict":"pass|fail|unsure","reason":"一句话理由"}]',
    '数组长度必须等于验收标准条数。'
  ].join('\n')

  const judgeMember =
    (room.members ?? []).find((m) => m.role === 'host') ?? (room.members ?? [])[0]
  if (judgeMember === undefined) throw new Error('房间里还没有 Bot，无法验收')

  const outcome = await runOnce(ctx, judge, dir, judgeMember.sessionId, judgeMember.sessionSeq ?? 0)
  const checks = parseChecks(outcome.text, room.acceptance)

  const passed = checks.filter((c) => c.verdict === 'pass').length
  const delivery: Delivery = {
    at: nowIso(),
    checks,
    changedFiles: files,
    tokensUsed: outcome.usage.total,
    summary: `验收点 ${passed}/${checks.length} 通过；变更文件 ${files.length} 个`
  }

  const after = loadDb()
  const done = after.rooms.find((r) => r.id === roomId)
  if (done !== undefined) {
    done.delivery = delivery
    done.tokensUsed = (done.tokensUsed ?? 0) + outcome.usage.total
    const seat = done.members?.find((m) => m.botId === judgeMember.botId)
    if (seat !== undefined) {
      seat.sessionId = outcome.sessionId
      seat.sessionSeq = outcome.lastSeq
      seat.tokensUsed = (seat.tokensUsed ?? 0) + outcome.usage.total
    }
    done.updatedAt = nowIso()
  }

  const card = makeMessage(roomId, 'system', 'system', delivery.summary)
  after.messages.push(card)
  saveDb(after)

  return delivery
}

/**
 * 处理房间里的这一条消息。
 *
 * @param ctx - Host 上下文
 * @param roomId - 房间
 * @param text - 用户输入
 * @returns 本轮产生的消息（含用户那条）
 */
export async function handleRoomMessage(
  ctx: AgentContext,
  roomId: string,
  text: string
): Promise<{ messages: Message[]; skipped: boolean }> {
  return enqueue(roomId, async () => {
    const db = loadDb()
    const room = db.rooms.find((r) => r.id === roomId)
    if (room === undefined) throw new Error(`房间不存在：${roomId}`)

    const mentions = parseMentions(text)
    const targets = resolveTargets(room, mentions)
    const userMessage = makeMessage(roomId, 'human', 'human', text)
    if (targets.length === 1) userMessage.botId = targets[0]?.botId

    const willRun = room.mentionOnly !== true || mentions.length > 0
    const nobody = willRun && targets.length === 0

    // 落盘用户消息；排队期间就把状态标出来
    const before = loadDb()
    before.messages.push(userMessage)
    const pending = before.rooms.find((r) => r.id === roomId)
    if (pending !== undefined) {
      pending.status = willRun && !nobody ? 'working' : 'created'
      for (const target of targets) {
        const seat = pending.members?.find((m) => m.botId === target.botId)
        if (seat !== undefined && willRun && !nobody) {
          seat.status = 'queued'
          seat.activity = '已排队'
        }
      }
      pending.updatedAt = nowIso()
    }
    saveDb(before)

    if (!willRun || nobody) {
      const hint = makeMessage(
        roomId,
        'system',
        'system',
        nobody
          ? '房间里有多只 Bot，没有 @ 谁，这条只记录。用 @名字 指给某一只，或拉一只总管进来。'
          : '房间设成了「仅 @ 响应」，这条只记录。'
      )
      const db2 = loadDb()
      db2.messages.push(hint)
      saveDb(db2)
      return { messages: [userMessage, hint], skipped: true }
    }

    const produced: Message[] = [userMessage]

    for (const target of targets) {
      const result = await runMember(ctx, roomId, target, text, text)
      produced.push(...result.messages)

      // 总管干完，看看它有没有在回复里派活
      if (target.role === 'host' && result.outcome !== undefined) {
        const reply = result.outcome.text
        const fresh = loadDb().rooms.find((r) => r.id === roomId)
        if (fresh === undefined) continue
        const receivers = dispatchTargets(fresh, reply, target)
        if (receivers.length === 0) continue

        // 派活前先把任务卡都立起来，状态 running；同时做软写锁的声明
        const plans = receivers.map((receiver) => ({
          receiver,
          task: taskFor(reply, receiver.name)
        }))

        const withCards = loadDb()
        const hostRoom = withCards.rooms.find((r) => r.id === roomId)
        const warnings: Message[] = []

        for (const plan of plans) {
          const files = extractFiles(plan.task)
          const seat = hostRoom?.members?.find((m) => m.botId === plan.receiver.botId)
          if (seat !== undefined && files.length > 0) {
            const others = (hostRoom?.members ?? []).filter((m) => m.botId !== seat.botId)
            for (const file of files) {
              const owner = others.find((m) => (m.files ?? []).includes(file))
              if (owner !== undefined) {
                const warn = makeMessage(
                  roomId,
                  'system',
                  'system',
                  `软写锁提醒：${file} 已经声明给 ${owner.name}，${seat.name} 这次也可能会动它，交付时请留意冲突。`
                )
                warnings.push(warn)
              }
            }
            seat.files = [...new Set([...(seat.files ?? []), ...files])]
          }
        }

        const cards = plans.map((plan) => {
          const seat = hostRoom?.members?.find((m) => m.botId === plan.receiver.botId)
          const card = makeMessage(
            roomId,
            'assignment',
            target.botId,
            `${target.name} → ${plan.receiver.name}：${plan.task}`
          )
          card.payload = {
            title: plan.task,
            from: target.name,
            to: plan.receiver.name,
            botId: plan.receiver.botId,
            status: 'running',
            ...(seat?.files === undefined ? {} : { files: seat.files })
          }
          card.botId = plan.receiver.botId
          return card
        })

        withCards.messages.push(...warnings, ...cards)
        saveDb(withCards)
        produced.push(...warnings, ...cards)

        // 并行跑，最多 2 个同时开工
        const results = await runWithLimit(plans, DISPATCH_CONCURRENCY, async (plan) => {
          const sub = await runMember(ctx, roomId, plan.receiver, plan.task, plan.task)
          return { plan, sub }
        })

        for (const item of results) {
          if (item === null) continue
          const { plan, sub } = item
          produced.push(...sub.messages)

          const summary = (sub.outcome?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
          const doneCard = makeMessage(
            roomId,
            'assignment',
            target.botId,
            `${target.name} → ${plan.receiver.name}：${plan.task}`
          )
          doneCard.payload = {
            title: plan.task,
            from: target.name,
            to: plan.receiver.name,
            botId: plan.receiver.botId,
            status: sub.outcome === undefined ? 'failed' : 'done',
            // Handoff：把执行者的结论摘要挂在卡上，下游不用翻消息流
            ...(summary === '' ? {} : { result: summary })
          }
          doneCard.botId = plan.receiver.botId
          const closed = loadDb()
          closed.messages.push(doneCard)
          saveDb(closed)
          produced.push(doneCard)
        }
      }
    }

    const finish = loadDb()
    const finished = finish.rooms.find((r) => r.id === roomId)
    if (finished !== undefined) {
      finished.status = 'created'
      finished.updatedAt = nowIso()
      for (const member of finished.members ?? []) {
        if (member.status === 'queued') member.status = 'idle'
      }
    }
    saveDb(finish)

    return { messages: produced, skipped: false }
  })
}
