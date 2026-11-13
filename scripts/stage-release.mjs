/**
 * 构建发布产物（跨平台，不依赖系统 zip）。
 *
 * 产出：
 *   dist/dshbot-plugin-<version>/       可直接拷进 profile 的目录
 *   dist/dshbot-plugin-<version>.zip
 *   dist/dshbot-plugin-<version>.tgz
 *   dist/SHA256SUMS.txt
 *
 * 用法：pnpm stage:release
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const version = JSON.parse(readFileSync(join(root, 'packages/plugin/package.json'), 'utf8')).version
const dist = join(root, 'dist')
const stage = join(dist, `dshbot-plugin-${version}`)

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, base, out)
    else out.push({ path, rel: relative(base, path).replaceAll('\\', '/') })
  }
  return out
}

/** ZIP 用到的 CRC32。 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function dosTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

/**
 * 写一个最小但合法的 ZIP（deflate + UTF-8 文件名）。
 * 只依赖 Node 内置 zlib，避免 CI / Windows 上装 zip。
 */
function writeZip(dir, out) {
  const files = walk(dir)
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const file of files) {
    const data = readFileSync(file.path)
    const name = Buffer.from(file.rel, 'utf8')
    const compressed = deflateRawSync(data, { level: 9 })
    const crc = crc32(data)
    const stamp = dosTime(statSync(file.path).mtime)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const localBuffer = Buffer.concat([local, name, compressed])
    localParts.push(localBuffer)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(Buffer.concat([central, name]))

    offset += localBuffer.length
  }

  const centralBuffer = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  writeFileSync(out, Buffer.concat([...localParts, centralBuffer, end]))
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
cpSync(join(root, 'packages/plugin/lib'), join(stage, 'lib'), { recursive: true })
cpSync(join(root, 'packages/plugin/locale'), join(stage, 'locale'), { recursive: true })
for (const file of ['package.json', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
  copyFileSync(join(root, 'packages/plugin', file), join(stage, file))
}
for (const file of ['LICENSE', 'CHANGELOG.md']) {
  copyFileSync(join(root, file), join(stage, file))
}

const zipFile = join(dist, `dshbot-plugin-${version}.zip`)
writeZip(stage, zipFile)
console.log(`zip: ${relative(root, zipFile)}`)

// pnpm pack 会把 README/LICENSE 一起带上；临时复制 LICENSE 后清理
copyFileSync(join(root, 'LICENSE'), join(root, 'packages/plugin/LICENSE'))
try {
  execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['pack', '--pack-destination', dist], {
    cwd: join(root, 'packages/plugin'),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
} finally {
  rmSync(join(root, 'packages/plugin/LICENSE'), { force: true })
}

const tgz = join(dist, `dshbot-plugin-${version}.tgz`)
for (const file of [zipFile, tgz]) {
  if (!statSync(file).isFile()) throw new Error(`产物不存在：${file}`)
}
const sums = [zipFile, tgz]
  .map((file) => `${sha256(file)}  ${relative(dist, file).replaceAll('\\', '/')}`)
  .join('\n')
writeFileSync(join(dist, 'SHA256SUMS.txt'), sums + '\n', 'utf8')
console.log('SHA256SUMS.txt')
console.log(sums)
