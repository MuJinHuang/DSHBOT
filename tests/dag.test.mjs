/**
 * N2：DAG 分层。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { orderPlanItems } from '../packages/core/dist/index.js'

test('链式依赖：一次一层', () => {
  const order = orderPlanItems([
    { id: 'a' },
    { id: 'b', dependsOn: ['a'] },
    { id: 'c', dependsOn: ['b'] }
  ])
  assert.equal(order.cycle, false)
  assert.deepEqual(order.levels, [[0], [1], [2]])
  assert.deepEqual(order.missing, [])
})

test('无依赖可并行，汇聚点等所有上游', () => {
  const order = orderPlanItems([
    { id: 'a' },
    { id: 'b' },
    { id: 'c', dependsOn: ['a', 'b'] }
  ])
  assert.deepEqual(order.levels, [[0, 1], [2]])
})

test('环会被识别', () => {
  const order = orderPlanItems([
    { id: 'a', dependsOn: ['b'] },
    { id: 'b', dependsOn: ['a'] }
  ])
  assert.equal(order.cycle, true)
})

test('指向不存在或自身的依赖会报 missing', () => {
  const order = orderPlanItems([
    { id: 'a', dependsOn: ['a'] },
    { id: 'b', dependsOn: ['ghost'] }
  ])
  assert.equal(order.cycle, false)
  assert.deepEqual(order.missing.sort(), ['a', 'ghost'])
  // 缺失依赖不阻塞排序（由调用方决定是否拒绝/跳过）；两项都可立即执行
  assert.deepEqual(order.levels, [[0, 1]])
})

test('重复 id 会让依赖失效并报 missing', () => {
  const order = orderPlanItems([{ id: 'a' }, { id: 'a' }, { id: 'b', dependsOn: ['a'] }])
  assert.ok(order.missing.includes('a'))
})
