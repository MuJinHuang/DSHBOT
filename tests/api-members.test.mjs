/**
 * N1-A：房间内可运维。
 *
 * 走真正的 HTTP 处理器（不是直接调函数），所以路由、校验、落盘都在覆盖范围内。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import { fakeCtx, makeDataDir, readDb, readMessages, seedDb, startApi } from './helpers/harness.mjs'

const NOW = '2026-11-12T00:00:00.000Z'
const dataDir = makeDataDir()
const options = {}
let api
let ctx

before(async () => {
  ctx = fakeCtx(options)
  api = await startApi(dataDir, ctx)
})

after(async () => {
  await api.close()
})

async function newRoom(extra = {}) {
  const res = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({ name: '测试房', goal: '把事做完', acceptance: ['产物在'], ...extra })
  })
  assert.equal(res.status, 201, res.text)
  return res.data.room
}

test('A1 成员编辑：名字/岗位/专长/输出/工具集都能改', async () => {
  const room = await newRoom()
  const added = await api.api(`rooms/${room.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ name: '小写', role: 'worker', persona: '旧岗位', expertise: '旧专长' })
  })
  assert.equal(added.status, 201, added.text)
  const botId = added.data.member.botId

  const patched = await api.api(`rooms/${room.id}/members/${botId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: '写手',
      role: 'host',
      avatar: '✍️',
      persona: '负责把需求写成文档',
      expertise: '技术写作',
      instructions: '先结论后细节',
      agentPreset: 'minimal'
    })
  })
  assert.equal(patched.status, 200, patched.text)
  assert.equal(patched.data.member.name, '写手')
  assert.equal(patched.data.member.role, 'host')
  assert.equal(patched.data.member.avatar, '✍️')
  assert.equal(patched.data.member.expertise, '技术写作')
  assert.equal(patched.data.member.agentPreset, 'minimal')

  // 落盘了：重新 GET 也是新的
  const fresh = await api.api(`rooms/${room.id}`)
  const member = fresh.data.room.members.find((m) => m.botId === botId)
  assert.equal(member.name, '写手')
  assert.equal(fresh.data.room.hostBotId, botId)

  const emptyName = await api.api(`rooms/${room.id}/members/${botId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: '  ' })
  })
  assert.equal(emptyName.status, 400)

  const badRole = await api.api(`rooms/${room.id}/members/${botId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: 'boss' })
  })
  assert.equal(badRole.status, 400)
})

test('A1 成员重名会被拒绝（409），不会悄悄出现两个同名', async () => {
  const room = await newRoom()
  const first = await api.api(`rooms/${room.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ name: '甲' })
  })
  const second = await api.api(`rooms/${room.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ name: '乙' })
  })
  assert.equal(first.status, 201)
  assert.equal(second.status, 201)

  const conflict = await api.api(`rooms/${room.id}/members/${first.data.member.botId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: '乙' })
  })
  assert.equal(conflict.status, 409)
})

test('新房默认是空房间；没有 Bot 时发消息只给引导', async () => {
  const room = await newRoom()
  assert.deepEqual(room.members, [], '建房不应该再自动塞默认成员')

  const said = await api.api(`rooms/${room.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: '开始吧' })
  })
  assert.equal(said.status, 200, said.text)
  assert.equal(said.data.skipped, true)
  assert.match(said.data.messages.at(-1).text, /还没有 Bot/)
})

test('A2 成员移除后 @ 不到它', async () => {
  const room = await newRoom()
  const added = await api.api(`rooms/${room.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ name: '临时工' })
  })
  const botId = added.data.member.botId

  const removed = await api.api(`rooms/${room.id}/members/${botId}`, { method: 'DELETE' })
  assert.equal(removed.status, 200, removed.text)
  assert.equal(removed.data.room.members.some((m) => m.botId === botId), false)

  const said = await api.api(`rooms/${room.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: '@临时工 在吗' })
  })
  assert.equal(said.status, 200, said.text)
  assert.equal(said.data.skipped, true)
  assert.match(said.data.messages.at(-1).text, /没有「临时工」/)
})

function planRoom(id) {
  return {
    id,
    name: '计划房',
    goal: '跑两件事',
    acceptance: ['跑完'],
    status: 'created',
    mode: 'confirm',
    budget: { perRun: 100000, perBot: 100000, perRoom: 100000 },
    shared: '',
    tokensUsed: 0,
    members: [
      { botId: 'bot_host', name: '总管', role: 'host', avatar: '🧑‍💼', status: 'idle', tokensUsed: 0 },
      { botId: 'bot_a', name: '阿', role: 'worker', avatar: '🅰️', status: 'idle', tokensUsed: 0 },
      { botId: 'bot_b', name: '乙', role: 'worker', avatar: '🅱️', status: 'idle', tokensUsed: 0 }
    ],
    pendingPlan: {
      id: 'plan_1',
      hostBotId: 'bot_host',
      hostName: '总管',
      at: NOW,
      items: [
        { id: 'item_a', botId: 'bot_a', name: '阿', task: '做 A', files: [] },
        { id: 'item_b', botId: 'bot_b', name: '乙', task: '做 B', files: [] }
      ]
    },
    createdAt: NOW,
    updatedAt: NOW
  }
}

function planMessages(roomId) {
  const card = (id, botId, name, task, itemId) => ({
    id,
    roomId,
    kind: 'assignment',
    from: 'bot_host',
    botId,
    text: `总管 → ${name}：${task}`,
    payload: { planId: 'plan_1', itemId, status: 'pending', title: task, to: name },
    createdAt: NOW
  })
  return [
    card('msg_card_a', 'bot_a', '阿', '做 A', 'item_a'),
    card('msg_card_b', 'bot_b', '乙', '做 B', 'item_b')
  ]
}

test('E2 建房：全是文字验收返回 warning，不是错误', async () => {
  const textOnly = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({ name: '文字验收房', goal: 'g', acceptance: ['写得好', '覆盖全'] })
  })
  assert.equal(textOnly.status, 201, textOnly.text)
  assert.match(textOnly.data.warning, /file:/)

  const machine = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: '机器验收房',
      goal: 'g',
      acceptance: ['file:README.md', '写得好']
    })
  })
  assert.equal(machine.status, 201, machine.text)
  assert.equal(machine.data.warning, undefined)
})

test('房间设置：预算与执行模式可改，非法值拒绝', async () => {
  const room = await newRoom()
  const patched = await api.api(`rooms/${room.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ budget: { perRun: 123_456 }, mode: 'auto' })
  })
  assert.equal(patched.status, 200, patched.text)
  assert.equal(patched.data.room.budget.perRun, 123_456)
  // 没传的两项保持不变
  assert.equal(patched.data.room.budget.perBot, room.budget.perBot)
  assert.equal(patched.data.room.budget.perRoom, room.budget.perRoom)
  assert.equal(patched.data.room.mode, 'auto')

  const badBudget = await api.api(`rooms/${room.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ budget: { perRun: -1 } })
  })
  assert.equal(badBudget.status, 400)

  const badMode = await api.api(`rooms/${room.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ mode: 'sometimes' })
  })
  assert.equal(badMode.status, 400)

  const createdAuto = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({ name: '自动房', goal: 'g', acceptance: ['file:x.md'], mode: 'auto' })
  })
  assert.equal(createdAuto.status, 201)
  assert.equal(createdAuto.data.room.mode, 'auto')
})

test('A3 部分批准：只跑选中的，其余卡片标 skipped', async () => {
  const roomId = 'room_plan_partial'
  seedDb(dataDir, {
    version: 1,
    rooms: [planRoom(roomId)],
    messages: planMessages(roomId),
    bots: []
  })
  options.failCreate = true
  const beforeCount = ctx.createdSessions.length
  try {
    const res = await api.api(`rooms/${roomId}/plan`, {
      method: 'POST',
      body: JSON.stringify({ action: 'approve', itemIds: ['item_a'] })
    })
    assert.equal(res.status, 200, res.text)
    assert.equal(ctx.createdSessions.length - beforeCount, 1, '只应该起 1 个会话')

    const db = readDb(dataDir)
    const room = db.rooms.find((r) => r.id === roomId)
    assert.equal(room.pendingPlan, undefined)
    assert.equal(room.status, 'created')

    const messages = readMessages(dataDir, roomId)
    const cards = messages.filter((m) => m.payload?.planId === 'plan_1')
    assert.equal(cards.find((m) => m.payload.itemId === 'item_a').payload.status, 'running')
    assert.equal(cards.find((m) => m.payload.itemId === 'item_b').payload.status, 'skipped')

    assert.ok(
      messages.some((m) => m.text.includes('1 件事开始执行，1 件先跳过')),
      '批准留痕要写清选了几件、跳了几件'
    )
  } finally {
    options.failCreate = false
  }
})

test('A3 给不存在的 itemId 返回 400，计划还在', async () => {
  const roomId = 'room_plan_invalid'
  seedDb(dataDir, {
    version: 1,
    rooms: [planRoom(roomId)],
    messages: planMessages(roomId),
    bots: []
  })
  const res = await api.api(`rooms/${roomId}/plan`, {
    method: 'POST',
    body: JSON.stringify({ action: 'approve', itemIds: ['item_不存在'] })
  })
  assert.equal(res.status, 400)
  const db = readDb(dataDir)
  assert.ok(db.rooms.find((r) => r.id === roomId).pendingPlan !== undefined, '计划不该被清掉')
})

test('A3 一件都不选返回 400（想全不做请否决）', async () => {
  const roomId = 'room_plan_empty'
  seedDb(dataDir, {
    version: 1,
    rooms: [planRoom(roomId)],
    messages: planMessages(roomId),
    bots: []
  })
  const res = await api.api(`rooms/${roomId}/plan`, {
    method: 'POST',
    body: JSON.stringify({ action: 'approve', itemIds: [] })
  })
  assert.equal(res.status, 400)
  assert.match(res.data.error, /否决/)
})
