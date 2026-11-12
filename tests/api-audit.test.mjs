/**
 * N1-D3：审计数据源。
 *
 * 导出仍是 JSONL（可喂脚本），界面用 `?format=json` 拿同一批记录。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import { fakeCtx, makeDataDir, seedDb, startApi } from './helpers/harness.mjs'

const dataDir = makeDataDir()
const roomId = 'room_audit'
let api

const room = {
  id: roomId,
  name: '审计房',
  goal: '留痕',
  acceptance: ['完成'],
  status: 'created',
  mode: 'confirm',
  budget: { perRun: 100000, perBot: 100000, perRoom: 100000 },
  shared: '',
  tokensUsed: 0,
  members: [
    { botId: 'bot_a', name: '甲', role: 'worker', avatar: '🅰️', status: 'idle', tokensUsed: 0 }
  ],
  createdAt: '2026-11-12T00:00:00.000Z',
  updatedAt: '2026-11-12T00:00:00.000Z'
}

const messages = [
  {
    id: 'msg_1',
    roomId,
    kind: 'human',
    from: 'human',
    text: '把这件事做了',
    createdAt: '2026-11-12T00:00:01.000Z'
  },
  {
    id: 'msg_2',
    roomId,
    kind: 'tool',
    from: 'bot_a',
    botId: 'bot_a',
    text: 'read {"path":"a.md"}',
    payload: { name: 'read', input: '{"path":"a.md"}', output: '第一行\n第二行' },
    createdAt: '2026-11-12T00:00:02.000Z'
  },
  {
    id: 'msg_3',
    roomId,
    kind: 'assignment',
    from: 'bot_a',
    botId: 'bot_a',
    text: '甲 → 乙：写文档',
    payload: { status: 'done', result: '写完了', planId: 'plan_1' },
    createdAt: '2026-11-12T00:00:03.000Z'
  }
]

before(async () => {
  seedDb(dataDir, { version: 1, rooms: [room], messages, bots: [] })
  api = await startApi(dataDir, fakeCtx())
  // 触发迁移，让消息落到 messages.jsonl
  await api.api(`rooms/${roomId}/messages`)
})

after(async () => {
  await api.close()
})

test('D3 审计 JSON：类型、工具参数与任务卡结论都在', async () => {
  const res = await api.api(`rooms/${roomId}/audit?format=json`)
  assert.equal(res.status, 200, res.text)
  assert.equal(res.data.records.length, 3)

  const tool = res.data.records.find((record) => record.kind === 'tool')
  assert.equal(tool.tool.name, 'read')
  assert.match(tool.tool.input, /a\.md/)
  assert.match(tool.tool.output, /第一行/)

  const card = res.data.records.find((record) => record.kind === 'assignment')
  assert.equal(card.card.status, 'done')
  assert.equal(card.card.result, '写完了')
})

test('D3 审计 JSONL：一行一条，可直接解析', async () => {
  const res = await fetch(`${api.base}/rooms/${roomId}/audit`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /ndjson/)
  const text = await res.text()
  const lines = text.trim().split('\n')
  assert.equal(lines.length, 3)
  const parsed = lines.map((line) => JSON.parse(line))
  assert.deepEqual(
    parsed.map((record) => record.kind),
    ['human', 'tool', 'assignment']
  )
})
