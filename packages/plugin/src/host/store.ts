/**
 * 房间与消息的存储：一个 JSON 文件，原子写入。
 *
 * 位置在 DSH home 下的 `dshbot/rooms.json`，跟 profile 解耦——
 * 换 profile 不该丢房间。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { BotDefinition, Message, Room } from '@dshbot/core'

/** 文件格式版本，将来迁移用。 */
export interface Database {
  version: 1
  rooms: Room[]
  messages: Message[]
  /** 房间外可复用的 Bot 角色卡。 */
  bots: BotDefinition[]
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
    const raw = readFileSync(join(dshHome(), 'dshbot', 'config.json'), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as DshbotConfig) : {}
  } catch {
    return {}
  }
}

const EMPTY: Database = { version: 1, rooms: [], messages: [], bots: [] }

/** DSH home，与宿主保持一致（`$DSH_HOME` 优先，否则 `~/.dsh`）。 */
function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 数据文件路径。 */
export function dataFile(): string {
  return join(dshHome(), 'dshbot', 'rooms.json')
}

/** 房间目录的根：每个房间在这里有自己的工作区。 */
export function roomsRoot(): string {
  return join(dshHome(), 'dshbot', 'rooms')
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

/** 读整个库。文件缺失或损坏时退回空库，不抛错。 */
export function loadDb(): Database {
  try {
    const raw = readFileSync(dataFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Database>
    const rooms = Array.isArray(parsed.rooms) ? parsed.rooms : []
    return {
      version: 1,
      rooms: rooms.map(migrateRoom),
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
      bots: Array.isArray(parsed.bots) ? parsed.bots : []
    }
  } catch {
    return { ...EMPTY }
  }
}

/** 覆盖写入。先写临时文件再改名，避免半截文件。 */
export function saveDb(db: Database): void {
  const file = dataFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  renameSync(tmp, file)
}

/** 读某个房间的消息，按时间正序。 */
export function messagesOf(roomId: string): Message[] {
  return loadDb()
    .messages.filter((m) => m.roomId === roomId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
