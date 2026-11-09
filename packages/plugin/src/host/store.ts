/**
 * 房间与消息的存储：一个 JSON 文件，原子写入。
 *
 * 位置在 DSH home 下的 `dshbot/rooms.json`，跟 profile 解耦——
 * 换 profile 不该丢房间。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Message, Room } from '@dshbot/core'

/** 文件格式版本，将来迁移用。 */
export interface Database {
  version: 1
  rooms: Room[]
  messages: Message[]
}

const EMPTY: Database = { version: 1, rooms: [], messages: [] }

/** DSH home，与宿主保持一致（`$DSH_HOME` 优先，否则 `~/.dsh`）。 */
function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 数据文件路径。 */
export function dataFile(): string {
  return join(dshHome(), 'dshbot', 'rooms.json')
}

/**
 * 惰性迁移：老房间没有 members，补一只默认 Bot 接管它原来的会话。
 *
 * 不做独立迁移脚本——数据量小，读的时候顺手补最省事。
 *
 * @param room - 读出来的房间
 * @returns 补过 members 的房间
 */
function migrateRoom(room: Room): Room {
  if (Array.isArray(room.members) && room.members.length > 0) return room
  return {
    ...room,
    members: [
      {
        botId: 'bot_default',
        name: '小柯',
        role: 'worker',
        avatar: '🧑‍💻',
        ...(room.sessionId === undefined ? {} : { sessionId: room.sessionId }),
        ...(room.sessionSeq === undefined ? {} : { sessionSeq: room.sessionSeq }),
        status: 'idle',
        tokensUsed: room.tokensUsed ?? 0
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
      messages: Array.isArray(parsed.messages) ? parsed.messages : []
    }
  } catch {
    return { ...EMPTY, rooms: [], messages: [] }
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
