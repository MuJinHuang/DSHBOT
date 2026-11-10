/**
 * 房间 API。
 *
 * 挂在 `/dshbot/api` 前缀下，浏览器用**文档相对路径**访问
 * （`dshbot/api/rooms`）——web 下解析成 `/dshbot/api/rooms`，
 * Electron 下解析成 `dsh://app/dshbot/api/rooms`，由主进程协议处理转发过来。
 *
 * 这里只做 HTTP：解析请求、校验、落库。真正的编排在 `turn.ts`。
 *
 * 注意：路由不做鉴权，只监听回环地址；本地单用户场景够用。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { newId, nowIso, parseMentions } from '@dshbot/core'
import type { Member, Room } from '@dshbot/core'
import type { AgentContext } from './agent.js'
import { loadDb, messagesOf, roomsRoot, saveDb } from './store.js'
import { cancelRoom, deliverRoom, handleRoomMessage, makeMessage } from './turn.js'

/** 前缀，必须与注册时一致。 */
export const API_PREFIX = '/dshbot/api'

/** 请求体上限，防手抖。 */
const MAX_BODY = 64 * 1024

/** 「全体停手」的暗号。 */
const STOP_PATTERN = /@所有人\s*停|@all\s+stop/i

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
  const id = newId('room')
  const workspaceDir = join(roomsRoot(), id, 'work')
  try {
    mkdirSync(workspaceDir, { recursive: true })
  } catch {
    /* 建不出来不影响建房，第一次跑的时候还会再试 */
  }

  return {
    id,
    name: name.trim(),
    goal: goal.trim(),
    acceptance,
    status: 'created',
    mode: input.mode === 'auto' ? 'auto' : 'confirm',
    budget: { perRun: 200_000, perBot: 800_000, perRoom: 1_500_000 },
    shared: '',
    workspaceDir,
    tokensUsed: 0,
    // 新房间默认拉一只执行 Bot，之后可以再拉人
    members: [
      {
        botId: 'bot_default',
        name: '小柯',
        role: 'worker',
        avatar: '🧑‍💻',
        status: 'idle',
        tokensUsed: 0
      }
    ],
    createdAt: now,
    updatedAt: now
  }
}

/** 停手机制：把房间置为暂停并留一条系统消息。 */
function pauseRoom(roomId: string, reason: string): ReturnType<typeof makeMessage> {
  const db = loadDb()
  const target = db.rooms.find((r) => r.id === roomId)
  if (target !== undefined) {
    target.status = 'paused'
    target.updatedAt = nowIso()
  }
  const note = makeMessage(roomId, 'system', 'system', reason)
  db.messages.push(note)
  saveDb(db)
  return note
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
      const room = loadDb().rooms.find((r) => r.id === roomId)
      if (room === undefined) {
        send(res, 404, { error: `房间不存在：${roomId}` })
        return
      }

      // ---- /rooms/:id/members（拉人）----
      if (parts.length === 3 && parts[2] === 'members' && method === 'POST') {
        const input = (await readJson(req)) as {
          name?: unknown
          role?: unknown
          avatar?: unknown
        }
        if (!isNonEmptyString(input.name)) {
          send(res, 400, { error: 'name 不能为空' })
          return
        }
        const name = input.name.trim()
        const db = loadDb()
        const target = db.rooms.find((r) => r.id === roomId)
        if (target === undefined) {
          send(res, 404, { error: '房间不存在' })
          return
        }
        if ((target.members ?? []).some((m) => m.name === name)) {
          send(res, 409, { error: `房间里已经有「${name}」了` })
          return
        }
        const member: Member = {
          botId: newId('bot'),
          name,
          role: input.role === 'host' ? 'host' : 'worker',
          avatar: isNonEmptyString(input.avatar) ? input.avatar : '🤖',
          status: 'idle',
          tokensUsed: 0
        }
        target.members = [...(target.members ?? []), member]
        target.updatedAt = nowIso()
        saveDb(db)
        send(res, 201, { member, room: target })
        return
      }

      // ---- /rooms/:id/state（暂停 / 恢复 / 归档 / 仅@响应）----
      if (parts.length === 3 && parts[2] === 'state' && method === 'POST') {
        const input = (await readJson(req)) as { action?: unknown }
        const action = String(input.action ?? '')
        const db = loadDb()
        const target = db.rooms.find((r) => r.id === roomId)
        if (target === undefined) {
          send(res, 404, { error: '房间不存在' })
          return
        }

        if (action === 'pause') target.status = 'paused'
        else if (action === 'resume') target.status = 'created'
        else if (action === 'archive') target.status = 'archived'
        else if (action === 'unarchive') target.status = 'created'
        else if (action === 'toggleMentionOnly') target.mentionOnly = !(target.mentionOnly ?? false)
        else {
          send(res, 400, { error: `未知动作：${action}` })
          return
        }

        target.updatedAt = nowIso()
        saveDb(db)
        send(res, 200, { room: target })
        return
      }

      // ---- /rooms/:id/deliver（验收交付）----
      if (parts.length === 3 && parts[2] === 'deliver' && method === 'POST') {
        if (room.status === 'paused' || room.status === 'archived') {
          send(res, 409, { error: '房间已暂停或归档，先恢复再验收' })
          return
        }
        const delivery = await deliverRoom(ctx, roomId)
        send(res, 200, { delivery, room: loadDb().rooms.find((r) => r.id === roomId) })
        return
      }

      // ---- /rooms/:id/takeover（接管 / 交还）----
      if (parts.length === 3 && parts[2] === 'takeover' && method === 'POST') {
        const input = (await readJson(req)) as { action?: unknown; note?: unknown }
        const action = String(input.action ?? '')
        const db = loadDb()
        const target = db.rooms.find((r) => r.id === roomId)
        if (target === undefined) {
          send(res, 404, { error: '房间不存在' })
          return
        }

        if (action === 'take') {
          target.status = 'paused'
          for (const member of target.members ?? []) {
            if (member.status === 'thinking' || member.status === 'queued') {
              member.status = 'waiting_human'
              member.activity = '已让人接管'
            }
          }
          const note = makeMessage(roomId, 'system', 'system', '已接管：Bot 停手，现在改由人直接操作工作区。')
          db.messages.push(note)
          target.updatedAt = nowIso()
          saveDb(db)
          send(res, 200, { room: target, messages: [note] })
          return
        }

        if (action === 'return') {
          target.status = 'created'
          for (const member of target.members ?? []) {
            if (member.status === 'waiting_human') {
              member.status = 'idle'
              member.activity = undefined
            }
          }
          const summary = isNonEmptyString(input.note) ? input.note.trim() : '（没有填写改了什么）'
          const note = makeMessage(
            roomId,
            'system',
            'system',
            `已交还，人在接管期间做了：${summary}`
          )
          db.messages.push(note)
          target.updatedAt = nowIso()
          saveDb(db)
          send(res, 200, { room: target, messages: [note] })
          return
        }

        send(res, 400, { error: `未知动作：${action}` })
        return
      }

      // ---- /rooms/:id/stop（停止当前这一轮）----
      if (parts.length === 3 && parts[2] === 'stop' && method === 'POST') {
        const stopped = cancelRoom(roomId)
        const db = loadDb()
        const target = db.rooms.find((r) => r.id === roomId)
        if (target !== undefined) {
          target.status = 'created'
          for (const member of target.members ?? []) {
            if (member.status === 'thinking' || member.status === 'queued') {
              member.status = 'idle'
              member.activity = undefined
            }
          }
          target.updatedAt = nowIso()
        }
        const note = makeMessage(
          roomId,
          'system',
          'system',
          stopped ? '已停止：这一轮被手动中断。' : '当前没有在跑的轮次。'
        )
        db.messages.push(note)
        saveDb(db)
        send(res, 200, { stopped, messages: [note] })
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

          if (room.status === 'paused' || room.status === 'archived') {
            send(res, 409, {
              error:
                room.status === 'paused' ? '房间已暂停，先恢复再说话' : '房间已归档，先恢复再说话'
            })
            return
          }

          const text = input.text.trim()

          // 「@所有人 停」是全体暂停的暗号
          if (STOP_PATTERN.test(text)) {
            const note = pauseRoom(roomId, '已暂停：所有 Bot 停手')
            send(res, 200, { messages: [note] })
            return
          }

          // 显式 @ 到不存在的人，提前说清楚，别让用户以为在等
          const mentions = parseMentions(text)
          const known = new Set((room.members ?? []).map((m) => m.name))
          const unknown = mentions.filter((name) => !known.has(name))
          if (mentions.length > 0 && unknown.length === mentions.length) {
            const note = makeMessage(
              roomId,
              'system',
              'system',
              `房间里没有「${unknown.join('、')}」。现有成员：${[...known].join('、')}`
            )
            const db = loadDb()
            db.messages.push(note)
            saveDb(db)
            send(res, 200, { messages: [note], skipped: true })
            return
          }

          const result = await handleRoomMessage(ctx, roomId, text)
          send(res, 200, result)
          return
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
