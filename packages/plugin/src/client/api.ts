/**
 * 浏览器侧的房间 API 客户端。
 *
 * URL 用**文档相对路径**（`dshbot/api/...`，没有前导斜杠）：
 * web 下解析成 `/dshbot/api/...`，Electron 下解析成 `dsh://app/dshbot/api/...`，
 * 由主进程的协议处理转发给本地 webserver。这是 DSH 自家插件的既有约定。
 */
import type { Room } from '@dshbot/core'

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
