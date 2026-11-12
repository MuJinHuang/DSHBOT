/**
 * 发布形态的回归：bundle 清单、locale、图标、LICENSE 少一个都不算可发布。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pluginDir = join(root, 'packages', 'plugin')
const manifest = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'))

test('包清单声明 dsh.bundle.patch，且补丁文件存在、只插入一个条目', () => {
  const patch = manifest.dsh?.bundle?.patch
  assert.equal(typeof patch, 'string')
  const file = join(pluginDir, patch)
  assert.ok(existsSync(file), `缺少 ${patch}`)
  const text = readFileSync(file, 'utf8')
  assert.match(text, /id:\s*dshbot/)
  assert.match(text, /name:\s*'@dshbot\/plugin'/)
  assert.equal((text.match(/id:\s*dshbot/g) ?? []).length, 1, '不能重复插入同一个 id')
})

test('发布包含 locale / icon，且 meta 有标题与描述', () => {
  assert.ok(manifest.files?.includes('cordis.patch.yml'))
  assert.ok(manifest.files?.includes('locale'))
  assert.ok(manifest.files?.includes('icon.svg'))
  assert.equal(manifest.exports?.['./icon'], './icon.svg')

  for (const language of ['en', 'zh']) {
    const file = join(pluginDir, 'locale', `${language}.json`)
    assert.ok(existsSync(file), `缺少 locale/${language}.json`)
    const data = JSON.parse(readFileSync(file, 'utf8'))
    assert.ok(data.meta?.title?.length > 0, `${language} 缺 meta.title`)
    assert.ok(data.meta?.description?.length > 0, `${language} 缺 meta.description`)
  }

  const icon = readFileSync(join(pluginDir, 'icon.svg'), 'utf8')
  assert.match(icon.trimStart(), /^<svg[\s>]/)
})

test('仓库带 MIT LICENSE，包元数据完整', () => {
  const license = readFileSync(join(root, 'LICENSE'), 'utf8')
  assert.match(license, /MIT License/)
  assert.equal(manifest.license, 'MIT')
  assert.equal(typeof manifest.author, 'string')
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length > 0)
  assert.equal(manifest.private, undefined, '要发布就不能是 private')
})

test('运行时依赖保持为零', () => {
  assert.deepEqual(manifest.dependencies, {})
  assert.equal(manifest.peerDependencies, undefined, '跑时不 import cordis，就别声明 peer 依赖')
})
