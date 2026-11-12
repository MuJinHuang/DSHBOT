/**
 * N1-C：可复用。
 *
 * Bot 卡导出/导入、团队模板、房间另存为——三样东西都走 HTTP，断言落盘结果。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'

import { fakeCtx, makeDataDir, startApi } from './helpers/harness.mjs'

const dataDir = makeDataDir()
let api
let botA
let botB

before(async () => {
  api = await startApi(dataDir, fakeCtx())
  const first = await api.api('bots', {
    method: 'POST',
    body: JSON.stringify({
      name: '硬件工程师',
      avatar: '🔌',
      persona: '做过十年电源设计',
      expertise: '电源与热设计',
      instructions: '先给结论，再列风险',
      agentPreset: 'standard'
    })
  })
  assert.equal(first.status, 201, first.text)
  botA = first.data.bot

  const second = await api.api('bots', {
    method: 'POST',
    body: JSON.stringify({ name: '文档编辑', persona: '把技术材料写成给人看的说明' })
  })
  assert.equal(second.status, 201, second.text)
  botB = second.data.bot
})

after(async () => {
  await api.close()
})

test('C1 导出角色卡：带 format/version，字段齐全', async () => {
  const res = await api.api(`bots/${botA.id}/export`)
  assert.equal(res.status, 200, res.text)
  assert.equal(res.data.format, 'dshbot.bot')
  assert.equal(res.data.version, 1)
  assert.equal(res.data.bot.name, '硬件工程师')
  assert.equal(res.data.bot.avatar, '🔌')
  assert.equal(res.data.bot.expertise, '电源与热设计')
  assert.equal(res.data.bot.agentPreset, 'standard')
  assert.equal(res.data.bot.id, undefined, '导出不带库内 id，导入时重新生成')

  const missing = await api.api('bots/bot_不存在/export')
  assert.equal(missing.status, 404)
})

test('C1 导入同一份 JSON：生成新 id，字段一致', async () => {
  const exported = await api.api(`bots/${botA.id}/export`)
  const imported = await api.api('bots/import', {
    method: 'POST',
    body: JSON.stringify(exported.data)
  })
  assert.equal(imported.status, 201, imported.text)
  assert.notEqual(imported.data.bot.id, botA.id)
  assert.equal(imported.data.bot.name, '硬件工程师')
  assert.equal(imported.data.bot.persona, '做过十年电源设计')
  assert.equal(imported.data.bot.instructions, '先给结论，再列风险')

  const list = await api.api('bots')
  assert.ok(list.data.bots.some((bot) => bot.id === imported.data.bot.id))
})

test('C1 导入坏数据：缺 name / 不认识 format 都拒绝', async () => {
  const noName = await api.api('bots/import', {
    method: 'POST',
    body: JSON.stringify({ format: 'dshbot.bot', version: 1, bot: { avatar: '🤖' } })
  })
  assert.equal(noName.status, 400)

  const badFormat = await api.api('bots/import', {
    method: 'POST',
    body: JSON.stringify({ format: 'other', bot: { name: '某人' } })
  })
  assert.equal(badFormat.status, 400)
})

test('C2 团队模板：存下来，建房时一键拉入', async () => {
  const created = await api.api('bots/teams', {
    method: 'POST',
    body: JSON.stringify({ name: '硬件小分队', botIds: [botA.id, botB.id] })
  })
  assert.equal(created.status, 201, created.text)
  assert.equal(created.data.team.botIds.length, 2)

  const teams = await api.api('bots/teams')
  assert.equal(teams.status, 200)
  assert.ok(teams.data.teams.some((team) => team.id === created.data.team.id))

  const room = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: '团队房',
      goal: '用模板拉人',
      acceptance: ['有产物'],
      teamId: created.data.team.id
    })
  })
  assert.equal(room.status, 201, room.text)
  assert.deepEqual(
    room.data.room.members.map((member) => member.name).sort(),
    ['文档编辑', '硬件工程师'].sort()
  )
  assert.ok(room.data.room.members.every((member) => member.defId !== undefined))

  const missing = await api.api('bots/teams', {
    method: 'POST',
    body: JSON.stringify({ name: '空团队', botIds: [] })
  })
  assert.equal(missing.status, 400)

  const ghost = await api.api('bots/teams', {
    method: 'POST',
    body: JSON.stringify({ name: '幽灵团队', botIds: ['bot_不存在'] })
  })
  assert.equal(ghost.status, 404)

  const badRoom = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', goal: 'y', acceptance: ['z'], teamId: 'team_不存在' })
  })
  assert.equal(badRoom.status, 400)

  const removed = await api.api(`bots/teams/${created.data.team.id}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  const after = await api.api('bots/teams')
  assert.equal(after.data.teams.some((team) => team.id === created.data.team.id), false)
})

test('C3 房间另存为：复制目标/验收/成员，不带消息与会话', async () => {
  const created = await api.api('bots/teams', {
    method: 'POST',
    body: JSON.stringify({ name: '复制用团队', botIds: [botA.id] })
  })
  const source = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: '原始房',
      goal: '把这件事做完',
      acceptance: ['file:out.md', 'cmd:node -e "process.exit(0)"'],
      teamId: created.data.team.id
    })
  })
  assert.equal(source.status, 201, source.text)
  const roomId = source.data.room.id

  // 房间里留一条系统消息，证明克隆不带消息
  const said = await api.api(`rooms/${roomId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text: '随便说一句' })
  })
  assert.equal(said.status, 200)

  const cloned = await api.api(`rooms/${roomId}/clone`, { method: 'POST', body: '{}' })
  assert.equal(cloned.status, 201, cloned.text)
  const copy = cloned.data.room
  assert.notEqual(copy.id, roomId)
  assert.equal(copy.name, '原始房 副本')
  assert.equal(copy.goal, '把这件事做完')
  assert.deepEqual(copy.acceptance, ['file:out.md', 'cmd:node -e "process.exit(0)"'])
  assert.equal(copy.members.length, 1)
  assert.equal(copy.members[0].name, '硬件工程师')
  assert.equal(copy.members[0].sessionId, undefined)
  assert.equal(copy.members[0].tokensUsed, 0)
  assert.equal(copy.tokensUsed, 0)
  assert.notEqual(copy.workspaceDir, source.data.room.workspaceDir)

  const messages = await api.api(`rooms/${copy.id}/messages`)
  assert.equal(messages.status, 200)
  assert.deepEqual(messages.data.messages, [], '克隆房间不该带旧消息')
})
