/**
 * P1：备份格式与校验。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeBackup, validateBackup } from '../packages/core/dist/index.js'

const room = {
  id: 'room_a',
  name: '房间 A',
  goal: 'g',
  acceptance: ['file:x.md'],
  status: 'created',
  mode: 'confirm',
  budget: { perRun: 1, perBot: 1, perRoom: 1 },
  shared: '',
  members: [],
  tokensUsed: 0,
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z'
}

const message = {
  id: 'msg_1',
  roomId: 'room_a',
  kind: 'system',
  from: 'system',
  text: 'hello',
  createdAt: '2026-11-12T00:00:01.000Z'
}

function backup() {
  return makeBackup({
    rooms: [room],
    bots: [],
    teams: [],
    messages: { room_a: [message] }
  })
}

test('makeBackup：带格式与版本', () => {
  const data = backup()
  assert.equal(data.format, 'dshbot.backup')
  assert.equal(data.version, 1)
  assert.equal(data.rooms.length, 1)
  assert.equal(data.messages.room_a.length, 1)
})

test('validateBackup：合法备份原样通过', () => {
  const checked = validateBackup(JSON.parse(JSON.stringify(backup())))
  assert.equal(checked.ok, true)
  assert.equal(checked.backup.rooms[0].id, 'room_a')
})

test('validateBackup：格式/版本/结构错误都拒绝', () => {
  assert.equal(validateBackup(null).ok, false)
  assert.equal(validateBackup({ format: 'other' }).ok, false)
  assert.equal(validateBackup({ format: 'dshbot.backup', version: 2 }).ok, false)
  assert.equal(validateBackup({ format: 'dshbot.backup', version: 1 }).ok, false)
})

test('validateBackup：重复房间 id、消息指向未知房间都拒绝', () => {
  const duplicated = backup()
  duplicated.rooms.push({ ...room })
  assert.equal(validateBackup(duplicated).ok, false)

  const ghost = backup()
  ghost.messages.room_ghost = []
  assert.equal(validateBackup(ghost).ok, false)

  const brokenMessage = backup()
  brokenMessage.messages.room_a = [{ id: 'msg_x', roomId: 'room_a' }]
  assert.equal(validateBackup(brokenMessage).ok, false)
})

test('validateBackup：缺 teams 时补成空数组', () => {
  const raw = backup()
  delete raw.teams
  const checked = validateBackup(raw)
  assert.equal(checked.ok, true)
  assert.deepEqual(checked.backup.teams, [])
})
