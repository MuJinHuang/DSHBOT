/**
 * 导出 Markdown 的单测。
 *
 * 导出是给人拿去交差的，格式坏了比不导出更糟，所以固定住结构。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildMarkdown } from '../packages/core/dist/index.js'

const room = {
  id: 'room_x',
  name: '示例房间',
  goal: '写一份摘要',
  acceptance: ['提到 A', '不超过 100 字'],
  status: 'created',
  mode: 'confirm',
  budget: { perRun: 1, perBot: 1, perRoom: 1 },
  shared: '',
  tokensUsed: 100,
  members: [
    { botId: 'bot_default', name: '小柯', role: 'worker', avatar: '🤖', status: 'idle', tokensUsed: 1200 },
    { botId: 'bot_host', name: '阿岚', role: 'host', avatar: '🤖', status: 'idle', tokensUsed: 0 }
  ],
  createdAt: '',
  updatedAt: ''
}

const messages = [
  { id: 'm1', roomId: 'room_x', kind: 'human', from: 'human', text: '谁来写？', createdAt: '' },
  {
    id: 'm2',
    roomId: 'room_x',
    kind: 'bot',
    from: 'bot_default',
    botId: 'bot_default',
    text: '好的\n我这就写',
    createdAt: ''
  },
  {
    id: 'm3',
    roomId: 'room_x',
    kind: 'tool',
    from: 'bot_default',
    text: 'read README.md',
    createdAt: ''
  }
]

test('导出包含标题、目标、验收标准', () => {
  const md = buildMarkdown(room, messages, new Date('2026-11-10T00:00:00Z'))
  assert.ok(md.startsWith('# 示例房间'))
  assert.ok(md.includes('> 写一份摘要'))
  assert.ok(md.includes('1. 提到 A'))
  assert.ok(md.includes('2. 不超过 100 字'))
})

test('导出跳过工具消息，保留人话', () => {
  const md = buildMarkdown(room, messages, new Date('2026-11-10T00:00:00Z'))
  assert.ok(!md.includes('read README.md'), '工具行不该出现')
  assert.ok(md.includes('**我**：谁来写？'))
  assert.ok(md.includes('**小柯**：好的  我这就写'))
})

test('导出成员时标出总管与花费', () => {
  const md = buildMarkdown(room, messages, new Date('2026-11-10T00:00:00Z'))
  assert.ok(md.includes('小柯（执行）· 已用 1.2k'))
  assert.ok(md.includes('阿岚（总管）'))
})

test('有交付时写出逐条判定', () => {
  const withDelivery = {
    ...room,
    delivery: {
      at: '2026-11-10T00:00:00.000Z',
      checks: [
        { point: '提到 A', verdict: 'pass', reason: '正文有' },
        { point: '不超过 100 字', verdict: 'fail', reason: '实际 200 字' }
      ],
      changedFiles: ['README.md'],
      tokensUsed: 12345,
      summary: '验收点 1/2 通过'
    }
  }
  const md = buildMarkdown(withDelivery, messages, new Date('2026-11-10T00:00:00Z'))
  assert.ok(md.includes('## 交付结论'))
  assert.ok(md.includes('1/2 通过'))
  assert.ok(md.includes('### ✅ 提到 A'))
  assert.ok(md.includes('### ❌ 不超过 100 字'))
  assert.ok(md.includes('README.md'))
  assert.ok(md.includes('12.3k'))
})

test('没有交付时不出现交付章节', () => {
  const md = buildMarkdown(room, messages, new Date('2026-11-10T00:00:00Z'))
  assert.ok(!md.includes('## 交付结论'))
})
