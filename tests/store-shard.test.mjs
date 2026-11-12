/**
 * N1-D：规模与可观测的底座。
 *
 * 消息从 rooms.json 拆到 `rooms/<id>/messages.jsonl`：
 * 旧数据要能自动迁移、迁移要幂等、分页不能把顺序搞反。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fakeCtx, makeDataDir, readDb, readMessages, seedDb, startApi } from './helpers/harness.mjs'

const dataDir = makeDataDir()
let api

function ts(index) {
  return `2026-11-12T00:00:${String(index).padStart(2, '0')}.000Z`
}

function roomOf(id, extra = {}) {
  return {
    id,
    name: `房间 ${id}`,
    goal: '测试',
    acceptance: ['完成'],
    status: 'created',
    mode: 'confirm',
    budget: { perRun: 100000, perBot: 100000, perRoom: 100000 },
    shared: '',
    tokensUsed: 0,
    members: [
      { botId: 'bot_a', name: '甲', role: 'worker', avatar: '🅰️', status: 'idle', tokensUsed: 0 },
      { botId: 'bot_b', name: '乙', role: 'worker', avatar: '🅱️', status: 'idle', tokensUsed: 0 }
    ],
    createdAt: ts(0),
    updatedAt: ts(0),
    ...extra
  }
}

function messagesOf(count, roomId = 'room_shard') {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg_${index}`,
    roomId,
    kind: 'system',
    from: 'system',
    text: `第 ${index} 条`,
    createdAt: ts(index)
  }))
}

before(async () => {
  api = await startApi(dataDir, fakeCtx())
})

after(async () => {
  await api.close()
})

test('D2 旧格式自动迁移：messages 从 rooms.json 搬到分文件', async () => {
  const roomId = 'room_shard'
  seedDb(dataDir, {
    version: 1,
    rooms: [roomOf(roomId)],
    messages: messagesOf(30, roomId),
    bots: []
  })

  const first = await api.api(`rooms/${roomId}/messages`)
  assert.equal(first.status, 200, first.text)
  assert.equal(first.data.messages.length, 30)

  const db = readDb(dataDir)
  assert.equal('messages' in db, false, 'rooms.json 里不该再有 messages')

  const file = join(dataDir, 'rooms', roomId, 'messages.jsonl')
  assert.ok(existsSync(file), '应该生成 messages.jsonl')
  assert.equal(readMessages(dataDir, roomId).length, 30)

  // 再读一次不该重复迁移
  await api.api(`rooms/${roomId}/messages`)
  assert.equal(readMessages(dataDir, roomId).length, 30)
})

test('D2 新消息只追加到本房间的 jsonl，不再重写 rooms.json', async () => {
  const roomId = 'room_append'
  seedDb(dataDir, {
    version: 1,
    rooms: [roomOf(roomId)],
    messages: [],
    bots: []
  })
  // 第一次读会顺手把空 messages 键迁走
  await api.api(`rooms/${roomId}/messages`)
  const before = readFileSync(join(dataDir, 'rooms.json'), 'utf8')
  assert.equal('messages' in JSON.parse(before), false)

  const said = await api.api(`rooms/${roomId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: '只记录，不派活' })
  })
  assert.equal(said.status, 200, said.text)
  assert.equal(said.data.skipped, true)

  const messages = readMessages(dataDir, roomId)
  assert.ok(messages.some((message) => message.text === '只记录，不派活'))
  assert.ok(messages.some((message) => message.kind === 'system'))
  assert.equal('messages' in JSON.parse(readFileSync(join(dataDir, 'rooms.json'), 'utf8')), false)
})

test('D1 分页：limit 取尾部，before 往前翻', async () => {
  const roomId = 'room_page'
  seedDb(dataDir, {
    version: 1,
    rooms: [roomOf(roomId)],
    messages: messagesOf(30, roomId),
    bots: []
  })

  const page1 = await api.api(`rooms/${roomId}/messages?limit=10`)
  assert.equal(page1.status, 200, page1.text)
  assert.equal(page1.data.messages.length, 10)
  assert.equal(page1.data.messages[0].id, 'msg_20')
  assert.equal(page1.data.messages.at(-1).id, 'msg_29')
  assert.equal(page1.data.hasMore, true)
  assert.equal(page1.data.total, 30)

  const page2 = await api.api(`rooms/${roomId}/messages?limit=10&before=msg_20`)
  assert.equal(page2.status, 200, page2.text)
  assert.deepEqual(
    page2.data.messages.map((message) => message.id),
    Array.from({ length: 10 }, (_, index) => `msg_${10 + index}`)
  )
  assert.equal(page2.data.hasMore, true)

  const missing = await api.api(`rooms/${roomId}/messages?limit=10&before=msg_不存在`)
  assert.equal(missing.status, 400)

  const all = await api.api(`rooms/${roomId}/messages`)
  assert.equal(all.data.messages.length, 30)
  assert.equal(all.data.hasMore, false)
})

test('D2 删房间会一并删掉消息文件', async () => {
  const roomId = 'room_delete'
  seedDb(dataDir, {
    version: 1,
    rooms: [roomOf(roomId)],
    messages: messagesOf(3, roomId),
    bots: []
  })
  await api.api(`rooms/${roomId}/messages`)
  assert.ok(existsSync(join(dataDir, 'rooms', roomId, 'messages.jsonl')))

  const removed = await api.api(`rooms/${roomId}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal(existsSync(join(dataDir, 'rooms', roomId, 'messages.jsonl')), false)
  assert.equal(readDb(dataDir).rooms.some((room) => room.id === roomId), false)
})
