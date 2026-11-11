/**
 * 预算判定的单测。
 *
 * 这个函数决定"还要不要继续烧钱"，边界必须固定住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { canStartRun, evaluateBudget } from '../packages/core/dist/index.js'

test('用了一半是 ok', () => {
  const state = evaluateBudget(500, 1000)
  assert.equal(state.level, 'ok')
  assert.equal(state.ratio, 0.5)
  assert.equal(state.remaining, 500)
})

test('超过 80% 变 warn', () => {
  assert.equal(evaluateBudget(800, 1000).level, 'warn')
  assert.equal(evaluateBudget(999, 1000).level, 'warn')
})

test('刚好用满是 exhausted', () => {
  const state = evaluateBudget(1000, 1000)
  assert.equal(state.level, 'exhausted')
  assert.equal(state.remaining, 0)
})

test('超支了也算 exhausted，且比例大于 1', () => {
  const state = evaluateBudget(1500, 1000)
  assert.equal(state.level, 'exhausted')
  assert.ok(state.ratio > 1)
  assert.equal(state.remaining, 0)
})

test('额度为 0 表示不限制', () => {
  const state = evaluateBudget(999999, 0)
  assert.equal(state.level, 'ok')
  assert.equal(state.remaining, Number.POSITIVE_INFINITY)
})

test('脏数据不炸：负数与 NaN 当 0', () => {
  assert.equal(evaluateBudget(-5, 1000).level, 'ok')
  assert.equal(evaluateBudget(Number.NaN, 1000).level, 'ok')
})

test('canStartRun：到线就不让开新一轮', () => {
  const room = (used) => ({ tokensUsed: used, budget: { perRun: 1, perBot: 1, perRoom: 1000 } })
  assert.equal(canStartRun(room(999)), true)
  assert.equal(canStartRun(room(1000)), false)
  assert.equal(canStartRun(room(5000)), false)
  assert.equal(canStartRun({ budget: { perRun: 1, perBot: 1, perRoom: 1000 } }), true)
})
