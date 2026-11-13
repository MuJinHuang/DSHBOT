/**
 * P1：搜索 API 走真实 HTTP 处理器，搜的是全部历史，不是当前分页。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import { fakeCtx, makeDataDir, seedDb, startApi } from './helpers/harness.mjs'

const dataDir = makeDataDir()
const roomId = 'room_search_api'
let api

const now = '2026-11-12T00:00:00.000Z'
const room = {
  id: roomId,
  name: '搜索房',
  goal: '搜索',
  acceptance: ['file:x.md'],
  status: 'created',
  mode: 'confirm',
  budget: { perRun: 100000, perBot: 100000, perRoom: 100000 },
  shared: '',
  tokensUsed: 0,
  members: [{ botId: 'bot_a', name: '老周', role: 'worker', avatar: '🛠', status: 'idle', tokensUsed: 0 }],
  createdAt: now,
  updatedAt: now
}

const messages = [
  {
    id: 'msg_1',
    roomId,
    kind: 'human',
    from: 'human',
    text: '请检查 Thermal 设计',
    createdAt: '2026-11-12T00:00:01.000Z'
  },
  {
    id: 'msg_2',
    roomId,
    kind: 'bot',
    from: 'bot_a',
    botId: 'bot_a',
    text: '热设计结论：需要增加散热片。',
    createdAt: '2026-11-12T00:00:02.000Z'
  },
  {
    id: 'msg_3',
    roomId,
    kind: 'system',
    from: 'system',
    text: '验收通过',
    createdAt: '2026-11-12T00:00:03.000Z'
  }
]

before(async () => {
  seedDb(dataDir, { version: 1, rooms: [room], messages, bots: [] })
  api = await startApi(dataDir, fakeCtx())
})

after(async () => {
  await api.close()
})

test('搜索 API：返回匹配片段与发送者信息', async () => {
  const res = await api.api(`rooms/${roomId}/search?q=${encodeURIComponent('thermal')}`)
  assert.equal(res.status, 200, res.text)
  assert.equal(res.data.query, 'thermal')
  assert.equal(res.data.count, 1)
  assert.equal(res.data.results[0].id, 'msg_1')
  assert.match(res.data.results[0].snippet, /Thermal/)
})

test('搜索 API：中文也能搜，按时间倒序', async () => {
  const res = await api.api(`rooms/${roomId}/search?q=${encodeURIComponent('设计')}`)
  assert.equal(res.status, 200, res.text)
  assert.equal(res.data.count, 2)
  assert.deepEqual(
    res.data.results.map((item) => item.id),
    ['msg_2', 'msg_1']
  )
})

test('搜索 API：空关键词 400，limit 生效', async () => {
  const empty = await api.api(`rooms/${roomId}/search?q=`)
  assert.equal(empty.status, 400)

  const limited = await api.api(`rooms/${roomId}/search?q=${encodeURIComponent('设计')}&limit=1`)
  assert.equal(limited.status, 200)
  assert.equal(limited.data.results.length, 1)
})
