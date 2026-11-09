/**
 * 房间 API。
 *
 * 挂在 `/dshbot/api` 前缀下，浏览器用**文档相对路径**访问
 * （`dshbot/api/rooms`）——web 下解析成 `/dshbot/api/rooms`，
 * Electron 下解析成 `dsh://app/dshbot/api/rooms`，由主进程协议处理转发过来。
 *
 * 注意：路由不做鉴权，只监听回环地址；本地单用户场景够用。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { newId, nowIso } from '@dshbot/core'
import type { Message, Room } from '@dshbot/core'
import { runOnce } from './agent.js'
import type { AgentContext } from './agent.js'
import { loadDb, messagesOf, saveDb } from './store.js'

/** 前缀，必须与注册时一致。 */
export const API_PREFIX = '/dshbot/api'

/** 请求体上限，防手抖。 */
const MAX_BODY = 64 * 1024

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(body)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 校验并构造一个新房间。 */
function buildRoom(input: Record<string, unknown>): Room | { error: string } {
  const name = input.name
  const goal = input.goal
  const acceptanceRaw = input.acceptance

  if (!isNonEmptyString(name)) return { error: 'name 不能为空' }
  if (!isNonEmptyString(goal)) return { error: 'goal 不能为空' }

  const acceptance = Array.isArray(acceptanceRaw)
    ? acceptanceRaw.filter(isNonEmptyString).map((s) => s.trim())
    : isNonEmptyString(acceptanceRaw)
      ? [acceptanceRaw.trim()]
      : []

  if (acceptance.length === 0) return { error: '至少需要一条验收标准' }

  const now = nowIso()
  return {
    id: newId('room'),
    name: name.trim(),
    goal: goal.trim(),
    acceptance,
    status: 'created',
    mode: input.mode === 'auto' ? 'auto' : 'confirm',
    budget: { perRun: 200_000, perBot: 800_000, perRoom: 1_500_000 },
    shared: '',
    tokensUsed: 0,
    createdAt: now,
    updatedAt: now
  }
}

/** 造一条消息。 */
function makeMessage(roomId: string, kind: Message['kind'], from: string, text: string): Message {
  return { id: newId('msg'), roomId, kind, from, text, createdAt: nowIso() }
}

/**
 * 造一个绑定 Host 上下文的处理器。
 *
 * @param ctx - 用来起 agent 的上下文
 */
export function createHandler(ctx: AgentContext) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://dshbot.local')
    const rest = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : ''
    const parts = rest.split('/').filter(Boolean)
    const method = req.method ?? 'GET'

    try {
      // ---- /health ----
      if (parts.length === 1 && parts[0] === 'health') {
        send(res, 200, { ok: true })
        return
      }

      // ---- /_probe（开发探针）----
      if (parts.length === 1 && parts[0] === '_probe' && method === 'POST') {
        const input = (await readJson(req)) as { prompt?: unknown }
        if (!isNonEmptyString(input.prompt)) {
          send(res, 400, { error: 'prompt 不能为空' })
          return
        }
        const outcome = await runOnce(ctx, input.prompt, process.cwd())
        send(res, 200, outcome)
        return
      }

      // ---- /rooms ----
      if (parts[0] !== 'rooms') {
        send(res, 404, { error: 'not found' })
        return
      }

      // ---- /rooms（列表 / 新建）----
      if (parts.length === 1) {
        if (method === 'GET') {
          send(res, 200, { rooms: loadDb().rooms })
          return
        }
        if (method === 'POST') {
          const input = (await readJson(req)) as Record<string, unknown>
          const room = buildRoom(input)
          if ('error' in room) {
            send(res, 400, { error: room.error })
            return
          }
          const db = loadDb()
          db.rooms.unshift(room)
          saveDb(db)
          send(res, 201, { room })
          return
        }
        send(res, 405, { error: 'method not allowed' })
        return
      }

      const roomId = parts[1] ?? ''
      const db = loadDb()
      const room = db.rooms.find((r) => r.id === roomId)
      if (room === undefined) {
        send(res, 404, { error: `房间不存在：${roomId}` })
        return
      }

      // ---- /rooms/:id/messages（读 / 说）----
      if (parts.length === 3 && parts[2] === 'messages') {
        if (method === 'GET') {
          send(res, 200, { messages: messagesOf(roomId) })
          return
        }

        if (method === 'POST') {
          const input = (await readJson(req)) as { text?: unknown }
          if (!isNonEmptyString(input.text)) {
            send(res, 400, { error: 'text 不能为空' })
            return
          }

          const text = input.text.trim()
          const userMessage = makeMessage(roomId, 'human', 'human', text)

          // 先把用户消息落盘，再跑 agent —— 中途崩了也留得下
          const before = loadDb()
          before.messages.push(userMessage)
          const target = before.rooms.find((r) => r.id === roomId)
          if (target !== undefined) {
            target.status = 'working'
            target.updatedAt = nowIso()
          }
          saveDb(before)

          try {
            const outcome = await runOnce(ctx, text, room.shared !== '' ? room.shared : process.cwd())
            const reply = outcome.text !== '' ? outcome.text : '（模型没有返回文字）'
            const botMessage = makeMessage(roomId, 'bot', 'bot', reply)

            const after = loadDb()
            after.messages.push(botMessage)
            const done = after.rooms.find((r) => r.id === roomId)
            if (done !== undefined) {
              done.status = 'created'
              done.updatedAt = nowIso()
            }
            saveDb(after)

            send(res, 200, { messages: [userMessage, botMessage], sessionId: outcome.sessionId })
            return
          } catch (error) {
            const failed = loadDb()
            const back = failed.rooms.find((r) => r.id === roomId)
            if (back !== undefined) {
              back.status = 'created'
              back.updatedAt = nowIso()
            }
            saveDb(failed)
            send(res, 500, {
              error: error instanceof Error ? error.message : '执行失败',
              messages: [userMessage]
            })
            return
          }
        }

        send(res, 405, { error: 'method not allowed' })
        return
      }

      send(res, 404, { error: 'not found' })
    } catch (error) {
      send(res, 500, { error: error instanceof Error ? error.message : '未知错误' })
    }
  }
}
