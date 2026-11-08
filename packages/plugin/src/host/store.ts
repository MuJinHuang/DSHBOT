/**
 * 房间存储：一个 JSON 文件，原子写入。
 *
 * 位置在 DSH home 下的 `dshbot/rooms.json`，跟 profile 解耦——
 * 换 profile 不该丢房间。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Room } from '@dshbot/core'

/** 文件格式版本，将来迁移用。 */
interface Database {
  version: 1
  rooms: Room[]
}

const EMPTY: Database = { version: 1, rooms: [] }

/** DSH home，与宿主保持一致（`$DSH_HOME` 优先，否则 `~/.dsh`）。 */
function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 数据文件路径。 */
export function dataFile(): string {
  return join(dshHome(), 'dshbot', 'rooms.json')
}

/** 读全部房间。文件缺失或损坏时退回空库，不抛错。 */
export function loadRooms(): Room[] {
  try {
    const raw = readFileSync(dataFile(), 'utf8')
    const db = JSON.parse(raw) as Database
    return Array.isArray(db.rooms) ? db.rooms : []
  } catch {
    return []
  }
}

/** 覆盖写入。先写临时文件再改名，避免半截文件。 */
export function saveRooms(rooms: Room[]): void {
  const file = dataFile()
  mkdirSync(dirname(file), { recursive: true })
  const db: Database = { ...EMPTY, rooms }
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  renameSync(tmp, file)
}
