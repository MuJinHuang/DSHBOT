/**
 * 浏览器侧的房间 API 客户端。
 *
 * URL 用**文档相对路径**（`dshbot/api/...`，没有前导斜杠）：
 * web 下解析成 `/dshbot/api/...`，Electron 下解析成 `dsh://app/dshbot/api/...`，
 * 由主进程的协议处理转发给本地 webserver。这是 DSH 自家插件的既有约定。
 */
import type { Delivery, Member, Message, MessageMatch, Room } from '@dshbot/core'

const BASE = 'dshbot/api'

/** 建房间的入参。 */
export interface NewRoomInput {
  name: string
  goal: string
  acceptance: string[]
  /** 可选：绑定一个已有目录当工作区；不填就用房间自己的空目录。 */
  workspaceDir?: string
  /** 可选：从团队模板一键拉人。 */
  teamId?: string
  /** 可选：confirm（默认，先批准）/ auto（直接开跑）。 */
  mode?: 'confirm' | 'auto'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}/${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init
    })
  } catch (error) {
    throw new Error(`请求失败：${error instanceof Error ? error.message : '网络错误'}`)
  }

  const text = await res.text()
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}

  if (!res.ok) {
    const message = typeof data.error === 'string' ? data.error : `HTTP ${res.status}`
    throw new Error(message)
  }
  return data as T
}

/** 列出所有房间。 */
export async function listRooms(): Promise<Room[]> {
  const data = await request<{ rooms: Room[] }>('rooms')
  return data.rooms ?? []
}

/** 建一个房间。 */
export async function createRoom(input: NewRoomInput): Promise<Room> {
  const data = await request<{ room: Room }>('rooms', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return data.room
}

/** 建一个可以直接跑的示例房间（首次使用引导）。 */
export async function createDemoRoom(): Promise<Room> {
  const data = await request<{ room: Room }>('rooms/demo', {
    method: 'POST',
    body: '{}'
  })
  return data.room
}

/** 读某个房间的消息。 */
export async function listMessages(roomId: string): Promise<Message[]> {
  const data = await request<{ messages: Message[] }>(`rooms/${roomId}/messages`)
  return data.messages ?? []
}

/** 读一页消息（从新往旧翻，返回的仍是正序）。 */
export async function listMessagePage(
  roomId: string,
  options: { limit?: number; before?: string } = {}
): Promise<{ messages: Message[]; hasMore: boolean }> {
  const params = new URLSearchParams()
  params.set('limit', String(options.limit ?? 80))
  if (options.before !== undefined) params.set('before', options.before)
  return request<{ messages: Message[]; hasMore: boolean }>(
    `rooms/${roomId}/messages?${params.toString()}`
  )
}

/** 搜索房间消息（服务端搜全部历史，不限于当前已加载的一页）。 */
export async function searchRoomMessages(
  roomId: string,
  query: string,
  limit = 20
): Promise<MessageMatch[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  const data = await request<{ results: MessageMatch[] }>(
    `rooms/${roomId}/search?${params.toString()}`
  )
  return data.results ?? []
}

/** 在房间里说一句话，等 Bot 回话。 */
export async function say(roomId: string, text: string): Promise<Message[]> {
  const data = await request<{ messages: Message[] }>(`rooms/${roomId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text })
  })
  return data.messages ?? []
}

/** 房间状态动作：暂停 / 恢复 / 归档 / 仅@响应。 */
export async function setRoomState(
  roomId: string,
  action: 'pause' | 'resume' | 'archive' | 'unarchive' | 'toggleMentionOnly'
): Promise<Room> {
  const data = await request<{ room: Room }>(`rooms/${roomId}/state`, {
    method: 'POST',
    body: JSON.stringify({ action })
  })
  return data.room
}

/** 拉一只新 Bot 进房间。 */
export async function addMember(
  roomId: string,
  input: {
    name?: string
    role?: 'host' | 'worker'
    avatar?: string
    /** 从 Bot 库拉时给这个，会整份复制角色卡。 */
    defId?: string
    persona?: string
    expertise?: string
    instructions?: string
    agentPreset?: string
  }
): Promise<{ member: Member; room: Room }> {
  return request<{ member: Member; room: Room }>(`rooms/${roomId}/members`, {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

/** 改房间里的一只 Bot（不碰库里的角色卡）。 */
export async function updateMember(
  roomId: string,
  botId: string,
  input: {
    name?: string
    role?: 'host' | 'worker'
    avatar?: string
    persona?: string
    expertise?: string
    instructions?: string
    agentPreset?: string
  }
): Promise<{ member: Member; room: Room }> {
  return request<{ member: Member; room: Room }>(`rooms/${roomId}/members/${botId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  })
}

/** 把一只 Bot 移出房间。 */
export async function removeMember(roomId: string, botId: string): Promise<Room> {
  const data = await request<{ room: Room }>(`rooms/${roomId}/members/${botId}`, {
    method: 'DELETE'
  })
  return data.room
}

/** 工作区里的一个文件。 */
export interface WorkspaceFileEntry {
  path: string
  size: number
  mtime: string
}

/** 列房间工作区里的文件。 */
export async function listFiles(
  roomId: string
): Promise<{ files: WorkspaceFileEntry[]; truncated: boolean }> {
  return request<{ files: WorkspaceFileEntry[]; truncated: boolean }>(`rooms/${roomId}/files`)
}

/** 读一个文本文件；二进制 / 超大 / 越界会抛错。 */
export async function readFile(
  roomId: string,
  path: string
): Promise<{ path: string; size: number; mtime: string; text: string }> {
  return request<{ path: string; size: number; mtime: string; text: string }>(
    `rooms/${roomId}/file?path=${encodeURIComponent(path)}`
  )
}

/** 跑一次验收，拿交付结论。 */
export async function deliver(roomId: string): Promise<Delivery> {
  const data = await request<{ delivery: Delivery }>(`rooms/${roomId}/deliver`, {
    method: 'POST',
    body: '{}'
  })
  return data.delivery
}

/** 停止当前这一轮。 */
export async function stop(roomId: string): Promise<{ stopped: boolean }> {
  return request<{ stopped: boolean }>(`rooms/${roomId}/stop`, {
    method: 'POST',
    body: '{}'
  })
}

/** 改房间（名称 / 目标 / 验收）。 */
export async function updateRoom(
  roomId: string,
  input: {
    name?: string
    goal?: string
    acceptance?: string[]
    workspaceDir?: string
    budget?: { perRun?: number; perBot?: number; perRoom?: number }
    mode?: 'confirm' | 'auto'
  }
): Promise<Room> {
  const data = await request<{ room: Room }>(`rooms/${roomId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  })
  return data.room
}

/** 删除房间。 */
export async function deleteRoom(roomId: string): Promise<void> {
  await request<{ deleted: boolean }>(`rooms/${roomId}`, { method: 'DELETE' })
}

/** 一个可复用的 Bot 角色卡。 */
export interface BotCard {
  id: string
  name: string
  avatar: string
  persona?: string
  expertise?: string
  instructions?: string
  agentPreset?: string
}

/** 部署里可选的工具集（agent preset）。 */
export interface PresetEntry {
  id: string
  label: string
}

/** 列 Bot 库。 */
export async function listBots(): Promise<BotCard[]> {
  const data = await request<{ bots: BotCard[] }>('bots')
  return data.bots ?? []
}

/** 把一大段话拆成 岗位 / 专长 / 输出规范。 */
export async function splitBotText(
  text: string
): Promise<{ persona: string; expertise: string; instructions: string }> {
  return request<{ persona: string; expertise: string; instructions: string }>('bots/split', {
    method: 'POST',
    body: JSON.stringify({ text })
  })
}

/** 存入 Bot 库。 */
export async function saveBot(input: Partial<BotCard> & { name: string }): Promise<BotCard> {
  const data = await request<{ bot: BotCard }>('bots', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return data.bot
}

/** 改库里的 Bot。 */
export async function updateBot(
  botId: string,
  input: Partial<Omit<BotCard, "id">> & { name?: string }
): Promise<BotCard> {
  const data = await request<{ bot: BotCard }>(`bots/${botId}`, {
    method: 'PATCH',
    body: JSON.stringify(input)
  })
  return data.bot
}

/** 删库里的 Bot。 */
export async function deleteBot(botId: string): Promise<void> {
  await request<{ deleted: boolean }>(`bots/${botId}`, { method: 'DELETE' })
}

/** 导出的角色卡格式（与 POST /bots/import 对称）。 */
export interface BotExport {
  format: 'dshbot.bot'
  version: number
  exportedAt: string
  bot: {
    name: string
    avatar: string
    persona?: string
    expertise?: string
    instructions?: string
    agentPreset?: string
  }
}

/** 导出一张角色卡。 */
export async function exportBot(botId: string): Promise<BotExport> {
  return request<BotExport>(`bots/${botId}/export`)
}

/** 导入一张角色卡（接受导出的同格式 JSON）。 */
export async function importBot(payload: unknown): Promise<BotCard> {
  const data = await request<{ bot: BotCard }>('bots/import', {
    method: 'POST',
    body: JSON.stringify(payload)
  })
  return data.bot
}

/** 团队模板：一组 Bot 的固定搭配。 */
export interface TeamTemplate {
  id: string
  name: string
  botIds: string[]
  createdAt: string
  updatedAt: string
}

/** 列团队模板。 */
export async function listTeams(): Promise<TeamTemplate[]> {
  const data = await request<{ teams: TeamTemplate[] }>('bots/teams')
  return data.teams ?? []
}

/** 把一组 Bot 存成团队模板。 */
export async function saveTeam(input: { name: string; botIds: string[] }): Promise<TeamTemplate> {
  const data = await request<{ team: TeamTemplate }>('bots/teams', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return data.team
}

/** 删团队模板。 */
export async function deleteTeam(teamId: string): Promise<void> {
  await request<{ deleted: boolean }>(`bots/teams/${teamId}`, { method: 'DELETE' })
}

/** 另存为房间：复制目标/验收/成员，不带消息。 */
export async function cloneRoom(roomId: string): Promise<Room> {
  const data = await request<{ room: Room }>(`rooms/${roomId}/clone`, {
    method: 'POST',
    body: '{}'
  })
  return data.room
}

/** 列出可选工具集。 */
export async function listPresets(): Promise<PresetEntry[]> {
  const data = await request<{ presets: PresetEntry[] }>('presets')
  return data.presets ?? []
}

/** 拉审计 JSONL 原文（一行一条，能直接喂给脚本）。 */
export async function fetchAudit(roomId: string): Promise<string> {
  const res = await fetch(`dshbot/api/rooms/${roomId}/audit`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/** 审计记录（界面用，形状与 JSONL 一致）。 */
export interface AuditRecord {
  at: string
  kind: string
  from: string
  text: string
  tool?: { name: string; input: string; output: string }
  card?: { status: string; result?: string; planId?: string }
}

/** 拉审计记录数组（界面筛选用）。 */
export async function fetchAuditRecords(roomId: string): Promise<AuditRecord[]> {
  const data = await request<{ records: AuditRecord[] }>(`rooms/${roomId}/audit?format=json`)
  return data.records ?? []
}

/** 看某个文件的变更。 */
export async function fetchDiff(
  roomId: string,
  file: string
): Promise<{ stat: string; diff: string }> {
  return request<{ stat: string; diff: string }>(
    `rooms/${roomId}/diff?file=${encodeURIComponent(file)}`
  )
}

/** 批准、部分批准或否决待确认的计划。 */
export async function decidePlan(
  roomId: string,
  action: 'approve' | 'reject',
  itemIds?: string[]
): Promise<{ messages: Message[]; room?: Room }> {
  return request<{ messages: Message[]; room?: Room }>(`rooms/${roomId}/plan`, {
    method: 'POST',
    body: JSON.stringify({ action, ...(itemIds === undefined ? {} : { itemIds }) })
  })
}

/** 版本列表。 */
export interface VersionEntry {
  hash: string
  subject: string
  date: string
}

export async function listVersions(roomId: string): Promise<VersionEntry[]> {
  const data = await request<{ versions: VersionEntry[] }>(`rooms/${roomId}/versions`)
  return data.versions
}

/** 回滚到某个版本。 */
export async function rollback(roomId: string, hash: string): Promise<boolean> {
  const data = await request<{ ok: boolean }>(`rooms/${roomId}/versions`, {
    method: 'POST',
    body: JSON.stringify({ hash })
  })
  return data.ok
}

/** 接管 / 交还。 */
export async function takeover(
  roomId: string,
  action: 'take' | 'return',
  note?: string
): Promise<{ room: Room; messages: Message[] }> {
  return request<{ room: Room; messages: Message[] }>(`rooms/${roomId}/takeover`, {
    method: 'POST',
    body: JSON.stringify({ action, ...(note === undefined ? {} : { note }) })
  })
}
