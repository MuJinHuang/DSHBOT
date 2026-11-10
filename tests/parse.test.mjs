/**
 * 纯函数单测。
 *
 * 运行：pnpm test（会先构建 core，再跑 node --test）
 *
 * 这里的每一条都对应一个曾经踩过的坑，改坏了就会红。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  extractFiles,
  normalizeVerdict,
  parseChecks,
  parseGitStatus,
  parseMentions,
  resolveTargets,
  summarizeArgs
} from '../packages/core/dist/index.js'

const member = (name, role = 'worker', botId = 'bot_' + name) => ({
  botId,
  name,
  role,
  avatar: '🤖',
  status: 'idle',
  tokensUsed: 0
})

const room = (members) => ({
  id: 'room_1',
  name: '测试',
  goal: '测试',
  acceptance: ['a'],
  status: 'created',
  mode: 'confirm',
  budget: { perRun: 1, perBot: 1, perRoom: 1 },
  shared: '',
  members,
  tokensUsed: 0,
  createdAt: '',
  updatedAt: ''
})

test('parseMentions：抽出名字，排除所有人与标点', () => {
  assert.deepEqual(parseMentions('@小柯 你来'), ['小柯'])
  assert.deepEqual(parseMentions('@所有人 停'), [])
  assert.deepEqual(parseMentions('@all stop'), [])
  assert.deepEqual(parseMentions('@小柯，@老周。'), ['小柯', '老周'])
  assert.deepEqual(parseMentions('没有提及'), [])
})

test('resolveTargets：@ 谁谁接', () => {
  const r = room([member('小柯'), member('老周')])
  assert.deepEqual(
    resolveTargets(r, ['老周']).map((m) => m.name),
    ['老周']
  )
})

test('resolveTargets：单 Bot 不 @ 也接', () => {
  const r = room([member('小柯')])
  assert.equal(resolveTargets(r, []).length, 1)
})

test('resolveTargets：多 Bot 无总管且没 @，谁都不接', () => {
  const r = room([member('小柯'), member('老周')])
  assert.deepEqual(resolveTargets(r, []), [])
})

test('resolveTargets：有总管时总管接话', () => {
  const r = room([member('小柯'), member('阿岚', 'host')])
  assert.deepEqual(
    resolveTargets(r, []).map((m) => m.name),
    ['阿岚']
  )
})

test('resolveTargets：@ 到不存在的人，按默认规则兜底', () => {
  const r = room([member('小柯')])
  assert.equal(resolveTargets(r, ['不存在']).length, 1)
})

test('resolveTargets：空房间返回空', () => {
  assert.deepEqual(resolveTargets(room([]), ['小柯']), [])
})

test('extractFiles：带路径的、带扩展名的都认', () => {
  const files = extractFiles('请改 src/theme.css 和 README.md，别动别的')
  assert.ok(files.includes('src/theme.css'))
  assert.ok(files.includes('README.md'))
})

test('extractFiles：反斜杠归一成正斜杠', () => {
  assert.deepEqual(extractFiles('改一下 src\\a\\b.ts'), ['src/a/b.ts'])
})

test('extractFiles：最多 5 个', () => {
  const files = extractFiles('a/1.ts a/2.ts a/3.ts a/4.ts a/5.ts a/6.ts a/7.ts')
  assert.equal(files.length, 5)
})

test('extractFiles：没有文件路径时返回空', () => {
  assert.deepEqual(extractFiles('就随便聊聊'), [])
})

test('summarizeArgs：优先取 command 字段', () => {
  const raw = JSON.stringify({ command: 'Get-ChildItem -Force', description: '列目录' })
  assert.equal(summarizeArgs(raw), 'Get-ChildItem -Force')
})

test('summarizeArgs：非 JSON 用原文，长文本截断', () => {
  assert.equal(summarizeArgs('not json'), 'not json')
  const long = 'x'.repeat(200)
  const out = summarizeArgs(long)
  assert.ok(out.length <= 81, '应当截断')
  assert.ok(out.endsWith('…'))
})

test('normalizeVerdict：英文与中文都能归一', () => {
  assert.equal(normalizeVerdict('pass'), 'pass')
  assert.equal(normalizeVerdict('PASS'), 'pass')
  assert.equal(normalizeVerdict('不通过'), 'fail')
  assert.equal(normalizeVerdict('失败'), 'fail')
  assert.equal(normalizeVerdict('???'), 'unsure')
  assert.equal(normalizeVerdict(undefined), 'unsure')
})

test('parseChecks：标准 JSON 数组', () => {
  const raw = '[{"verdict":"pass","reason":"有"},{"verdict":"fail","reason":"没有"}]'
  const checks = parseChecks(raw, ['提到 M0', '列出 3 条'])
  assert.deepEqual(
    checks.map((c) => c.verdict),
    ['pass', 'fail']
  )
  assert.equal(checks[1].reason, '没有')
})

test('parseChecks：JSON 前后有废话也能抠出来', () => {
  const raw = '好的，结果如下：\n[{"verdict":"pass","reason":"ok"}]\n以上。'
  const checks = parseChecks(raw, ['x'])
  assert.equal(checks[0].verdict, 'pass')
})

test('parseChecks：数组比验收点少时，降级逐行匹配', () => {
  const raw = '1. 提到 M0 与 M1 的完成情况 —— 通过\n2. 全文不超过 400 字 —— 不通过'
  const checks = parseChecks(raw, ['提到 M0 与 M1 的完成情况', '全文不超过 400 字'])
  assert.deepEqual(
    checks.map((c) => c.verdict),
    ['pass', 'fail']
  )
})

test('parseChecks：完全解析不了时全存疑，并留下原话', () => {
  const checks = parseChecks('我觉得还行吧', ['a', 'b'])
  assert.deepEqual(
    checks.map((c) => c.verdict),
    ['unsure', 'unsure']
  )
  assert.ok(checks[0].reason.includes('我觉得还行吧'))
})

test('parseChecks：空文本也不炸', () => {
  const checks = parseChecks('', ['a'])
  assert.equal(checks[0].verdict, 'unsure')
})

test('parseGitStatus：切掉两位状态码，路径不能少字母', () => {
  const out = ' M packages/core/src/types.ts\nM  README.md\n?? spike/new.png\n'
  assert.deepEqual(parseGitStatus(out), [
    'packages/core/src/types.ts',
    'README.md',
    'spike/new.png'
  ])
})

test('parseGitStatus：空输出返回空数组', () => {
  assert.deepEqual(parseGitStatus(''), [])
})
