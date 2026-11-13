/**
 * N2：DAG 执行。
 *
 * 计划里有 A → B 的依赖：先跑 A，B 的提示词里必须带上 A 的结论；环与缺失依赖要拒绝。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import { fakeCtx, makeDataDir, readMessages, seedDb, startApi } from './helpers/harness.mjs'

const dataDir = makeDataDir()
let api
let ctx
let prompts

const now = '2026-11-12T00:00:00.000Z'
const host = { botId: 'bot_host', name: '阿岚', role: 'host', avatar: '🧭', status: 'idle', tokensUsed: 0 }
const botA = { botId: 'bot_a', name: '老周', role: 'worker', avatar: '🛠', status: 'idle', tokensUsed: 0 }
const botB = { botId: 'bot_b', name: '小柯', role: 'worker', avatar: '📝', status: 'idle', tokensUsed: 0 }

function roomOf(id, items) {
  return {
    id,
    name: 'DAG 房',
    goal: '按依赖跑',
    acceptance: ['done'],
    status: 'created',
    mode: 'confirm',
    budget: { perRun: 100000, perBot: 100000, perRoom: 100000 },
    shared: '',
    tokensUsed: 0,
    members: [host, botA, botB],
    pendingPlan: {
      id: `plan_${id}`,
      hostBotId: host.botId,
      hostName: host.name,
      at: now,
      items
    },
    createdAt: now,
    updatedAt: now
  }
}

before(async () => {
  prompts = []
  ctx = fakeCtx({
    reply: ({ message }) => {
      const text = message.content[0].text
      prompts.push(text)
      return text.includes('任务 A') ? 'A 的结论：A 已完成' : 'B 的结论：B 已完成'
    }
  })
  api = await startApi(dataDir, ctx)
})

after(async () => {
  await api.close()
})

test('A → B：先 A 后 B，B 的上下文带上 A 的结论', async () => {
  const roomId = 'room_dag'
  seedDb(dataDir, {
    version: 1,
    rooms: [
      roomOf(roomId, [
        { id: 'item_a', botId: botA.botId, name: botA.name, task: '任务 A', files: [] },
        {
          id: 'item_b',
          botId: botB.botId,
          name: botB.name,
          task: '任务 B',
          files: [],
          dependsOn: ['item_a']
        }
      ])
    ],
    messages: [],
    bots: []
  })
  prompts.length = 0

  const res = await api.api(`rooms/${roomId}/plan`, {
    method: 'POST',
    body: JSON.stringify({ action: 'approve' })
  })
  assert.equal(res.status, 200, res.text)
  assert.equal(ctx.createdSessions.length, 2)

  const indexA = prompts.findIndex((text) => text.includes('任务 A'))
  const indexB = prompts.findIndex((text) => text.includes('任务 B'))
  assert.ok(indexA >= 0 && indexB >= 0)
  assert.ok(indexA < indexB, 'A 必须先于 B')
  assert.match(prompts[indexB], /A 的结论/)

  const cards = readMessages(dataDir, roomId).filter(
    (message) => message.kind === 'assignment' && message.payload?.status === 'done'
  )
  assert.equal(cards.length, 2)
})

test('批准时覆盖依赖：B 改成依赖 A 后仍然按顺序跑', async () => {
  const roomId = 'room_dag_override'
  seedDb(dataDir, {
    version: 1,
    rooms: [
      roomOf(roomId, [
        { id: 'item_a', botId: botA.botId, name: botA.name, task: '任务 A', files: [] },
        { id: 'item_b', botId: botB.botId, name: botB.name, task: '任务 B', files: [] }
      ])
    ],
    messages: [],
    bots: []
  })
  prompts.length = 0

  const before = ctx.createdSessions.length
  const res = await api.api(`rooms/${roomId}/plan`, {
    method: 'POST',
    body: JSON.stringify({
      action: 'approve',
      itemIds: ['item_a', 'item_b'],
      dependencies: { item_b: ['item_a'] }
    })
  })
  assert.equal(res.status, 200, res.text)
  assert.equal(ctx.createdSessions.length, before + 2)
  const indexB = prompts.findIndex((text) => text.includes('任务 B'))
  assert.match(prompts[indexB], /A 的结论/)
})

test('依赖成环/指向未批准任务都返回 400', async () => {
  const roomId = 'room_dag_bad'
  seedDb(dataDir, {
    version: 1,
    rooms: [
      roomOf(roomId, [
        { id: 'item_a', botId: botA.botId, name: botA.name, task: '任务 A', files: [] },
        { id: 'item_b', botId: botB.botId, name: botB.name, task: '任务 B', files: [] }
      ])
    ],
    messages: [],
    bots: []
  })

  const unknown = await api.api(`rooms/${roomId}/plan`, {
    method: 'POST',
    body: JSON.stringify({
      action: 'approve',
      itemIds: ['item_a'],
      dependencies: { item_a: ['item_ghost'] }
    })
  })
  assert.equal(unknown.status, 400)

  const cycle = await api.api(`rooms/${roomId}/plan`, {
    method: 'POST',
    body: JSON.stringify({
      action: 'approve',
      itemIds: ['item_a', 'item_b'],
      dependencies: { item_a: ['item_b'], item_b: ['item_a'] }
    })
  })
  assert.equal(cycle.status, 400)
  assert.match(cycle.data.error, /成环/)
})
