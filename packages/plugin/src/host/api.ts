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
import type { Room } from '@dshbot/core'
import { runOnce } from './agent.js'
import type { AgentContext } from './agent.js'
import { loadRooms, saveRooms } from './store.js'

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

/**
 * 造一个绑定 Host 上下文的处理器。
 *
 * @param ctx - 用来起 agent 的上下文
 */
export function createHandler(ctx: AgentContext) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://dshbot.local')
    const path = url.pathname

    try {
      if (path === `${API_PREFIX}/health`) {
        send(res, 200, { ok: true })
        return
      }

      // 探针：验证「起 agent → 投消息 → 拿回复」这条链路
      if (path === `${API_PREFIX}/_probe` && req.method === 'POST') {
        const input = (await readJson(req)) as { prompt?: unknown }
        if (!isNonEmptyString(input.prompt)) {
          send(res, 400, { error: 'prompt 不能为空' })
          return
        }
        const outcome = await runOnce(ctx, input.prompt, process.cwd())
        send(res, 200, outcome)
        return
      }

      if (path === `${API_PREFIX}/rooms`) {
        if (req.method === 'GET') {
          send(res, 200, { rooms: loadRooms() })
          return
        }
        if (req.method === 'POST') {
          const input = (await readJson(req)) as Record<string, unknown>
          const room = buildRoom(input)
          if ('error' in room) {
            send(res, 400, { error: room.error })
            return
          }
          const rooms = loadRooms()
          rooms.unshift(room)
          saveRooms(rooms)
          send(res, 201, { room })
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
