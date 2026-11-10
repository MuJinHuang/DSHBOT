/**
 * Markdown 块解析的单测。
 *
 * Bot 回复要能正确显示代码块、列表、标题，解析错了界面就是一坨原文。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseBlocks, parseInline } from '../packages/core/dist/index.js'

test('普通段落', () => {
  const blocks = parseBlocks('第一行\n第二行')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].kind, 'para')
  assert.equal(blocks[0].text, '第一行\n第二行')
})

test('围栏代码块带语言', () => {
  const blocks = parseBlocks('看这个：\n```ts\nconst a = 1\n```\n完')
  assert.equal(blocks.length, 3)
  assert.deepEqual(blocks[1], { kind: 'code', lang: 'ts', text: 'const a = 1' })
})

test('代码块里的井号不当标题', () => {
  const blocks = parseBlocks('```\n# 注释\n```')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].kind, 'code')
  assert.equal(blocks[0].text, '# 注释')
})

test('标题层级', () => {
  const blocks = parseBlocks('## 小节\n正文')
  assert.equal(blocks[0].kind, 'heading')
  assert.equal(blocks[0].level, 2)
  assert.equal(blocks[0].text, '小节')
})

test('无序列表归为一组', () => {
  const blocks = parseBlocks('- a\n- b\n- c')
  assert.equal(blocks.length, 1)
  assert.deepEqual(blocks[0], { kind: 'list', ordered: false, items: ['a', 'b', 'c'] })
})

test('有序列表', () => {
  const blocks = parseBlocks('1. 甲\n2. 乙')
  assert.deepEqual(blocks[0], { kind: 'list', ordered: true, items: ['甲', '乙'] })
})

test('列表中间换类型会断开', () => {
  const blocks = parseBlocks('- a\n1. b')
  assert.equal(blocks.length, 2)
})

test('空文本不产生块', () => {
  assert.deepEqual(parseBlocks('   \n\n'), [])
})

test('未闭合的代码块也能吃到底', () => {
  const blocks = parseBlocks('```\nabc')
  assert.equal(blocks[0].kind, 'code')
  assert.equal(blocks[0].text, 'abc')
})

test('行内：加粗与代码', () => {
  const parts = parseInline('这里有 **重点** 和 `code` 结束')
  assert.deepEqual(
    parts.map((p) => p.kind),
    ['text', 'bold', 'text', 'code', 'text']
  )
  assert.equal(parts[1].text, '重点')
  assert.equal(parts[3].text, 'code')
})

test('行内：没有标记时是单个文本片段', () => {
  const parts = parseInline('普通一句话')
  assert.equal(parts.length, 1)
  assert.equal(parts[0].kind, 'text')
})

test('行内：未闭合的星号原样保留', () => {
  const parts = parseInline('一个 * 号')
  assert.equal(parts.length, 1)
  assert.equal(parts[0].text, '一个 * 号')
})

test('表格：表头与数据行', () => {
  const blocks = parseBlocks('| 项 | 状态 |\n|---|---|\n| A | ✅ |\n| B | ❌ |')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].kind, 'table')
  assert.deepEqual(blocks[0].header, ['项', '状态'])
  assert.deepEqual(blocks[0].rows, [
    ['A', '✅'],
    ['B', '❌']
  ])
})

test('表格：没有分隔线就不认', () => {
  const blocks = parseBlocks('| 不是 | 表格 |')
  assert.equal(blocks[0].kind, 'para')
})
