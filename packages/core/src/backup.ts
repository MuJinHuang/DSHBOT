/**
 * 整库备份：房间、Bot 库、团队模板、每个房间的消息。
 *
 * 备份是纯数据，格式带 format/version，恢复前必须先校验——
 * 覆盖数据是不可逆操作，错误格式必须在这里挡住。
 */
import type { BotDefinition } from './bots.js'
import type { Message, Room, TeamTemplate } from './types.js'

/** 备份文件格式。 */
export interface BackupFile {
  format: 'dshbot.backup'
  version: 1
  exportedAt: string
  rooms: Room[]
  bots: BotDefinition[]
  teams: TeamTemplate[]
  /** roomId -> 该房间的消息。 */
  messages: Record<string, Message[]>
}

/** 恢复校验结果。 */
export type BackupCheck =
  | { ok: true; backup: BackupFile }
  | { ok: false; error: string }

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * 把当前数据打包成备份。
 *
 * @param input - 当前库与各房间消息
 * @param exportedAt - 导出时间，默认现在
 */
export function makeBackup(
  input: {
    rooms: Room[]
    bots: BotDefinition[]
    teams: TeamTemplate[]
    messages: Record<string, Message[]>
  },
  exportedAt = new Date().toISOString()
): BackupFile {
  return {
    format: 'dshbot.backup',
    version: 1,
    exportedAt,
    rooms: input.rooms,
    bots: input.bots,
    teams: input.teams,
    messages: input.messages
  }
}

/**
 * 校验一份恢复数据。只做结构校验，不做路径/工作区安全检查。
 *
 * @param value - JSON.parse 后的任意值
 */
export function validateBackup(value: unknown): BackupCheck {
  if (!isObject(value)) return { ok: false, error: '备份必须是一个对象' }
  if (value.format !== 'dshbot.backup') {
    return { ok: false, error: `不认识的备份格式：${String(value.format)}` }
  }
  if (value.version !== 1) {
    return { ok: false, error: `不支持的备份版本：${String(value.version)}` }
  }
  if (!Array.isArray(value.rooms)) return { ok: false, error: '备份缺 rooms 数组' }

  const roomIds = new Set<string>()
  for (const [index, room] of value.rooms.entries()) {
    if (!isObject(room)) return { ok: false, error: `rooms[${index}] 不是对象` }
    if (!isString(room.id) || room.id === '') {
      return { ok: false, error: `rooms[${index}] 缺 id` }
    }
    if (roomIds.has(room.id)) {
      return { ok: false, error: `房间 id 重复：${room.id}` }
    }
    roomIds.add(room.id)
    if (!isString(room.name) || room.name === '') {
      return { ok: false, error: `房间 ${room.id} 缺 name` }
    }
  }

  const bots = Array.isArray(value.bots) ? value.bots : []
  for (const [index, bot] of bots.entries()) {
    if (!isObject(bot) || !isString(bot.id) || !isString(bot.name)) {
      return { ok: false, error: `bots[${index}] 缺 id 或 name` }
    }
  }

  const teams = Array.isArray(value.teams) ? value.teams : []
  for (const [index, team] of teams.entries()) {
    if (!isObject(team) || !isString(team.id) || !isString(team.name)) {
      return { ok: false, error: `teams[${index}] 缺 id 或 name` }
    }
  }

  const messages = isObject(value.messages) ? value.messages : {}
  for (const [roomId, list] of Object.entries(messages)) {
    if (!roomIds.has(roomId)) {
      return { ok: false, error: `messages 里有不存在的房间：${roomId}` }
    }
    if (!Array.isArray(list)) {
      return { ok: false, error: `messages.${roomId} 不是数组` }
    }
    for (const [index, message] of list.entries()) {
      if (!isObject(message) || !isString(message.id) || !isString(message.text)) {
        return { ok: false, error: `messages.${roomId}[${index}] 缺 id 或 text` }
      }
    }
  }

  const normalized: BackupFile = {
    format: 'dshbot.backup',
    version: 1,
    exportedAt: isString(value.exportedAt) ? value.exportedAt : new Date().toISOString(),
    rooms: value.rooms as Room[],
    bots: bots as BotDefinition[],
    teams: teams as TeamTemplate[],
    messages: messages as Record<string, Message[]>
  }
  return { ok: true, backup: normalized }
}
