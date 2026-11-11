// 统计本机会话日志里的 token 用量：找最新的会话文件，解压 zstd，累加 assistant/message 的 usage。
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const root = path.join(os(), '.dsh', 'sessions')

function os() {
  return process.env.USERPROFILE ?? process.env.HOME
}

/** 递归收集所有会话文件。 */
function collect(dir, out = []) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, out)
    else if (entry.name.endsWith('.jsonl.zstd') || entry.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}

const files = collect(root).map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
files.sort((a, b) => b.mtime - a.mtime)

const newest = files[0]
if (!newest) {
  console.log('没找到会话文件')
  process.exit(0)
}
console.log('最新会话：', newest.file)
console.log('最后写入：', new Date(newest.mtime).toLocaleString())

const raw = fs.readFileSync(newest.file)
let text
try {
  text = newest.file.endsWith('.zstd') ? zlib.zstdDecompressSync(raw).toString('utf8') : raw.toString('utf8')
} catch (error) {
  console.log('解压失败：', error.message)
  process.exit(1)
}

let input = 0
let output = 0
let cacheRead = 0
let cacheWrite = 0
let messages = 0

for (const line of text.split('\n')) {
  if (line.trim() === '') continue
  let event
  try {
    event = JSON.parse(line)
  } catch {
    continue
  }
  const usage = event?.data?.usage
  if (event?.type !== 'assistant/message' || usage === undefined) continue
  messages += 1
  input += Number(usage.inputTokens ?? 0)
  output += Number(usage.outputTokens ?? 0)
  cacheRead += Number(usage.cacheReadTokens ?? 0)
  cacheWrite += Number(usage.cacheWriteTokens ?? 0)
}

const fmt = (n) => (n / 1e6).toFixed(2) + 'M'
console.log(`\nassistant 消息数：${messages}`)
console.log(`输入（未命中缓存）：${fmt(input)}`)
console.log(`输入（缓存命中）：${fmt(cacheRead)}`)
console.log(`缓存写入：${fmt(cacheWrite)}`)
console.log(`输出：${fmt(output)}`)
const total = input + cacheRead + cacheWrite + output
console.log(`合计：${fmt(total)}`)

// deepseek-flash 定价（元 / 百万 tokens），高峰期
const P_HIT = 0.04
const P_MISS = 2
const P_OUT = 8
const peak = (cacheRead / 1e6) * P_HIT + ((input + cacheWrite) / 1e6) * P_MISS + (output / 1e6) * P_OUT
console.log(`\n按 deepseek-flash 高峰价：¥${peak.toFixed(2)}　空闲价（半价）：¥${(peak / 2).toFixed(2)}`)

const all = files.reduce((sum, item) => {
  try {
    const buf = fs.readFileSync(item.file)
    const body = item.file.endsWith('.zstd') ? zlib.zstdDecompressSync(buf).toString('utf8') : buf.toString('utf8')
    let t = 0
    for (const line of body.split('\n')) {
      if (line.trim() === '') continue
      try {
        const event = JSON.parse(line)
        const usage = event?.data?.usage
        if (event?.type === 'assistant/message' && usage !== undefined) {
          t += Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0) +
            Number(usage.cacheReadTokens ?? 0) + Number(usage.cacheWriteTokens ?? 0)
        }
      } catch {}
    }
    return sum + t
  } catch {
    return sum
  }
}, 0)
console.log(`本机全部 ${files.length} 个会话累计：${fmt(all)} tokens`)
