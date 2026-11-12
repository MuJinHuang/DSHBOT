/**
 * N1-E2 / E3：质量护栏。
 *
 * 验收谓词提醒与「数字必须给算式」都是纯函数/提示词层面的约束，适合钉死在单测里。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { acceptanceWarning } from '../packages/core/dist/index.js'
import { buildContext } from '../packages/plugin/lib/index.js'
import { makeDataDir } from './helpers/harness.mjs'

// buildContext 会读最近消息，指到临时目录，别碰真实数据
makeDataDir()

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
