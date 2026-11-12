/**
 * 房间与消息的存储。
 *
 * - `rooms.json` 只存房间 / Bot 库 / 团队模板，小且写得快；
 * - 消息按房间分文件：`rooms/<roomId>/messages.jsonl`，一行一条，只追加。
 *
 * 以前消息也塞在 rooms.json 里，房间一多每存一次都要把全部消息重写一遍。
 * 现在保存房间不会再碰消息文件，消息也不会因为写房间而丢。
 *
 * 位置在 DSH home 下的 `dshbot/`，跟 profile 解耦——换 profile 不该丢房间。
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { BotDefinition, Message, Room, TeamTemplate } from '@dshbot/core'

/** 文件格式版本，将来迁移用。 */
export interface Database {
  version: 1
  rooms: Room[]
  /** 房间外可复用的 Bot 角色卡。 */
  bots: BotDefinition[]
  /** 团队模板：一组 Bot 的固定搭配。 */
  teams?: TeamTemplate[]
}

/**
 * 可调的运行参数。
 *
 * 放在 `~/.dsh/dshbot/config.json`，改完重启 DSH 生效。
 */
export interface DshbotConfig {
  /** 单轮最长等待毫秒数，默认 5 分钟；调大适合改代码的长任务。 */
  runTimeoutMs?: number
}

/** 读配置；文件不存在或坏了都返回空对象，不阻断主流程。 */
export function loadConfig(): DshbotConfig {
  try {
    const raw = readFileSync(join(dataRoot(), 'config.json'), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as DshbotConfig) : {}
  } catch {
    return {}
  }
}

/** DSH home，与宿主保持一致（`$DSH_HOME` 优先，否则 `~/.dsh`）。 */
function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * 数据根目录。
 *
 * 默认 `~/.dsh/dshbot`。开发时用 `DSHBOT_DATA_DIR` 指到临时目录——
 * 否则 dev 实例和桌面端会**同时写同一个 rooms.json**，互相覆盖。
 */
function dataRoot(): string {
  const override = process.env.DSHBOT_DATA_DIR
  return override !== undefined && override.trim() !== ''
    ? override.trim()
    : join(dshHome(), 'dshbot')
}

/** 数据文件路径。 */
export function dataFile(): string {
  return join(dataRoot(), 'rooms.json')
}

/** 房间目录的根：每个房间在这里有自己的工作区与消息文件。 */
export function roomsRoot(): string {
  return join(dataRoot(), 'rooms')
}

/** 某个房间的消息文件。 */
export function messagesFile(roomId: string): string {
  return join(roomsRoot(), roomId, 'messages.jsonl')
}

/**
 * 惰性迁移：老房间没有 members，补一只默认 Bot 接管它原来的会话；
 * 没有 workspaceDir 的，补一个默认工作区。
 *
 * 不做独立迁移脚本——数据量小，读的时候顺手补最省事。
 *
 * @param room - 读出来的房间
 * @returns 补过 members 与 workspaceDir 的房间
 */
function migrateRoom(room: Room): Room {
  const withWorkspace =
    room.workspaceDir === undefined || room.workspaceDir === ''
      ? { ...room, workspaceDir: join(roomsRoot(), room.id, 'work') }
      : room
  if (Array.isArray(withWorkspace.members) && withWorkspace.members.length > 0) return withWorkspace
  return {
    ...withWorkspace,
    members: [
      {
        botId: 'bot_default',
        name: '小柯',
        role: 'worker',
        avatar: '🧑‍💻',
        ...(withWorkspace.sessionId === undefined ? {} : { sessionId: withWorkspace.sessionId }),
        ...(withWorkspace.sessionSeq === undefined ? {} : { sessionSeq: withWorkspace.sessionSeq }),
        status: 'idle',
        tokensUsed: withWorkspace.tokensUsed ?? 0
      }
    ]
  }
}

/** 只写 rooms.json（房间 / Bot / 团队），绝不带消息。 */
function writeDatabase(db: Database): void {
  const file = dataFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const payload = {
    version: 1,
    rooms: db.rooms,
    bots: db.bots,
    teams: db.teams ?? []
  }
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8')
  renameSync(tmp, file)
}

/**
 * 把旧格式 rooms.json 里的 messages 迁到分文件里。
 *
 * 迁移是幂等的：按消息 id 去重，写文件成功后才重写 rooms.json。
 * 中途崩了，下次启动会再迁一遍，不会丢也不会重复。
 */
function migrateLegacyMessages(parsed: { messages?: unknown }, db: Database): void {
  if (!('messages' in parsed)) return
  const legacy = Array.isArray(parsed.messages) ? (parsed.messages as Message[]) : []
  const knownRooms = new Set(db.rooms.map((room) => room.id))
  const byRoom = new Map<string, Message[]>()

  for (const message of legacy) {
    if (message === null || typeof message !== 'object') continue
    if (typeof message.roomId !== 'string' || !knownRooms.has(message.roomId)) continue
    const list = byRoom.get(message.roomId) ?? []
    list.push(message)
    byRoom.set(message.roomId, list)
  }

  for (const [roomId, list] of byRoom) {
    const existing = new Set(messagesOf(roomId).map((message) => message.id))
    const fresh = list.filter((message) => !existing.has(message.id))
    if (fresh.length > 0) appendMessages(roomId, fresh)
  }

  // 消息已经安全落到分文件，rooms.json 里那份可以删了
  writeDatabase(db)
}

/** 读整个库。文件缺失或损坏时退回空库，不抛错。 */
export function loadDb(): Database {
  let parsed: (Partial<Database> & { messages?: unknown }) | undefined
  try {
    parsed = JSON.parse(readFileSync(dataFile(), 'utf8')) as Partial<Database> & {
      messages?: unknown
    }
  } catch {
    return { version: 1, rooms: [], bots: [], teams: [] }
  }

  const rooms = Array.isArray(parsed.rooms) ? parsed.rooms : []
  const db: Database = {
    version: 1,
    rooms: rooms.map(migrateRoom),
    bots: Array.isArray(parsed.bots) ? parsed.bots : [],
    teams: Array.isArray(parsed.teams) ? parsed.teams : []
  }

  migrateLegacyMessages(parsed, db)
  return db
}

/** 保存房间 / Bot / 团队。消息不在这里写，见 appendMessages。 */
export function saveDb(db: Database): void {
  writeDatabase(db)
}

/** 读某个房间的消息，按时间正序。 */
export function messagesOf(roomId: string): Message[] {
  const file = messagesFile(roomId)
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const messages: Message[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const parsed = JSON.parse(line) as Message
      if (typeof parsed?.id !== 'string' || typeof parsed?.createdAt !== 'string') continue
      messages.push(parsed)
    } catch {
      /* 单行坏了不拖垮整个房间 */
    }
  }
  return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/** 追加消息：只写这一行，不重写整个文件。 */
export function appendMessages(roomId: string, messages: Message[]): void {
  if (messages.length === 0) return
  const file = messagesFile(roomId)
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, messages.map((message) => JSON.stringify(message)).join('\n') + '\n', 'utf8')
}

/**
 * 读—改—写一个房间的消息（用于改任务卡状态）。
 *
 * 只重写这一个房间的文件，别的房间不受影响。
 */
export function updateMessages(roomId: string, mutate: (messages: Message[]) => void): void {
  const messages = messagesOf(roomId)
  mutate(messages)
  const file = messagesFile(roomId)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, messages.map((message) => JSON.stringify(message)).join('\n') + '\n', 'utf8')
  renameSync(tmp, file)
}

/** 删房间时一并删掉它的消息文件。 */
export function deleteMessages(roomId: string): void {
  rmSync(messagesFile(roomId), { force: true })
}
