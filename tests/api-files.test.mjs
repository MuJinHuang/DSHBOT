/**
 * N1-B：看得到产物。
 *
 * 接口必须挡住三类东西：二进制、超大文件、越界路径。
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fakeCtx, makeDataDir, startApi } from './helpers/harness.mjs'

const dataDir = makeDataDir()
const workspace = mkdtempSync(join(tmpdir(), 'dshbot-workspace-'))
let api
let room

before(async () => {
  mkdirSync(join(workspace, 'sub'), { recursive: true })
  mkdirSync(join(workspace, '.git'), { recursive: true })
  writeFileSync(join(workspace, 'readme.md'), '# 产物\n\n正文在这里。\n', 'utf8')
  writeFileSync(join(workspace, 'sub', 'b.txt'), 'world', 'utf8')
  writeFileSync(join(workspace, 'b.bin'), Buffer.from([0, 1, 2, 3]))
  writeFileSync(join(workspace, '.git', 'config'), 'should be ignored', 'utf8')
  writeFileSync(join(workspace, 'big.txt'), 'a'.repeat(200 * 1024 + 1), 'utf8')

  api = await startApi(dataDir, fakeCtx())
  const created = await api.api('rooms', {
    method: 'POST',
    body: JSON.stringify({
      name: '文件房',
      goal: '看一眼产物',
      acceptance: ['file:readme.md'],
      workspaceDir: workspace
    })
  })
  assert.equal(created.status, 201, created.text)
  room = created.data.room
})

after(async () => {
  await api.close()
})

test('B1 列文件：名称/大小/时间齐全，跳过 .git', async () => {
  const res = await api.api(`rooms/${room.id}/files`)
  assert.equal(res.status, 200, res.text)
  const paths = res.data.files.map((file) => file.path)
  assert.ok(paths.includes('readme.md'))
  assert.ok(paths.includes('sub/b.txt'))
  assert.ok(!paths.includes('.git/config'), '.git 里的东西不该出现在产物列表')
  const readme = res.data.files.find((file) => file.path === 'readme.md')
  assert.ok(readme.size > 0)
  assert.ok(typeof readme.mtime === 'string' && readme.mtime.includes('T'))
  assert.equal(res.data.truncated, false)
})

test('B2 预览文本文件', async () => {
  const res = await api.api(`rooms/${room.id}/file?path=${encodeURIComponent('readme.md')}`)
  assert.equal(res.status, 200, res.text)
  assert.match(res.data.text, /正文在这里/)
  assert.equal(res.data.path, 'readme.md')

  const nested = await api.api(`rooms/${room.id}/file?path=${encodeURIComponent('sub/b.txt')}`)
  assert.equal(nested.status, 200)
  assert.equal(nested.data.text, 'world')
})

test('B2 二进制文件明确拒绝（415）', async () => {
  const res = await api.api(`rooms/${room.id}/file?path=${encodeURIComponent('b.bin')}`)
  assert.equal(res.status, 415)
  assert.match(res.data.error, /二进制/)
})

test('B2 超过 200 KB 拒绝（413）', async () => {
  const res = await api.api(`rooms/${room.id}/file?path=${encodeURIComponent('big.txt')}`)
  assert.equal(res.status, 413)
  assert.match(res.data.error, /200 KB/)
})

test('B2 越界路径与绝对路径都拒绝', async () => {
  const up = await api.api(`rooms/${room.id}/file?path=${encodeURIComponent('../外面.txt')}`)
  assert.equal(up.status, 400)

  const absolute = await api.api(
    `rooms/${room.id}/file?path=${encodeURIComponent('C:\\Windows\\win.ini')}`
  )
  assert.equal(absolute.status, 400)

  const missing = await api.api(`rooms/${room.id}/file?path=${encodeURIComponent('不存在.md')}`)
  assert.equal(missing.status, 404)

  const dir = await api.api(`rooms/${room.id}/file?path=${encodeURIComponent('sub')}`)
  assert.equal(dir.status, 400)
})
