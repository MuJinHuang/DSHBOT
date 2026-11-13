/**
 * N2：每 Bot 模型选择。
 *
 * 数据/API/运行链路都覆盖：库里的卡带 model、拉进房间复制、开跑前调 selectModel。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import { fakeCtx, makeDataDir, startApi } from './helpers/harness.mjs'

const dataDir = makeDataDir()
let api
let ctx

before(async () => {
  ctx = fakeCtx({ reply: '收到。' })
  api = await startApi(dataDir, ctx)
})

after(async () => {
  await api.close()
})

test('/models 返回当前部署的模型目录', async () => {
  const res = await api.api('models')
  assert.equal(res.status, 200, res.text)
  assert.equal(res.data.catalog.groups[0].id, 'mock')
  assert.equal(res.data.catalog.groups[0].models[0].id, 'mock-1')
  assert.equal(res.data.catalog.groups[0].models[0].reasoning.efforts[0].id, 'high')
})

test('Bot 卡带模型：创建、导出、导入都保留（含推理强度）', async () => {
  const model = { provider: 'mock', model: 'mock-1', reasoningEffort: 'high' }
  const created = await api.api('bots', {
    method: 'POST',
    body: JSON.stringify({
      name: '模型测试员',
      persona: '测试',
      model
    })
  })
  assert.equal(created.status, 201, created.text)
  assert.deepEqual(created.data.bot.model, model)

  const exported = await api.api(`bots/${created.data.bot.id}/export`)
  assert.equal(exported.status, 200)
  assert.deepEqual(exported.data.bot.model, model)

  const imported = await api.api('bots/import', {
    method: 'POST',
    body: JSON.stringify(exported.data)
  })
  assert.equal(imported.status, 201, imported.text)
  assert.deepEqual(imported.data.bot.model, model)
})

test('拉人时复制模型，房间内可以改/清空', async () => {
  const bot = await api.api('bots', {
    method: 'POST',
    body: JSON.stringify({ name: '带模型', model: { provider: 'mock', model: 'mock-1' } })
  })
  const room = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({ name: '模型房', goal: 'g', acceptance: ['file:x.md'] })
  })
  const added = await api.api(`rooms/${room.data.room.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ defId: bot.data.bot.id })
  })
  assert.equal(added.status, 201, added.text)
  assert.deepEqual(added.data.member.model, { provider: 'mock', model: 'mock-1' })

  const patched = await api.api(`rooms/${room.data.room.id}/members/${added.data.member.botId}`, {
    method: 'PATCH',
    body: JSON.stringify({ model: { provider: 'mock', model: 'mock-1' } })
  })
  assert.equal(patched.status, 200, patched.text)
  assert.deepEqual(patched.data.member.model, { provider: 'mock', model: 'mock-1' })

  const cleared = await api.api(`rooms/${room.data.room.id}/members/${added.data.member.botId}`, {
    method: 'PATCH',
    body: JSON.stringify({ model: null })
  })
  assert.equal(cleared.status, 200)
  assert.equal(cleared.data.member.model, undefined)
})

test('开跑前把 Bot 的模型装到会话上', async () => {
  const bot = await api.api('bots', {
    method: 'POST',
    body: JSON.stringify({
      name: '模型执行者',
      model: { provider: 'mock', model: 'mock-1', reasoningEffort: 'high' }
    })
  })
  const room = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({ name: '跑模型房', goal: 'g', acceptance: ['file:x.md'] })
  })
  await api.api(`rooms/${room.data.room.id}/members`, {
    method: 'POST',
    body: JSON.stringify({ defId: bot.data.bot.id })
  })

  const before = ctx.modelSelections.length
  const said = await api.api(`rooms/${room.data.room.id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: '跑一下' })
  })
  assert.equal(said.status, 200, said.text)
  assert.equal(ctx.modelSelections.length, before + 1)
  const request = ctx.modelSelections.at(-1)
  assert.equal(request.provider, 'mock')
  assert.equal(request.model, 'mock-1')
  assert.equal(request.reasoningEffort, 'high')
  assert.ok(typeof request.sessionId === 'string' && request.sessionId !== '')
})

test('非法模型结构返回 400', async () => {
  const bad = await api.api('bots', {
    method: 'POST',
    body: JSON.stringify({ name: '坏模型', model: { provider: 'mock' } })
  })
  assert.equal(bad.status, 400)

  const bot = await api.api('bots', {
    method: 'POST',
    body: JSON.stringify({ name: '正常模型' })
  })
  const badPatch = await api.api(`bots/${bot.data.bot.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ model: 'mock-1' })
  })
  assert.equal(badPatch.status, 400)

  const unavailable = await api.api(`bots/${bot.data.bot.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ model: { provider: 'mock', model: 'ghost' } })
  })
  assert.equal(unavailable.status, 400)
  assert.match(unavailable.data.error, /不在当前目录/)

  const badEffort = await api.api(`bots/${bot.data.bot.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      model: { provider: 'mock', model: 'mock-1', reasoningEffort: 'extreme' }
    })
  })
  assert.equal(badEffort.status, 400)
  assert.match(badEffort.data.error, /不支持推理强度/)
})
