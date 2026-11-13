/**
 * P1：房间消息搜索的纯函数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { searchMessages } from '../packages/core/dist/index.js'

function message(id, text, createdAt, extra = {}) {
  return {
    id,
    roomId: 'room_search',
    kind: 'system',
    from: 'system',
    text,
    createdAt,
    ...extra
  }
}

test('搜索：大小写不敏感，返回关键片段', () => {
  const messages = [
    message('m1', '前面一大段话，然后是 Thermal 计算，后面还有内容'.repeat(3), '2026-11-12T00:00:01.000Z'),
    message('m2', '完全无关的一条', '2026-11-12T00:00:02.000Z')
  ]
  const results = searchMessages(messages, 'thermal')
  assert.equal(results.length, 1)
  assert.ok(results[0].snippet.includes('Thermal'))
  assert.ok(results[0].snippet.length < 200)
})

test('搜索：按时间从新到旧，limit 生效', () => {
  const messages = [
    message('m1', '关键词', '2026-11-12T00:00:01.000Z'),
    message('m2', '关键词', '2026-11-12T00:00:02.000Z'),
    message('m3', '关键词', '2026-11-12T00:00:03.000Z')
  ]
  const results = searchMessages(messages, '关键词', 2)
  assert.deepEqual(
    results.map((item) => item.id),
    ['m3', 'm2']
  )
})

test('搜索：空关键词返回空，前后空白会被裁掉', () => {
  const messages = [message('m1', '内容', '2026-11-12T00:00:00.000Z')]
  assert.deepEqual(searchMessages(messages, '   '), [])
  assert.equal(searchMessages(messages, ' 内容 ').length, 1)
})

test('搜索：长文本两侧带省略号，换行被压平', () => {
  const text = '开头'.repeat(80) + '\n\n目标词\n\n' + '结尾'.repeat(80)
  const results = searchMessages([message('m1', text, '2026-11-12T00:00:00.000Z')], '目标词')
  assert.equal(results.length, 1)
  assert.ok(results[0].snippet.startsWith('…'))
  assert.ok(results[0].snippet.endsWith('…'))
  assert.equal(results[0].snippet.includes('\n'), false)
})
