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
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { acceptanceWarning, auditRecords, makeBackup, makeBot, memberFromBot, newId, normalizeAcceptanceLine, nowIso, orderPlanItems, parseMentions, searchMessages, splitPersona, toJsonl, validateBackup } from '@dshbot/core'
import type { BotDefinition, Budget, Member, Message, ModelRef, Room, TeamTemplate } from '@dshbot/core'
import type { AgentContext } from './agent.js'
import { listWorkspaceFiles, readWorkspaceFile } from './files.js'
import type { Database } from './store.js'
import { appendMessages, deleteMessages, loadDb, messagesOf, roomsRoot, saveBackupFile, saveDb, updateMessages, writeMessages } from './store.js'
import { cancelRoom, deliverRoom, fileDiff, handleRoomMessage, listVersions, liveActivitiesOf, makeMessage, rollbackWorkspace, runPlan, snapshotsOf } from './turn.js'

/** 前缀，必须与注册时一致。 */
export const API_PREFIX = '/dshbot/api'

/**
 * 当前部署可选哪些 agent preset。
 *
 * 工具集跟 preset 走，所以「给 Bot 配工具」实际是「给 Bot 选 preset」。
 */
function listPresets(ctx: AgentContext): { id: string; label: string }[] {
  const known = [
    { id: 'standard', label: '标准（全部工具）' },
    { id: 'ptc', label: 'PTC（程序化工具调用）' },
    { id: 'minimal', label: '最小（不能读写文件）' },
    { id: 'cordis', label: 'Cordis 插件开发' }
  ]
  try {
    const listed = ctx.agentPresets?.list?.()
    if (Array.isArray(listed) && listed.length > 0) {
      return listed
        .map((item) => {
          const id = typeof item === 'string' ? item : String((item as { id?: unknown })?.id ?? '')
          return known.find((entry) => entry.id === id) ?? { id, label: id }
        })
        .filter((entry) => entry.id !== '' && entry.id !== 'undefined')
    }
  } catch {
    /* 服务不在就退回内置列表 */
  }
  return known
}

/** 请求体上限，防手抖。恢复备份时单独放宽。 */
const MAX_BODY = 64 * 1024
const MAX_RESTORE_BODY = 50 * 1024 * 1024

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

async function readJson(req: IncomingMessage, maxBytes = MAX_BODY): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > maxBytes) throw new Error('请求体过大')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 解析模型入参：undefined = 不改，null/'' = 清空，对象 = 设置。 */
type ModelInput =
  | { ok: true; value: ModelRef | null | undefined }
  | { ok: false }

function parseModelInput(value: unknown): ModelInput {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null || value === '') return { ok: true, value: null }
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false }
  const raw = value as Record<string, unknown>
  if (!isNonEmptyString(raw.provider) || !isNonEmptyString(raw.model)) {
    return { ok: false }
  }
  return { ok: true, value: { provider: raw.provider.trim(), model: raw.model.trim() } }
}

/**
 * 建房时初始成员：只有显式选了团队模板才拉人，否则就是空房间。
 *
 * 不再自动塞「小柯」：没有岗位卡的 Bot 会撞名、抢主笔，而且让"成员"这件事
 * 变得不可预期。首次使用的引导交给 `POST /rooms/demo` 和空状态。
 *
 * @param db - 当前库
 * @param teamId - 可选的团队模板 id
 */
function seedMembersFor(db: Database, teamId: unknown): Member[] | { error: string } {
  if (isNonEmptyString(teamId)) {
    const team = (db.teams ?? []).find((item) => item.id === teamId.trim())
    if (team === undefined) return { error: `团队模板不存在：${teamId}` }
    const members = team.botIds
      .map((id) => db.bots.find((bot) => bot.id === id))
      .filter((bot): bot is BotDefinition => bot !== undefined)
      .map((bot) => memberFromBot(bot))
    if (members.length === 0) return { error: '这个团队模板里的 Bot 都已经不在库里了' }
    return members
  }
  return []
}

/** 校验并构造一个新房间。 */
function buildRoom(
  input: Record<string, unknown>,
  seedMembers: Member[]
): Room | { error: string } {
  const name = input.name
  const goal = input.goal
  const acceptanceRaw = input.acceptance

  if (!isNonEmptyString(name)) return { error: 'name 不能为空' }
  if (!isNonEmptyString(goal)) return { error: 'goal 不能为空' }

  const acceptance = (Array.isArray(acceptanceRaw)
    ? acceptanceRaw.filter(isNonEmptyString)
    : isNonEmptyString(acceptanceRaw)
      ? [acceptanceRaw]
      : []
  )
    .map((line) => normalizeAcceptanceLine(line))
    .filter((line) => line !== '')

  if (acceptance.length === 0) return { error: '至少需要一条验收标准' }

  const now = nowIso()
  const id = newId('room')

  // 可以绑定一个已有目录当工作区；不填就用房间自己的空目录
  let workspaceDir = join(roomsRoot(), id, 'work')
  if (isNonEmptyString(input.workspaceDir)) {
    const bound = resolve(input.workspaceDir.trim())
    if (!existsSync(bound)) return { error: `工作目录不存在：${bound}` }
    workspaceDir = bound
  }
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
    // 团队模板 / 默认成员由调用方算好；没有就留空，让用户自己从库里拉
    members: seedMembers,
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
  appendMessages(roomId, [note])
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

      // ---- /presets（当前部署可选的 agent preset，决定工具集）----
      if (parts.length === 1 && parts[0] === 'presets') {
        send(res, 200, { presets: listPresets(ctx), defaultPreset: 'standard' })
        return
      }

      // ---- /models（当前部署可路由的模型目录）----
      if (parts.length === 1 && parts[0] === 'models' && method === 'GET') {
        let catalog: unknown = { default: null, groups: [], failures: [] }
        try {
          const listed = await ctx.sessionController?.modelCatalog?.()
          if (listed !== undefined) catalog = listed
        } catch {
          /* 服务不在就返回空目录，表单退回“跟随默认” */
        }
        send(res, 200, { catalog })
        return
      }

      // ---- /backup（整库导出）----
      if (parts.length === 1 && parts[0] === 'backup' && method === 'GET') {
        const db = loadDb()
        const messages: Record<string, Message[]> = {}
        for (const room of db.rooms) messages[room.id] = messagesOf(room.id)
        const backup = makeBackup({
          rooms: db.rooms,
          bots: db.bots,
          teams: db.teams ?? [],
          messages
        })
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="dshbot-backup-${nowIso().slice(0, 10)}.json"`,
          'cache-control': 'no-store'
        })
        res.end(JSON.stringify(backup, null, 2))
        return
      }

      // ---- /backup/restore（整库恢复；必须先 confirm）----
      if (parts.length === 2 && parts[0] === 'backup' && parts[1] === 'restore' && method === 'POST') {
        const input = (await readJson(req, MAX_RESTORE_BODY)) as {
          confirm?: unknown
          backup?: unknown
        }
        if (input.confirm !== true) {
          send(res, 400, { error: '恢复会覆盖当前所有房间与消息，请显式传 confirm:true' })
          return
        }
        const checked = validateBackup(input.backup)
        if (!checked.ok) {
          send(res, 400, { error: `备份格式不对：${checked.error}` })
          return
        }
        const backup = checked.backup
        const db = loadDb()

        // 覆盖前先把当前库写一份到 backups/，出问题还能找回来
        const currentMessages: Record<string, Message[]> = {}
        for (const room of db.rooms) currentMessages[room.id] = messagesOf(room.id)
        const autoBackup = saveBackupFile(
          makeBackup({
            rooms: db.rooms,
            bots: db.bots,
            teams: db.teams ?? [],
            messages: currentMessages
          })
        )

        for (const room of db.rooms) deleteMessages(room.id)
        for (const room of backup.rooms) {
          writeMessages(room.id, backup.messages[room.id] ?? [])
        }
        saveDb({
          version: 1,
          rooms: backup.rooms,
          bots: backup.bots,
          teams: backup.teams
        })

        const messageCount = Object.values(backup.messages).reduce(
          (sum, list) => sum + list.length,
          0
        )
        send(res, 200, {
          ok: true,
          restored: {
            rooms: backup.rooms.length,
            bots: backup.bots.length,
            teams: backup.teams.length,
            messages: messageCount
          },
          backupFile: autoBackup
        })
        return
      }

      // ---- /bots（房间外的角色卡库）----
      if (parts[0] === 'bots') {
        if (parts.length === 1 && method === 'GET') {
          send(res, 200, { bots: loadDb().bots })
          return
        }

        // ---- /bots/teams（团队模板：一组 Bot 的固定搭配）----
        if (parts[1] === 'teams') {
          if (parts.length === 2 && method === 'GET') {
            send(res, 200, { teams: loadDb().teams ?? [] })
            return
          }
          if (parts.length === 2 && method === 'POST') {
            const input = (await readJson(req)) as { name?: unknown; botIds?: unknown }
            if (!isNonEmptyString(input.name)) {
              send(res, 400, { error: 'name 不能为空' })
              return
            }
            const botIds = Array.isArray(input.botIds)
              ? input.botIds.filter(isNonEmptyString).map((id) => id.trim())
              : []
            const ids = [...new Set(botIds)]
            if (ids.length === 0) {
              send(res, 400, { error: '至少选一只 Bot' })
              return
            }
            const db = loadDb()
            const missing = ids.filter((id) => !db.bots.some((bot) => bot.id === id))
            if (missing.length > 0) {
              send(res, 404, { error: `这些 Bot 不在库里：${missing.join('、')}` })
              return
            }
            const now = nowIso()
            const team: TeamTemplate = {
              id: newId('team'),
              name: input.name.trim(),
              botIds: ids,
              createdAt: now,
              updatedAt: now
            }
            db.teams = [...(db.teams ?? []), team]
            saveDb(db)
            send(res, 201, { team })
            return
          }
          if (parts.length === 3 && method === 'DELETE') {
            const db = loadDb()
            db.teams = (db.teams ?? []).filter((team) => team.id !== parts[2])
            saveDb(db)
            send(res, 200, { deleted: true })
            return
          }
          send(res, 404, { error: 'not found' })
          return
        }

        // ---- /bots/import（接受导出的同格式 JSON）----
        if (parts.length === 2 && parts[1] === 'import' && method === 'POST') {
          const input = (await readJson(req)) as Record<string, unknown>
          const wrapper = input.bot
          const card =
            wrapper !== null && typeof wrapper === 'object'
              ? (wrapper as Record<string, unknown>)
              : input
          if (input.format !== undefined && input.format !== 'dshbot.bot') {
            send(res, 400, { error: `不认识的格式：${String(input.format)}` })
            return
          }
          if (!isNonEmptyString(card.name)) {
            send(res, 400, { error: '导入的 Bot 缺 name' })
            return
          }
          const text = (key: string): string | undefined =>
            isNonEmptyString(card[key]) ? (card[key] as string).trim() : undefined
          const modelInput = parseModelInput(card.model)
          if (!modelInput.ok) {
            send(res, 400, { error: 'model 必须是 {provider, model}' })
            return
          }
          const bot = makeBot({
            name: text('name') as string,
            ...(text('avatar') === undefined ? {} : { avatar: text('avatar') as string }),
            ...(text('persona') === undefined ? {} : { persona: text('persona') as string }),
            ...(text('expertise') === undefined ? {} : { expertise: text('expertise') as string }),
            ...(text('instructions') === undefined ? {} : { instructions: text('instructions') as string }),
            ...(text('agentPreset') === undefined ? {} : { agentPreset: text('agentPreset') as string }),
            ...(modelInput.value === undefined || modelInput.value === null
              ? {}
              : { model: modelInput.value })
          })
          const db = loadDb()
          db.bots.push(bot)
          saveDb(db)
          send(res, 201, { bot })
          return
        }

        // ---- /bots/:id/export（导出一张角色卡）----
        if (parts.length === 3 && parts[2] === 'export' && method === 'GET') {
          const db = loadDb()
          const bot = db.bots.find((item) => item.id === parts[1])
          if (bot === undefined) {
            send(res, 404, { error: '这个 Bot 不存在' })
            return
          }
          send(res, 200, {
            format: 'dshbot.bot',
            version: 1,
            exportedAt: nowIso(),
            bot: {
              name: bot.name,
              avatar: bot.avatar,
              ...(bot.persona === undefined ? {} : { persona: bot.persona }),
              ...(bot.expertise === undefined ? {} : { expertise: bot.expertise }),
              ...(bot.instructions === undefined ? {} : { instructions: bot.instructions }),
              ...(bot.agentPreset === undefined ? {} : { agentPreset: bot.agentPreset }),
              ...(bot.model === undefined ? {} : { model: bot.model })
            }
          })
          return
        }

        // /bots/split：把一大段话拆成三块，不落库
        if (parts.length === 2 && parts[1] === 'split' && method === 'POST') {
          const input = (await readJson(req)) as { text?: unknown }
          if (!isNonEmptyString(input.text)) {
            send(res, 400, { error: 'text 不能为空' })
            return
          }
          send(res, 200, splitPersona(input.text))
          return
        }
        if (parts.length === 1 && method === 'POST') {
          const input = (await readJson(req)) as Record<string, unknown>
          if (!isNonEmptyString(input.name)) {
            send(res, 400, { error: 'name 不能为空' })
            return
          }
          // 允许直接贴一大段，服务端顺手拆开
          const split = isNonEmptyString(input.text)
            ? splitPersona(input.text)
            : { persona: '', expertise: '', instructions: '' }
          const modelInput = parseModelInput(input.model)
          if (!modelInput.ok) {
            send(res, 400, { error: 'model 必须是 {provider, model}' })
            return
          }
          const bot = makeBot({
            name: input.name,
            avatar: isNonEmptyString(input.avatar) ? input.avatar : undefined,
            persona: isNonEmptyString(input.persona)
              ? input.persona
              : split.persona === ''
                ? undefined
                : split.persona,
            expertise: isNonEmptyString(input.expertise)
              ? input.expertise
              : split.expertise === ''
                ? undefined
                : split.expertise,
            instructions: isNonEmptyString(input.instructions)
              ? input.instructions
              : split.instructions === ''
                ? undefined
                : split.instructions,
            agentPreset: isNonEmptyString(input.agentPreset)
              ? input.agentPreset.trim()
              : undefined,
            ...(modelInput.value === undefined || modelInput.value === null
              ? {}
              : { model: modelInput.value })
          })
          const db = loadDb()
          db.bots.push(bot)
          saveDb(db)
          send(res, 201, { bot })
          return
        }
        const botId = parts[1] ?? ''
        if (parts.length === 2 && method === 'PATCH') {
          const input = (await readJson(req)) as Record<string, unknown>
          const db = loadDb()
          const target = db.bots.find((b) => b.id === botId)
          if (target === undefined) {
            send(res, 404, { error: '这个 Bot 不存在' })
            return
          }
          for (const key of ['name', 'avatar', 'persona', 'expertise', 'instructions', 'agentPreset'] as const) {
            if (isNonEmptyString(input[key])) target[key] = input[key].trim()
            else if (input[key] === '') delete target[key]
          }
          const modelInput = parseModelInput(input.model)
          if (!modelInput.ok) {
            send(res, 400, { error: 'model 必须是 {provider, model}' })
            return
          }
          if (modelInput.value === null) delete target.model
          else if (modelInput.value !== undefined) target.model = modelInput.value
          target.updatedAt = nowIso()
          saveDb(db)
          send(res, 200, { bot: target })
          return
        }
        if (parts.length === 2 && method === 'DELETE') {
          const db = loadDb()
          db.bots = db.bots.filter((b) => b.id !== botId)
          saveDb(db)
          send(res, 200, { deleted: true })
          return
        }
        send(res, 404, { error: 'not found' })
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
          const db = loadDb()
          const seed = seedMembersFor(db, input.teamId)
          if ('error' in seed) {
            send(res, 400, { error: seed.error })
            return
          }
          const room = buildRoom(input, seed)
          if ('error' in room) {
            send(res, 400, { error: room.error })
            return
          }
          db.rooms.unshift(room)
          saveDb(db)
          const warning = acceptanceWarning(room.acceptance)
          send(res, 201, { room, ...(warning === undefined ? {} : { warning }) })
          return
        }
        send(res, 405, { error: 'method not allowed' })
        return
      }

      // ---- /rooms/demo（首次使用：一键建一个能直接跑的示例房间）----
      if (parts.length === 2 && parts[1] === 'demo' && method === 'POST') {
        const demoMember = (
          name: string,
          avatar: string,
          role: 'host' | 'worker',
          expertise: string,
          persona: string,
          instructions: string
        ): Member => ({
          botId: newId('bot'),
          name,
          role,
          avatar,
          status: 'idle',
          tokensUsed: 0,
          expertise,
          persona,
          instructions
        })

        const seed: Member[] = [
          demoMember(
            '阿岚',
            '🧭',
            'host',
            '拆解与统筹',
            '技术项目经理，擅长拆解目标、识别风险、把活分给对的人。',
            '派活时写清交付物、验收口径和先后依赖；不要自己深挖细节。'
          ),
          demoMember(
            '老周',
            '🛠',
            'worker',
            '电源与热设计',
            '资深硬件工程师，做过十年电源与热设计，习惯先算最坏情况。',
            '先给结论，再列风险与验证方法；参数带单位和容差。'
          ),
          demoMember(
            '小柯',
            '📝',
            'worker',
            '技术写作',
            '技术文档编辑，擅长把工程材料写成非技术读者也能看懂的说明。',
            '先一句话总评，再分章节；关键参数用表格，不编造数据。'
          )
        ]

        const room = buildRoom(
          {
            name: '示例：电源模块交付',
            goal: '为一块 5V/3A 供电模块产出开发流程，并写成 docs/示例交付.md',
            acceptance: [
              'file:docs/示例交付.md',
              '文档覆盖电源、结构与散热、认证三部分'
            ],
            mode: 'confirm'
          },
          seed
        )
        if ('error' in room) {
          send(res, 400, { error: room.error })
          return
        }

        const db = loadDb()
        db.rooms.unshift(room)
        saveDb(db)
        const note = makeMessage(
          room.id,
          'system',
          'system',
          '示例房间已建好：说一句话，总管会出计划；批准后执行。产物写到 docs/示例交付.md，验收由机器判。'
        )
        appendMessages(room.id, [note])
        send(res, 201, { room, messages: [note] })
        return
      }

      const roomId = parts[1] ?? ''
      const room = loadDb().rooms.find((r) => r.id === roomId)
      if (room === undefined) {
        send(res, 404, { error: `房间不存在：${roomId}` })
        return
      }

      // ---- /rooms/:id（改 / 删）----
      if (parts.length === 2) {
        if (method === 'PATCH') {
          const input = (await readJson(req)) as {
            name?: unknown
            goal?: unknown
            acceptance?: unknown
            workspaceDir?: unknown
            budget?: unknown
            mode?: unknown
          }
          const db = loadDb()
          const target = db.rooms.find((r) => r.id === roomId)
          if (target === undefined) {
            send(res, 404, { error: '房间不存在' })
            return
          }

          if (input.name !== undefined) {
            if (!isNonEmptyString(input.name)) {
              send(res, 400, { error: 'name 不能为空' })
              return
            }
            target.name = input.name.trim()
          }
          if (input.goal !== undefined) {
            if (!isNonEmptyString(input.goal)) {
              send(res, 400, { error: 'goal 不能为空' })
              return
            }
            target.goal = input.goal.trim()
          }
          if (input.acceptance !== undefined) {
            const list = (Array.isArray(input.acceptance)
              ? input.acceptance.filter(isNonEmptyString)
              : []
            )
              .map((line) => normalizeAcceptanceLine(line))
              .filter((line) => line !== '')
            if (list.length === 0) {
              send(res, 400, { error: '至少需要一条验收标准' })
              return
            }
            target.acceptance = list
          }

          if (input.workspaceDir !== undefined) {
            if (!isNonEmptyString(input.workspaceDir)) {
              send(res, 400, { error: '工作目录不能为空' })
              return
            }
            const bound = resolve(input.workspaceDir.trim())
            if (!existsSync(bound)) {
              send(res, 400, { error: `工作目录不存在：${bound}` })
              return
            }
            target.workspaceDir = bound
          }

          // 预算：允许改单项；0 表示不限制（与 core 的语义一致）
          if (input.budget !== undefined) {
            if (input.budget === null || typeof input.budget !== 'object' || Array.isArray(input.budget)) {
              send(res, 400, { error: 'budget 必须是对象' })
              return
            }
            const raw = input.budget as Record<string, unknown>
            const next: Budget = { ...target.budget }
            for (const key of ['perRun', 'perBot', 'perRoom'] as const) {
              if (raw[key] === undefined) continue
              const value = Number(raw[key])
              if (!Number.isFinite(value) || value < 0) {
                send(res, 400, { error: `budget.${key} 必须是非负数` })
                return
              }
              next[key] = Math.round(value)
            }
            target.budget = next
          }

          if (input.mode !== undefined) {
            if (input.mode !== 'confirm' && input.mode !== 'auto') {
              send(res, 400, { error: "mode 只能是 confirm 或 auto" })
              return
            }
            target.mode = input.mode
          }

          target.updatedAt = nowIso()
          saveDb(db)
          const warning = acceptanceWarning(target.acceptance)
          send(res, 200, { room: target, ...(warning === undefined ? {} : { warning }) })
          return
        }

        if (method === 'DELETE') {
          const db = loadDb()
          db.rooms = db.rooms.filter((r) => r.id !== roomId)
          saveDb(db)
          // 房间没了，消息文件也一起清掉，别留孤儿
          deleteMessages(roomId)
          send(res, 200, { deleted: true })
          return
        }

        if (method === 'GET') {
          send(res, 200, { room })
          return
        }

        send(res, 405, { error: 'method not allowed' })
        return
      }

      // ---- /rooms/:id/clone（另存为：复制目标/验收/成员，不带消息）----
      if (parts.length === 3 && parts[2] === 'clone' && method === 'POST') {
        const db = loadDb()
        const source = db.rooms.find((r) => r.id === roomId)
        if (source === undefined) {
          send(res, 404, { error: '房间不存在' })
          return
        }
        const now = nowIso()
        const id = newId('room')
        const workspaceDir = join(roomsRoot(), id, 'work')
        try {
          mkdirSync(workspaceDir, { recursive: true })
        } catch {
          /* 建不出来等第一次跑再试 */
        }
        const clone: Room = {
          ...source,
          id,
          name: `${source.name} 副本`,
          status: 'created',
          shared: '',
          workspaceDir,
          tokensUsed: 0,
          // 成员整份复制（岗位/专长/工具集都带着），但会话与花费清零
          members: (source.members ?? []).map((member) => ({
            ...member,
            sessionId: undefined,
            sessionSeq: undefined,
            status: 'idle',
            activity: undefined,
            tokensUsed: 0,
            files: undefined
          })),
          pendingPlan: undefined,
          delivery: undefined,
          createdAt: now,
          updatedAt: now
        }
        db.rooms.unshift(clone)
        saveDb(db)
        send(res, 201, { room: clone })
        return
      }

      // ---- /rooms/:id/events（房间状态的 SSE 流）----
      if (parts.length === 3 && parts[2] === 'events' && method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no'
        })

        const push = (): void => {
          const fresh = loadDb().rooms.find((r) => r.id === roomId)
          if (fresh === undefined) {
            res.write('event: gone\ndata: {}\n\n')
            return
          }
          // 把内存里的实时活动合进去，界面能看到"正在读哪个文件"
          const live = liveActivitiesOf(roomId)
          const merged = {
            ...fresh,
            members: (fresh.members ?? []).map((member) =>
              live[member.botId] === undefined
                ? member
                : { ...member, activity: live[member.botId], status: 'thinking' }
            )
          }
          res.write('data: ' + JSON.stringify(merged) + '\n\n')
        }

        push()
        const timer = setInterval(push, 1200)
        req.on('close', () => {
          clearInterval(timer)
          res.end()
        })
        return
      }

      // ---- /rooms/:id/members（拉人：库里拉 或 临时加）----
      if (parts.length === 3 && parts[2] === 'members' && method === 'POST') {
        const input = (await readJson(req)) as {
          name?: unknown
          role?: unknown
          avatar?: unknown
          defId?: unknown
          persona?: unknown
          expertise?: unknown
          instructions?: unknown
          agentPreset?: unknown
          model?: unknown
        }
        const db = loadDb()
        const target = db.rooms.find((r) => r.id === roomId)
        if (target === undefined) {
          send(res, 404, { error: '房间不存在' })
          return
        }

        // 从 Bot 库拉：把角色卡整份复制进来，之后房间内改动不影响库
        const def = isNonEmptyString(input.defId)
          ? db.bots.find((b) => b.id === input.defId)
          : undefined
        if (isNonEmptyString(input.defId) && def === undefined) {
          send(res, 404, { error: '这个 Bot 不在库里' })
          return
        }

        const name = (def?.name ?? (isNonEmptyString(input.name) ? input.name.trim() : ''))
        if (name === '') {
          send(res, 400, { error: 'name 不能为空' })
          return
        }
        if ((target.members ?? []).some((m) => m.name === name)) {
          send(res, 409, { error: `房间里已经有「${name}」了` })
          return
        }

        const pick = (fromInput: unknown, fromDef: string | undefined): string | undefined =>
          isNonEmptyString(fromInput) ? fromInput.trim() : fromDef
        const modelInput = parseModelInput(input.model)
        if (!modelInput.ok) {
          send(res, 400, { error: 'model 必须是 {provider, model}' })
          return
        }
        const model = modelInput.value === undefined ? def?.model : modelInput.value ?? undefined

        const member: Member = {
          botId: newId('bot'),
          name,
          role: input.role === 'host' ? 'host' : 'worker',
          avatar: pick(input.avatar, def?.avatar) ?? '🤖',
          status: 'idle',
          tokensUsed: 0,
          ...(def === undefined ? {} : { defId: def.id }),
          ...(pick(input.persona, def?.persona) === undefined
            ? {}
            : { persona: pick(input.persona, def?.persona) }),
          ...(pick(input.expertise, def?.expertise) === undefined
            ? {}
            : { expertise: pick(input.expertise, def?.expertise) }),
          ...(pick(input.instructions, def?.instructions) === undefined
            ? {}
            : { instructions: pick(input.instructions, def?.instructions) }),
          ...(pick(input.agentPreset, def?.agentPreset) === undefined
            ? {}
            : { agentPreset: pick(input.agentPreset, def?.agentPreset) }),
          ...(model === undefined ? {} : { model })
        }
        target.members = [...(target.members ?? []), member]
        target.updatedAt = nowIso()
        saveDb(db)
        send(res, 201, { member, room: target })
        return
      }

      // ---- /rooms/:id/members/:botId（改 / 移除）----
      if (
        parts.length === 4 &&
        parts[2] === 'members' &&
        (method === 'PATCH' || method === 'DELETE')
      ) {
        const botId = parts[3] ?? ''
        const db = loadDb()
        const target = db.rooms.find((r) => r.id === roomId)
        const member = (target?.members ?? []).find((m) => m.botId === botId)
        if (target === undefined || member === undefined) {
          send(res, 404, { error: `房间里没有这只 Bot：${botId}` })
          return
        }

        if (method === 'DELETE') {
          target.members = (target.members ?? []).filter((m) => m.botId !== botId)
          if (target.hostBotId === botId) delete target.hostBotId
          target.updatedAt = nowIso()
          saveDb(db)
          send(res, 200, { deleted: true, room: target })
          return
        }

        const input = (await readJson(req)) as Record<string, unknown>
        if (input.name !== undefined) {
          if (!isNonEmptyString(input.name)) {
            send(res, 400, { error: 'name 不能为空' })
            return
          }
          const name = input.name.trim()
          const taken = (target.members ?? []).some((m) => m.botId !== botId && m.name === name)
          if (taken) {
            send(res, 409, { error: `房间里已经有「${name}」了` })
            return
          }
          member.name = name
        }
        if (input.role !== undefined) {
          if (input.role !== 'host' && input.role !== 'worker') {
            send(res, 400, { error: "role 只能是 host 或 worker" })
            return
          }
          member.role = input.role
          if (input.role === 'host') target.hostBotId = member.botId
          else if (target.hostBotId === member.botId) delete target.hostBotId
        }
        if (input.avatar !== undefined) {
          member.avatar = isNonEmptyString(input.avatar) ? input.avatar.trim() : '🤖'
        }
        for (const key of ['persona', 'expertise', 'instructions', 'agentPreset'] as const) {
          if (isNonEmptyString(input[key])) member[key] = input[key].trim()
          else if (input[key] === '') delete member[key]
        }
        const modelInput = parseModelInput(input.model)
        if (!modelInput.ok) {
          send(res, 400, { error: 'model 必须是 {provider, model}' })
          return
        }
        if (modelInput.value === null) delete member.model
        else if (modelInput.value !== undefined) member.model = modelInput.value

        target.updatedAt = nowIso()
        saveDb(db)
        send(res, 200, { member, room: target })
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
        // 计划没批准时房间里只有派活说明，验收只会得出"没有成品"的结论，不如直接拦住
        if (room.pendingPlan !== undefined) {
          send(res, 409, {
            error: `还有 ${room.pendingPlan.items.length} 件事等你批准，先点「批准执行」再验收`
          })
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
          appendMessages(roomId, [note])
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
          appendMessages(roomId, [note])
          target.updatedAt = nowIso()
          saveDb(db)
          send(res, 200, { room: target, messages: [note] })
          return
        }

        send(res, 400, { error: `未知动作：${action}` })
        return
      }

      // ---- /rooms/:id/audit（导出 JSONL / 读 JSON 数组）----
      if (parts.length === 3 && parts[2] === 'audit' && method === 'GET') {
        const records = auditRecords(messagesOf(roomId))
        if (url.searchParams.get('format') === 'json') {
          send(res, 200, { records })
          return
        }
        res.writeHead(200, {
          'content-type': 'application/x-ndjson; charset=utf-8',
          'content-disposition': `attachment; filename="${roomId}.audit.jsonl"`,
          'cache-control': 'no-store'
        })
        res.end(toJsonl(records))
        return
      }

      // ---- /rooms/:id/search（搜索房间消息）----
      if (parts.length === 3 && parts[2] === 'search' && method === 'GET') {
        const query = (url.searchParams.get('q') ?? '').trim()
        if (query === '') {
          send(res, 400, { error: 'q 不能为空' })
          return
        }
        const rawLimit = Number(url.searchParams.get('limit') ?? '20')
        const limit = Number.isFinite(rawLimit) ? Math.round(rawLimit) : 20
        const results = searchMessages(messagesOf(roomId), query, limit)
        send(res, 200, { query, results, count: results.length })
        return
      }

      // ---- /rooms/:id/diff（看单个文件的变更）----
      if (parts.length === 3 && parts[2] === 'diff' && method === 'GET') {
        const file = url.searchParams.get('file') ?? ''
        if (file.trim() === '') {
          send(res, 400, { error: 'file 不能为空' })
          return
        }
        const dir = room.workspaceDir ?? join(roomsRoot(), roomId, 'work')
        send(res, 200, fileDiff(snapshotsOf(room), dir, file))
        return
      }

      // ---- /rooms/:id/files（列工作区里的文件）----
      if (parts.length === 3 && parts[2] === 'files' && method === 'GET') {
        const dir = room.workspaceDir ?? join(roomsRoot(), roomId, 'work')
        send(res, 200, listWorkspaceFiles(dir))
        return
      }

      // ---- /rooms/:id/file（预览一个文本文件）----
      if (parts.length === 3 && parts[2] === 'file' && method === 'GET') {
        const dir = room.workspaceDir ?? join(roomsRoot(), roomId, 'work')
        const preview = readWorkspaceFile(dir, url.searchParams.get('path') ?? '')
        if (!preview.ok) {
          send(res, preview.status, { error: preview.error })
          return
        }
        send(res, 200, preview)
        return
      }

      // ---- /rooms/:id/plan（批准 / 部分批准 / 否决待确认计划）----
      if (parts.length === 3 && parts[2] === 'plan' && method === 'POST') {
        const input = (await readJson(req)) as {
          action?: unknown
          itemIds?: unknown
          dependencies?: unknown
        }
        const action = String(input.action ?? '')
        const db = loadDb()
        const target = db.rooms.find((r) => r.id === roomId)
        if (target === undefined) {
          send(res, 404, { error: '房间不存在' })
          return
        }
        const plan = target.pendingPlan
        if (plan === undefined) {
          send(res, 409, { error: '没有待确认的计划' })
          return
        }

        // 计划里的任务卡状态随之变化：选中的 running，没选的 skipped
        const markCards = (statusOf: (payload: Record<string, unknown>) => string): void => {
          updateMessages(roomId, (messages) => {
            for (const message of messages) {
              const payload = message.payload as Record<string, unknown> | undefined
              if (payload?.planId === plan.id) payload.status = statusOf(payload)
            }
          })
        }

        if (action === 'reject') {
          markCards(() => 'rejected')
          target.pendingPlan = undefined
          target.status = 'created'
          target.updatedAt = nowIso()
          const note = makeMessage(roomId, 'system', 'system', '计划已否决，没有执行。')
          appendMessages(roomId, [note])
          saveDb(db)
          send(res, 200, { room: target, messages: [note] })
          return
        }

        if (action === 'approve') {
          // 部分批准：itemIds 缺省 = 全批；给了就只跑这几件
          const requested =
            input.itemIds === undefined
              ? undefined
              : Array.isArray(input.itemIds)
                ? input.itemIds.filter(isNonEmptyString)
                : null
          if (requested === null) {
            send(res, 400, { error: 'itemIds 必须是字符串数组' })
            return
          }
          if (requested !== undefined && requested.length === 0) {
            send(res, 400, { error: '至少要选一件事；都不想做就点「否决」' })
            return
          }

          const wanted = requested === undefined ? undefined : new Set(requested)
          const selected = plan.items.filter((item) =>
            wanted === undefined ? true : item.id !== undefined && wanted.has(item.id)
          )
          if (wanted !== undefined) {
            const known = new Set(
              plan.items.map((item) => item.id).filter((id): id is string => id !== undefined)
            )
            const unknown = [...wanted].filter((id) => !known.has(id))
            if (unknown.length > 0) {
              send(res, 400, { error: `计划里没有这些事：${unknown.join('、')}` })
              return
            }
            if (selected.length === 0) {
              send(res, 400, { error: '这个计划是老版本生成的，没有单件 id，只能全部批准' })
              return
            }
          }

          const chosen = new Set(
            selected.map((item) => item.id).filter((id): id is string => id !== undefined)
          )

          // 依赖：默认沿用总管声明；批准时可以覆盖（UI 改依赖）
          let dependencyOverride: Map<string, string[]> | undefined
          if (input.dependencies !== undefined) {
            if (
              input.dependencies === null ||
              typeof input.dependencies !== 'object' ||
              Array.isArray(input.dependencies)
            ) {
              send(res, 400, { error: 'dependencies 必须是 {itemId: string[]} 对象' })
              return
            }
            dependencyOverride = new Map()
            for (const [itemId, rawDeps] of Object.entries(
              input.dependencies as Record<string, unknown>
            )) {
              if (!chosen.has(itemId)) {
                send(res, 400, { error: `依赖挂在未批准的任务上：${itemId}` })
                return
              }
              if (!Array.isArray(rawDeps) || !rawDeps.every(isNonEmptyString)) {
                send(res, 400, { error: `dependencies.${itemId} 必须是字符串数组` })
                return
              }
              const deps = [...new Set(rawDeps.map((dep) => dep.trim()))]
              if (deps.includes(itemId)) {
                send(res, 400, { error: '任务不能依赖自己' })
                return
              }
              const unknown = deps.filter((dep) => !chosen.has(dep))
              if (unknown.length > 0) {
                send(res, 400, { error: `依赖的任务没有批准：${unknown.join('、')}` })
                return
              }
              dependencyOverride.set(itemId, deps)
            }
          }

          const selectedWithDeps = selected.map((item) => ({
            ...item,
            dependsOn:
              (item.id === undefined ? undefined : dependencyOverride?.get(item.id)) ??
              item.dependsOn ??
              []
          }))
          const dag = orderPlanItems(
            selectedWithDeps.map((item) => ({
              id: item.id,
              dependsOn: item.dependsOn
            }))
          )
          if (dag.cycle) {
            send(res, 400, { error: '依赖成环，无法执行' })
            return
          }
          if (dag.missing.length > 0) {
            send(res, 400, { error: `依赖指向不存在的任务：${dag.missing.join('、')}` })
            return
          }

          markCards((payload) => {
            if (wanted === undefined) return 'running'
            const itemId = typeof payload.itemId === 'string' ? payload.itemId : undefined
            return itemId !== undefined && chosen.has(itemId) ? 'running' : 'skipped'
          })
          target.pendingPlan = undefined
          target.status = 'working'
          target.updatedAt = nowIso()

          const skippedCount = plan.items.length - selected.length
          // 批准这件事必须进消息流：否则执行者读到的还是"计划已生成，等待确认"
          appendMessages(roomId, [
            makeMessage(
              roomId,
              'system',
              'system',
              `计划已批准：${selected.length} 件事开始执行` +
                (skippedCount > 0 ? `，${skippedCount} 件先跳过（任务卡标为 skipped）。` : '。')
            )
          ])
          saveDb(db)

          const produced = await runPlan(
            ctx,
            roomId,
            plan.hostBotId,
            plan.hostName,
            selectedWithDeps.map((item) => ({
              botId: item.botId,
              name: item.name,
              task: item.task,
              ...(item.id === undefined ? {} : { itemId: item.id }),
              ...(item.dependsOn === undefined || item.dependsOn.length === 0
                ? {}
                : { dependsOn: item.dependsOn })
            }))
          )

          const after = loadDb()
          const fresh = after.rooms.find((r) => r.id === roomId)
          if (fresh !== undefined) {
            fresh.status = 'created'
            fresh.updatedAt = nowIso()
            saveDb(after)
          }
          send(res, 200, { ok: true, messages: produced, room: fresh })
          return
        }

        send(res, 400, { error: `未知动作：${action}` })
        return
      }

      // ---- /rooms/:id/versions（版本列表 / 回滚）----
      if (parts.length === 3 && parts[2] === 'versions') {
        const dir = room.workspaceDir ?? join(roomsRoot(), roomId, 'work')
        const snap = snapshotsOf(room)
        if (method === 'GET') {
          send(res, 200, { versions: listVersions(snap, dir) })
          return
        }
        if (method === 'POST') {
          const input = (await readJson(req)) as { hash?: unknown }
          if (!isNonEmptyString(input.hash)) {
            send(res, 400, { error: 'hash 不能为空' })
            return
          }
          const ok = rollbackWorkspace(snap, dir, input.hash.trim())
          const note = makeMessage(
            roomId,
            'system',
            'system',
            ok ? `已回滚到版本 ${input.hash.trim()}` : `回滚失败：${input.hash.trim()}`
          )
          appendMessages(roomId, [note])
          send(res, ok ? 200 : 500, { ok, versions: listVersions(snap, dir), messages: [note] })
          return
        }
        send(res, 405, { error: 'method not allowed' })
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
        appendMessages(roomId, [note])
        saveDb(db)
        send(res, 200, { stopped, messages: [note] })
        return
      }

      // ---- /rooms/:id/messages（读 / 说）----
      if (parts.length === 3 && parts[2] === 'messages') {
        if (method === 'GET') {
          const limitRaw = url.searchParams.get('limit')
          const before = url.searchParams.get('before')

          // 不带 limit 时保持老行为（一次给全）——外部脚本还在这么用
          if (limitRaw === null && before === null) {
            send(res, 200, { messages: messagesOf(roomId), hasMore: false })
            return
          }

          const parsedLimit = Number(limitRaw ?? '80')
          const limit = Number.isFinite(parsedLimit)
            ? Math.min(Math.max(Math.round(parsedLimit), 1), 500)
            : 80
          const all = messagesOf(roomId)
          let slice = all
          if (before !== null) {
            const index = all.findIndex((message) => message.id === before)
            if (index < 0) {
              send(res, 400, { error: `before 这条消息不存在：${before}` })
              return
            }
            slice = all.slice(0, index)
          }
          const start = Math.max(0, slice.length - limit)
          send(res, 200, {
            messages: slice.slice(start),
            hasMore: start > 0,
            total: slice.length
          })
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
            appendMessages(roomId, [note])
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
