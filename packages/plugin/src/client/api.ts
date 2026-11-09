/**
 * 浏览器侧的房间 API 客户端。
 *
 * URL 用**文档相对路径**（`dshbot/api/...`，没有前导斜杠）：
 * web 下解析成 `/dshbot/api/...`，Electron 下解析成 `dsh://app/dshbot/api/...`，
 * 由主进程的协议处理转发给本地 webserver。这是 DSH 自家插件的既有约定。
 */
import type { Delivery, Member, Message, Room } from '@dshbot/core'

const BASE = 'dshbot/api'

/** 建房间的入参。 */
export interface NewRoomInput {
  name: string
  goal: string
  acceptance: string[]
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

/** 读某个房间的消息。 */
export async function listMessages(roomId: string): Promise<Message[]> {
  const data = await request<{ messages: Message[] }>(`rooms/${roomId}/messages`)
  return data.messages ?? []
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
  input: { name: string; role?: 'host' | 'worker' }
): Promise<{ member: Member; room: Room }> {
  return request<{ member: Member; room: Room }>(`rooms/${roomId}/members`, {
    method: 'POST',
    body: JSON.stringify(input)
  })
}

/** 跑一次验收，拿交付结论。 */
export async function deliver(roomId: string): Promise<Delivery> {
  const data = await request<{ delivery: Delivery }>(`rooms/${roomId}/deliver`, {
    method: 'POST',
    body: '{}'
  })
  return data.delivery
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
