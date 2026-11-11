/**
 * formatTokens 的单测。
 *
 * 这个格式同时出现在房间页面与导出 Markdown 里，两处必须一致，
 * 因此固定住三个常用量级。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatTokens } from '../packages/core/dist/index.js'

test('千级压成 1.2k', () => {
  assert.equal(formatTokens(1200), '1.2k')
})

test('百万级压成 3.4M', () => {
  assert.equal(formatTokens(3_400_000), '3.4M')
})

test('不到一千的原样输出', () => {
  assert.equal(formatTokens(999), '999')
})
