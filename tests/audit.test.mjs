/**
 * 审计导出的单测。
 *
 * JSONL 的硬要求：一行必须是一个能解析的 JSON，不能被消息里的换行搞坏。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { auditRecords, toJsonl } from '../packages/core/dist/index.js'

const msg = (over) => ({
  id: 'm',
  roomId: 'room_x',
  kind: 'human',
  from: 'human',
  text: '',
  createdAt: '2026-11-12T00:00:00.000Z',
  ...over
})

test('每行都是合法 JSON，且条数对得上', () => {
  const messages = [
    msg({ text: '第一行\n第二行' }),
    msg({ kind: 'bot', from: 'bot_default', botId: 'bot_default', text: '收到' })
  ]
  const jsonl = toJsonl(auditRecords(messages))
  const lines = jsonl.trim().split('\n')
  assert.equal(lines.length, 2)
  for (const line of lines) {
    assert.doesNotThrow(() => JSON.parse(line))
  }
})

test('消息里的换行被转义，不会多出一行', () => {
  const jsonl = toJsonl(auditRecords([msg({ text: 'a\nb\nc' })]))
  assert.equal(jsonl.trim().split('\n').length, 1)
  assert.equal(JSON.parse(jsonl).text, 'a\\nb\\nc')
})

test('工具消息带 name / input / output', () => {
  const record = auditRecords([
    msg({
      kind: 'tool',
      from: 'bot_default',
      botId: 'bot_default',
      text: 'read README.md',
      payload: { name: 'read', input: '{"path":"README.md"}', output: '内容' }
    })
  ])[0]
  assert.equal(record.tool.name, 'read')
  assert.ok(record.tool.input.includes('README.md'))
  assert.equal(record.tool.output, '内容')
})

test('工具输出过长会截断', () => {
  const record = auditRecords([
    msg({ kind: 'tool', payload: { name: 'pwsh', input: '{}', output: 'x'.repeat(9000) } })
  ])[0]
  assert.ok(record.tool.output.length < 4200)
  assert.ok(record.tool.output.endsWith('（截断）'))
})

test('任务卡带状态与结论', () => {
  const record = auditRecords([
    msg({
      kind: 'assignment',
      from: 'bot_host',
      botId: 'bot_worker',
      text: '阿岚 → 小柯：写摘要',
      payload: { status: 'done', result: '已交付', planId: 'plan_x' }
    })
  ])[0]
  assert.equal(record.card.status, 'done')
  assert.equal(record.card.result, '已交付')
  assert.equal(record.card.planId, 'plan_x')
})

test('from 用 botId，能区分是谁干的', () => {
  const record = auditRecords([
    msg({ kind: 'bot', from: 'bot_default', botId: 'bot_default', text: 'x' })
  ])[0]
  assert.equal(record.from, 'bot_default')
})

test('空数组导出空字符串', () => {
  assert.equal(toJsonl([]), '')
})
