/**
 * N1-E1 / E4：`pnpm drill` 的 mock 模式必须能在 CI 里跑通。
 *
 * 走的还是真正的 HTTP 处理器 + 假 agent，断言「建房 → 跑任务 → 文件存在 → 验收通过」。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runDrill } from '../spike/drill.mjs'

test('E1 drill：建房 → 跑任务 → 验收通过', async () => {
  const result = await runDrill()
  assert.equal(result.mode, 'mock')
  assert.ok(result.roomId.startsWith('room_'))
  assert.equal(result.checks, 1)
  assert.ok(result.changedFiles.includes('drill-out.md'))
  assert.match(result.summary, /通过/)
})
