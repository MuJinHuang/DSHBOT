/**
 * P1：首次使用引导。
 *
 * `POST /rooms/demo` 必须能一键产出一个"直接能跑"的房间：
 * 三个角色、机器可判的验收、一条说明消息。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import { fakeCtx, makeDataDir, startApi } from './helpers/harness.mjs'

const dataDir = makeDataDir()
let api

before(async () => {
  api = await startApi(dataDir, fakeCtx())
})

after(async () => {
  await api.close()
})

test('示例房间：三个角色、file: 验收、带说明消息', async () => {
  const res = await api.api('rooms/demo', { method: 'POST', body: '{}' })
  assert.equal(res.status, 201, res.text)
  const room = res.data.room
  assert.match(room.name, /示例/)
  assert.equal(room.members.length, 3)
  const host = room.members.find((member) => member.role === 'host')
  assert.ok(host !== undefined, '必须有一个总管')
  assert.deepEqual(
    room.members.map((member) => member.name).sort(),
    ['小柯', '老周', '阿岚'].sort()
  )
  assert.ok(room.acceptance.some((line) => line.startsWith('file:')))
  assert.equal(room.mode, 'confirm')
  assert.ok(room.workspaceDir !== undefined)

  const messages = await api.api(`rooms/${room.id}/messages`)
  assert.equal(messages.status, 200)
  assert.equal(messages.data.messages.length, 1)
  assert.match(messages.data.messages[0].text, /示例房间已建好/)

  const list = await api.api('rooms')
  assert.ok(list.data.rooms.some((item) => item.id === room.id))
})

test('示例房间可以重复创建（每次都是独立房间）', async () => {
  const first = await api.api('rooms/demo', { method: 'POST', body: '{}' })
  const second = await api.api('rooms/demo', { method: 'POST', body: '{}' })
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.notEqual(first.data.room.id, second.data.room.id)
  assert.notEqual(
    first.data.room.members[0].botId,
    second.data.room.members[0].botId,
    '成员身份不能跨房间复用'
  )
})
