/**
 * P1：整库备份 / 恢复。
 *
 * 恢复是覆盖操作：必须 confirm、格式错误拒绝、恢复前自动备份当前库。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fakeCtx, makeDataDir, readMessages, seedDb, startApi } from './helpers/harness.mjs'

const dataDir = makeDataDir()
let api

const now = '2026-11-12T00:00:00.000Z'
function room(id, name) {
  return {
    id,
    name,
    goal: 'g',
    acceptance: ['file:x.md'],
    status: 'created',
    mode: 'confirm',
    budget: { perRun: 100000, perBot: 100000, perRoom: 100000 },
    shared: '',
    tokensUsed: 0,
    members: [],
    createdAt: now,
    updatedAt: now
  }
}
function message(id, roomId, text) {
  return {
    id,
    roomId,
    kind: 'system',
    from: 'system',
    text,
    createdAt: now
  }
}

before(async () => {
  seedDb(dataDir, {
    version: 1,
    rooms: [room('room_a', '房间 A'), room('room_b', '房间 B')],
    messages: [message('msg_a', 'room_a', 'A 的消息'), message('msg_b', 'room_b', 'B 的消息')],
    bots: [{ id: 'bot_1', name: '老周', avatar: '🛠', createdAt: now, updatedAt: now }],
    teams: [{ id: 'team_1', name: '小分队', botIds: ['bot_1'], createdAt: now, updatedAt: now }]
  })
  api = await startApi(dataDir, fakeCtx())
})

after(async () => {
  await api.close()
})

test('导出备份：房间、Bot、团队、消息都在', async () => {
  const res = await api.api('backup')
  assert.equal(res.status, 200, res.text)
  assert.equal(res.data.format, 'dshbot.backup')
  assert.equal(res.data.version, 1)
  assert.equal(res.data.rooms.length, 2)
  assert.equal(res.data.bots.length, 1)
  assert.equal(res.data.teams.length, 1)
  assert.equal(res.data.messages.room_a.length, 1)
  assert.equal(res.data.messages.room_b.length, 1)
})

test('恢复：必须 confirm，格式错误要拒绝', async () => {
  const exported = await api.api('backup')
  const noConfirm = await api.api('backup/restore', {
    method: 'POST',
    body: JSON.stringify({ backup: exported.data })
  })
  assert.equal(noConfirm.status, 400)

  const bad = await api.api('backup/restore', {
    method: 'POST',
    body: JSON.stringify({ confirm: true, backup: { format: 'nope' } })
  })
  assert.equal(bad.status, 400)
  assert.match(bad.data.error, /备份格式/)
})

test('恢复：覆盖房间与消息，并在覆盖前自动备份', async () => {
  const exported = await api.api('backup')
  const backup = exported.data
  const kept = backup.rooms.find((item) => item.id === 'room_a')
  kept.name = '恢复后的房间'
  backup.rooms = [kept]
  backup.bots = []
  backup.teams = []
  backup.messages = { room_a: backup.messages.room_a }

  const restored = await api.api('backup/restore', {
    method: 'POST',
    body: JSON.stringify({ confirm: true, backup })
  })
  assert.equal(restored.status, 200, restored.text)
  assert.equal(restored.data.restored.rooms, 1)
  assert.equal(restored.data.restored.messages, 1)

  const rooms = await api.api('rooms')
  assert.equal(rooms.data.rooms.length, 1)
  assert.equal(rooms.data.rooms[0].name, '恢复后的房间')
  assert.equal(readMessages(dataDir, 'room_b').length, 0, '旧房间的消息应被清掉')
  assert.equal(readMessages(dataDir, 'room_a').length, 1)

  const backupDir = join(dataDir, 'backups')
  assert.ok(existsSync(backupDir), '覆盖前应写自动备份')
  const files = readdirSync(backupDir).filter((name) => name.endsWith('.json'))
  assert.ok(files.length >= 1)
  const auto = JSON.parse(readFileSync(join(backupDir, files[0]), 'utf8'))
  assert.equal(auto.rooms.length, 2, '自动备份应保留恢复前的两个房间')
})
