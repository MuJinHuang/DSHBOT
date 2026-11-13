/**
 * 进程内跑一个一次性 agent 回合。
 *
 * 这是 M0-3 的底座：用宿主的 Agent 服务起一个会话，投递一条用户消息，
 * 等它跑完，再把助手输出取回来。
 *
 * 注意：**不 import 任何 `@deepseek-ai/*` 运行时包**。第三方插件装在 profile 的
 * node_modules 里，解析不到 app.asar 里的宿主内部包。用户消息的形状直接手搓：
 * 宿主源码里 `createUserMessage` 就是 `{...input, id, role: 'user'}`。
 *
 * 句柄形状按运行时实测调整过：`agents.create()` 返回的对象不保证带 `ctx`，
 * 所以订阅与轮询都做了防御。
 */
import { randomUUID } from 'node:crypto'
import { newId } from '@dshbot/core'
import type { ModelRef } from '@dshbot/core'
import { loadConfig } from './store.js'

/** 单轮默认最长等待：5 分钟。改代码的任务比读文档慢得多。 */
const DEFAULT_RUN_TIMEOUT_MS = 300_000

/**
 * 本轮最多等多久。
 *
 * 优先级：环境变量 `DSHBOT_RUN_TIMEOUT_MS` > config.json 的 `runTimeoutMs` > 默认 5 分钟。
 * 夹在 10 秒到 30 分钟之间，避免手滑写成 0 或一整天。
 */
export function runTimeoutMs(): number {
  const fromEnv = Number(process.env.DSHBOT_RUN_TIMEOUT_MS)
  const raw =
    Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : (loadConfig().runTimeoutMs ?? 0)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RUN_TIMEOUT_MS
  return Math.min(Math.max(Math.round(raw), 10_000), 1_800_000)
}

/** 一次工具调用。 */
export interface ToolStep {
  callId: string
  name: string
  /** 参数原文（JSON 字符串）。 */
  input: string
  /** 工具输出文本。 */
  output: string
}

/** 一轮的 token 用量。 */
export interface Usage {
  input: number
  output: number
  total: number
}

/** 跑一次的结果。 */
export interface RunOutcome {
  sessionId: string
  /** 本轮结束后的事件水位，下次传回来当起点。 */
  lastSeq: number
  text: string
  status: string
  /** 这一轮用到的工具，按发生顺序。 */
  tools: ToolStep[]
  /** 这一轮消耗的 token。 */
  usage: Usage
  /** 诊断用：事件类型统计。 */
  eventTypes: Record<string, number>
  /** 诊断用：句柄暴露了哪些键。 */
  handleKeys: string[]
  /** 诊断用：状态序列。 */
  statuses: string[]
  /** 诊断用：每种事件的第一条样本（截断）。 */
  samples: Record<string, string>
  ms: number
  /** 是否因为等不到 idle 被超时截断——截断的结论不可信，要告诉用户。 */
  truncated: boolean
}

/** agent 句柄：形状随宿主版本变，只声明用到的方法。 */
export interface AgentHandle {
  id: string
  followup(message: unknown): void
  ctx?: { on?(event: string, listener: (payload: unknown) => void): () => void }
  on?(event: string, listener: (payload: unknown) => void): () => void
  status?: unknown
  /** 中断当前回合。 */
  cancel?(cause?: unknown): void
  /** 有人取消时给的信号。 */
  signal?: { aborted?: boolean }
}

interface SessionLike {
  events?: unknown[]
}

/** Host 上下文里本项目依赖的部分。 */
export interface AgentContext {
  agents: {
    /** UI 同款建房入口，自动带 preset 与默认模型；可能不存在。 */
    createSession?(options: {
      cwd: string
      sessionId?: string
      agentPreset?: string
    }): Promise<{ agent?: AgentHandle; agentPreset?: string }>
    /** 底层入口，必须自己给全 agentOptions。 */
    create(options: unknown): Promise<{ agent?: AgentHandle; dispose?: () => void }>
    get(id: string): AgentHandle | undefined
  }
  /** UI 同款的会话控制器，`agents.createSession` 在这里面。 */
  agentPresets?: { list?: () => unknown }
  sessionController?: {
    agents?: {
      createSession(request: {
        cwd: string
        agentPreset?: string
        sessionId?: string
      }): Promise<{ agent?: AgentHandle; agentPreset?: string }>
      /** 活着就返回，不在就冷恢复；会话不存在则抛错。 */
      resolveAgent?(sessionId: string): Promise<{ agent?: AgentHandle } & Record<string, unknown>>
    }
    /** 给已有会话装下一次请求的模型选择；老版本 DSH 可能没有。 */
    selectModel?(request: {
      sessionId: string
      provider: string
      model: string
      reasoningEffort?: string
    }): Promise<{ selected?: { provider: string; model: string } }>
    /** 当前部署可路由的模型目录。 */
    modelCatalog?(): Promise<unknown>
  }
  sessions?: { get(id: string): SessionLike | undefined }
}

/** 构造一条用户消息，形状对齐宿主的 createUserMessage。 */
function userMessage(text: string): unknown {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: 'user-rpc'
  }
}

/** 汇总事件里的 token 用量。 */
function extractUsage(events: unknown[]): Usage {
  let input = 0
  let output = 0
  let total = 0
  for (const raw of events) {
    if (raw === null || typeof raw !== 'object') continue
    const event = raw as Record<string, unknown>
    if (event.type !== 'assistant/message') continue
    const data = (event.data ?? {}) as Record<string, unknown>
    const usage = (data.usage ?? {}) as Record<string, unknown>
    if (usage === undefined) continue
    input += Number(usage.inputTokens ?? 0)
    output += Number(usage.outputTokens ?? 0)
    total += Number(usage.totalTokens ?? 0)
  }
  if (total === 0) total = input + output
  return { input, output, total }
}

/** 从事件里抽出工具调用与结果，按 callId 配对。 */
function extractTools(events: unknown[]): ToolStep[] {
  const order: string[] = []
  const byId = new Map<string, ToolStep>()

  for (const raw of events) {
    if (raw === null || typeof raw !== 'object') continue
    const event = raw as Record<string, unknown>
    const type = String(event.type ?? '')
    const data = (event.data ?? {}) as Record<string, unknown>

    if (type === 'tool/call') {
      const callId = String(data.callId ?? '')
      if (callId === '') continue
      if (!byId.has(callId)) order.push(callId)
      byId.set(callId, {
        callId,
        name: String(data.name ?? 'tool'),
        input: String(data.arguments ?? ''),
        output: ''
      })
      continue
    }

    if (type === 'tool/result') {
      const message = (data.message ?? {}) as Record<string, unknown>
      const callId = String(data.toolCallId ?? message.toolCallId ?? '')
      if (callId === '') continue
      const content = message.content
      let output = ''
      if (Array.isArray(content)) {
        output = content
          .map((part) => {
            const p = part as Record<string, unknown>
            return p.type === 'text' ? String(p.text ?? '') : ''
          })
          .join('')
      }
      const existing = byId.get(callId)
      if (existing !== undefined) existing.output = output
    }
  }

  return order.map((id) => byId.get(id)!).filter(Boolean)
}

/** 从事件流里抠出助手文本。只认 role === 'assistant' 的消息，别把用户输入拼进来。 */
function extractText(events: unknown[]): string {
  const parts: string[] = []
  for (const raw of events) {
    if (raw === null || typeof raw !== 'object') continue
    const event = raw as Record<string, unknown>
    const data = (event.data ?? {}) as Record<string, unknown>
    const message = (data.message ?? event.message) as Record<string, unknown> | undefined
    if (message === undefined) continue
    if (message.role !== 'assistant') continue
    const content = message.content as unknown
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const p = part as Record<string, unknown>
      if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text)
    }
  }
  return parts.join('\n').trim()
}

/**
 * 拿到这一轮要用的 agent：有会话就续上，没有就新开。
 *
 * @param ctx - Host 上下文
 * @param sessionId - 房间记住的会话 id，可为空
 * @param cwd - 工作目录
 * @returns agent 与它的会话 id
 */
async function acquireAgent(
  ctx: AgentContext,
  sessionId: string | undefined,
  cwd: string,
  agentPreset?: string
): Promise<{ agent: AgentHandle; sessionId: string }> {
  // ① 先试续上已有会话：内存里活着就直接用，不在就冷恢复
  if (sessionId !== undefined && sessionId !== '') {
    const resolver = ctx.sessionController?.agents?.resolveAgent
    if (resolver !== undefined) {
      try {
        const found = await resolver(sessionId)
        const agent = (found?.agent ?? found) as AgentHandle | undefined
        if (agent !== undefined && agent !== null && typeof agent.followup === 'function') {
          return { agent, sessionId: agent.id ?? sessionId }
        }
      } catch {
        /* 会话没了就往下走，新开一个 */
      }
    }
    const live = ctx.agents.get(sessionId)
    if (live !== undefined && typeof live.followup === 'function') {
      return { agent: live, sessionId: live.id ?? sessionId }
    }
  }

  // ② 新开：UI 同款路径，自动带 preset 与默认模型
  const requestedId = newId('sess')
  const viaController = ctx.sessionController?.agents?.createSession
  const created = viaController
    ? await ctx.sessionController!.agents!.createSession({
        cwd,
        ...(agentPreset === undefined ? {} : { agentPreset })
      })
    : typeof ctx.agents.createSession === 'function'
      ? await ctx.agents.createSession({ cwd })
      : await ctx.agents.create({ sessionId: requestedId, agentOptions: { cwd } })

  const agent = (created.agent ?? created) as AgentHandle
  return { agent, sessionId: agent.id ?? requestedId }
}

/**
 * 起一个 agent 或续上旧会话，投一条消息，等它回到 idle。
 *
 * @param ctx - Host 上下文
 * @param prompt - 用户输入
 * @param cwd - 工作目录
 * @param existingSessionId - 房间记住的会话 id，传了就续聊
 * @param sinceSeq - 只处理比这个序号更新的事件，用来跳过历史
 * @param onAgent - 拿到句柄时回调一次，调用方可以借它注册"停止"
 * @param onEvent - 运行中的事件回调（目前只抛工具调用），用于实时状态
 * @param agentPreset - 新会话要挂的 agent preset（决定工具集）；续聊时忽略
 * @param model - 该 Bot 指定使用的模型；不传跟随 DSH 默认
 */
export async function runOnce(
  ctx: AgentContext,
  prompt: string,
  cwd: string,
  existingSessionId?: string,
  sinceSeq = 0,
  onAgent?: (agent: AgentHandle) => void,
  onEvent?: (event: { kind: 'tool'; name: string }) => void,
  agentPreset?: string,
  model?: ModelRef
): Promise<RunOutcome> {
  const started = Date.now()
  const acquired = await acquireAgent(ctx, existingSessionId, cwd, agentPreset)
  const agent = acquired.agent
  onAgent?.(agent)
  const sessionId = acquired.sessionId

  // 每个 Bot 自己的模型：在投递消息前装到会话上，下一次请求生效
  if (model !== undefined) {
    const select = ctx.sessionController?.selectModel
    if (typeof select !== 'function') {
      throw new Error('当前 DSH 版本不支持按 Bot 选择模型（sessionController.selectModel 不存在）')
    }
    await select({ sessionId, provider: model.provider, model: model.model })
  }

  // 句柄形状随宿主版本变，先探清楚再调用，免得报一句没用的 "not a function"
  const ownKeys = Object.keys(agent)
  const protoKeys =
    typeof agent === 'object' && agent !== null
      ? Object.getOwnPropertyNames(Object.getPrototypeOf(agent))
      : []
  if (typeof agent.followup !== 'function') {
    throw new Error(
      `agent handle 没有 followup；own=[${ownKeys.join(',')}] proto=[${protoKeys.join(',')}]`
    )
  }

  const statuses: string[] = []
  const captured: unknown[] = []
  let sawBusy = false
  let resolveIdle: (() => void) | undefined
  const idle = new Promise<void>((resolve) => {
    resolveIdle = resolve
  })

  // 句柄可能把 on 放在 ctx 上，也可能直接放自己身上
  let off: (() => void) | undefined
  const emitter = typeof agent.ctx?.on === 'function' ? agent.ctx : agent
  if (typeof emitter.on === 'function') {
    try {
      emitter.on('session/event', (event) => {
        captured.push(event)
        // 顺手把工具调用抛给调用方，界面上就能看到"正在干什么"
        const frame = event as { log?: unknown[]; type?: string }
        const list = Array.isArray(frame.log) ? frame.log : [event]
        for (const item of list) {
          const entry = item as { type?: string; data?: { name?: unknown } }
          if (entry?.type === 'tool/call') {
            const name = String(entry.data?.name ?? '')
            if (name !== '') onEvent?.({ kind: 'tool', name })
          }
        }
      })
    } catch {
      /* 事件名不对就算了，诊断用 */
    }
    try {
      off = emitter.on('agent/status', (payload) => {
        const status = String((payload as { status?: unknown })?.status ?? '?')
        statuses.push(status)
        // 创建时就可能是 idle，必须等到「忙过再闲」才算这一回合结束
        if (status !== 'idle') sawBusy = true
        else if (sawBusy) resolveIdle?.()
      }) as () => void
    } catch {
      off = undefined
    }
  }

  // 超时保护：等不到 idle 就收手，但必须标记出来——截断的结论不可信
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true
      resolve()
    }, runTimeoutMs())
  })

  agent.followup(userMessage(prompt) as never)

  // 订阅没成功就轮询状态，别干等
  if (off === undefined) {
    void (async () => {
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 200))
        const status = String(agent.status ?? '')
        if (status === '') continue
        if (statuses.at(-1) !== status) statuses.push(status)
        if (status !== 'idle') sawBusy = true
        else if (sawBusy) {
          resolveIdle?.()
          return
        }
      }
    })()
  }

  await Promise.race([idle, timeout])
  if (timer !== undefined) clearTimeout(timer)
  off?.()

  const readEvents = (s: unknown): unknown[] => {
    if (s === null || typeof s !== 'object') return []
    const value = (s as { events?: unknown }).events
    if (Array.isArray(value)) return value
    if (typeof value === 'function') {
      try {
        const result = (value as () => unknown).call(s)
        return Array.isArray(result) ? result : []
      } catch {
        return []
      }
    }
    return []
  }
  // 每帧推的是**整段日志快照**（{ log: [...] }），不是增量。
  // 直接摊平会把同一事件重复十几遍，所以按 seq 去重后再排序。
  const bySeq = new Map<number, unknown>()
  const loose: unknown[] = []
  for (const item of captured) {
    const log = (item as { log?: unknown })?.log
    if (!Array.isArray(log)) {
      loose.push(item)
      continue
    }
    for (const event of log) {
      const seq = Number((event as { seq?: unknown })?.seq)
      if (Number.isFinite(seq)) bySeq.set(seq, event)
      else loose.push(event)
    }
  }
  const allEvents: unknown[] = [
    ...[...bySeq.entries()].sort((a, b) => a[0] - b[0]).map(([, event]) => event),
    ...loose
  ]

  if (allEvents.length === 0) {
    const session = ctx.sessions?.get(sessionId)
    allEvents.push(...readEvents(session))
  }

  // 续聊时事件流含整段历史，只保留水位之后的
  const events =
    sinceSeq > 0
      ? allEvents.filter((raw) => {
          const seq = Number((raw as { seq?: unknown })?.seq)
          return !Number.isFinite(seq) || seq > sinceSeq
        })
      : allEvents

  const lastSeq = allEvents.reduce<number>((max, raw) => {
    const seq = Number((raw as { seq?: unknown })?.seq)
    return Number.isFinite(seq) && seq > max ? seq : max
  }, sinceSeq)

  const eventTypes: Record<string, number> = {}
  const samples: Record<string, string> = {}
  for (const raw of events) {
    const type = String((raw as { type?: unknown })?.type ?? 'unknown')
    eventTypes[type] = (eventTypes[type] ?? 0) + 1
    if (samples[type] === undefined) {
      try {
        samples[type] = JSON.stringify(raw).slice(0, 700)
      } catch {
        samples[type] = 'unserializable'
      }
    }
  }

  return {
    sessionId,
    lastSeq,
    text: extractText(events),
    status: statuses.at(-1) ?? 'unknown',
    tools: extractTools(events),
    usage: extractUsage(events),
    eventTypes,
    handleKeys: Object.keys(agent),
    statuses,
    samples,
    ms: Date.now() - started,
    truncated: timedOut
  }
}
