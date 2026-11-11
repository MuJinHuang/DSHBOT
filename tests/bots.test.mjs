/**
 * 角色卡拆分的单测。
 *
 * 用户会直接粘贴一大段话，拆错了就等于给 Bot 洗错了脑。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { makeBot, splitPersona } from '../packages/core/dist/index.js'

test('带标签的整段：身份 / 专长 / 输出规范', () => {
  const split = splitPersona(
    ['身份：资深硬件工程师，做过十年电源设计。', '专长：电源与热设计', '输出规范：先给结论，再列风险'].join(
      '\n'
    )
  )
  assert.equal(split.persona, '资深硬件工程师，做过十年电源设计。')
  assert.equal(split.expertise, '电源与热设计')
  assert.equal(split.instructions, '先给结论，再列风险')
})

test('Markdown 小标题也能认', () => {
  const split = splitPersona(['## 岗位', '负责嵌入式固件。', '## 输出要求', '使用 GFM 表格。'].join('\n'))
  assert.ok(split.persona.includes('嵌入式固件'))
  assert.ok(split.instructions.includes('GFM'))
})

test('没有标签时整段当岗位描述，首句当专长', () => {
  const split = splitPersona('我是文档编辑，擅长把技术材料写成给非技术读者的说明。做事讲结构。')
  assert.ok(split.persona.startsWith('我是文档编辑'))
  assert.ok(split.expertise.startsWith('我是文档编辑'))
  assert.ok(split.expertise.length <= 41)
  assert.equal(split.instructions, '')
})

test('正文里出现"身份验证"不算标签', () => {
  const split = splitPersona('身份验证模块要重点检查，这是最容易出问题的地方。')
  assert.ok(split.persona.includes('身份验证模块'))
  assert.equal(split.expertise.startsWith('身份验证模块'), true)
})

test('专长超过 40 字会截断', () => {
  const long = '很'.repeat(60)
  const split = splitPersona(`专长：${long}`)
  assert.ok(split.expertise.length <= 41)
  assert.ok(split.expertise.endsWith('…'))
})

test('空文本不炸', () => {
  const split = splitPersona('')
  assert.deepEqual(split, { persona: '', expertise: '', instructions: '' })
})

test('makeBot 带默认头像与时间戳', () => {
  const bot = makeBot({ name: '老周' })
  assert.equal(bot.avatar, '🤖')
  assert.ok(bot.id.startsWith('bot_'))
  assert.ok(bot.createdAt.length > 0)
})

test('makeBot 不塞空字段', () => {
  const bot = makeBot({ name: '老周', persona: '硬件工程师' })
  assert.equal(bot.persona, '硬件工程师')
  assert.equal('instructions' in bot, false)
})
