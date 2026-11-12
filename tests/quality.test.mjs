/**
 * N1-E2 / E3：质量护栏。
 *
 * 验收谓词提醒与「数字必须给算式」都是纯函数/提示词层面的约束，适合钉死在单测里。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { acceptanceWarning } from '../packages/core/dist/index.js'
import { buildContext } from '../packages/plugin/lib/index.js'
import { makeDataDir } from './helpers/harness.mjs'

// buildContext 会读最近消息，指到临时目录，别碰真实数据
const dataDir = makeDataDir()

test('E2 全是文字验收 → 给一句 file:/cmd: 的提醒', () => {
  const warning = acceptanceWarning(['文档写得清楚', '覆盖三个部分'])
  assert.ok(warning !== undefined)
  assert.match(warning, /file:/)
  assert.match(warning, /cmd:/)
})

test('E2 有一条 file: 或 cmd: 就不再提醒', () => {
  assert.equal(acceptanceWarning(['file:README.md', '文档写得清楚']), undefined)
  assert.equal(
    acceptanceWarning(['cmd:node -e "process.exit(0)"', '文档写得清楚']),
    undefined
  )
  assert.equal(acceptanceWarning([]), undefined)
})

function room() {
  return {
    id: 'room_prompt',
    name: '提示词房',
    goal: '验证提示词',
    acceptance: ['file:out.md'],
    status: 'created',
    mode: 'confirm',
    budget: { perRun: 1, perBot: 1, perRoom: 1 },
    shared: '',
    members: [],
    tokensUsed: 0,
    createdAt: '2026-11-12T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z'
  }
}

test('E3 执行者上下文要求给出算式与复算结果', () => {
  const text = buildContext(
    room(),
    { botId: 'bot_w', name: '老周', role: 'worker', avatar: '🛠', status: 'idle', tokensUsed: 0 },
    '算一下热阻'
  )
  assert.match(text, /算式/)
  assert.match(text, /复算/)
})

test('E3 总管上下文同样要求算式与复算', () => {
  const text = buildContext(
    room(),
    { botId: 'bot_h', name: '阿岚', role: 'host', avatar: '🧭', status: 'idle', tokensUsed: 0 },
    '拆一下任务'
  )
  assert.match(text, /算式/)
  assert.match(text, /复算/)
})

/** 造一屋子近况消息，专门挤上下文。 */
function seedMessages(roomId, count) {
  const dir = join(dataDir, 'rooms', roomId)
  mkdirSync(dir, { recursive: true })
  const lines = Array.from({ length: count }, (_, index) => ({
    id: `msg_ctx_${index}`,
    roomId,
    kind: 'system',
    from: 'system',
    text: `第 ${index} 条：` + '这是一段很长的房间近况。'.repeat(8),
    createdAt: `2026-11-12T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`
  }))
  writeFileSync(
    join(dir, 'messages.jsonl'),
    lines.map((line) => JSON.stringify(line)).join('\n') + '\n',
    'utf8'
  )
}

test('上下文预算：近况再多，任务也不能被截掉', () => {
  const roomId = 'room_ctx_many'
  seedMessages(roomId, 80)
  const text = buildContext(
    { ...room(), id: roomId },
    { botId: 'bot_w', name: '老周', role: 'worker', avatar: '🛠', status: 'idle', tokensUsed: 0 },
    '收尾任务：检查 docs/report.md 里的热阻换算，并给出复算'
  )
  assert.match(text, /【你的任务】/)
  assert.match(text, /收尾任务/)
  assert.ok(text.length <= 2400, `上下文超长：${text.length}`)
  assert.match(text, /第 79 条/, '最近一条动态应在')
})

test('上下文预算：超长任务保留开头并明确标注截断', () => {
  const roomId = 'room_ctx_long_task'
  seedMessages(roomId, 5)
  const task = '第一句很关键：必须产出报告。' + '补充说明'.repeat(600)
  const text = buildContext(
    { ...room(), id: roomId },
    { botId: 'bot_w', name: '老周', role: 'worker', avatar: '🛠', status: 'idle', tokensUsed: 0 },
    task
  )
  assert.match(text, /第一句很关键/)
  assert.match(text, /任务过长，已截断/)
  assert.ok(text.length <= 2400, `上下文超长：${text.length}`)
})

test('上下文预算：没有消息时仍有占位，不是空块', () => {
  const text = buildContext(
    { ...room(), id: 'room_ctx_empty' },
    { botId: 'bot_w', name: '老周', role: 'worker', avatar: '🛠', status: 'idle', tokensUsed: 0 },
    '做一件事'
  )
  assert.match(text, /还没有对话/)
  assert.match(text, /做一件事/)
})
