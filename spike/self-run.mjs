/**
 * 自己驱动一个房间跑任务：建房 → 说话 → 验收。
 *
 * 用 Node 而不是 PowerShell 脚本，是因为 PS 读无 BOM 的 UTF-8 文件会按 ANSI 解码，
 * 中文会变成「鍏堢湅」这种乱码——实测把任务指令喂坏过一次。
 *
 * 用法：node spike/self-run.mjs <token> [baseUrl]
 */
const [, , token, baseArg] = process.argv
if (!token) {
  console.error('用法: node spike/self-run.mjs <token> [baseUrl]')
  process.exit(1)
}
const base = baseArg ?? 'http://127.0.0.1:54873'

const ACCEPTANCE = [
  'cmd:pnpm test',
  `cmd:node -e "import('./packages/core/dist/index.js').then(m=>process.exit(typeof m.formatTokens==='function'?0:1))"`,
  `cmd:node -e "const fs=require('fs');const a=fs.readFileSync('packages/plugin/src/client/page.tsx','utf8');const b=fs.readFileSync('packages/core/src/markdown.ts','utf8');process.exit(/function formatTokens/.test(a)||/function formatTokens/.test(b)?1:0)"`,
  'file:packages/core/src/format.ts'
]

async function json(path, init) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, data: text === '' ? null : JSON.parse(text) }
}

const created = await json('/dshbot/api/rooms', {
  method: 'POST',
  body: JSON.stringify({
    name: '重构 formatTokens',
    goal: '把 page.tsx 与 markdown.ts 里重复的 formatTokens 收进 core 的 format.ts 并导出，两处改为复用，补单测',
    acceptance: ACCEPTANCE,
    workspaceDir: process.env.DSHBOT_WORKSPACE ?? process.cwd(),
    mode: 'auto'
  })
})
if (!created.ok) throw new Error('建房失败: ' + JSON.stringify(created.data))
const room = created.data.room
console.log(`room=${room.id} mode=${room.mode} workspace=${room.workspaceDir}`)

const started = Date.now()
const said = await json(`/dshbot/api/rooms/${room.id}/messages`, {
  method: 'POST',
  body: JSON.stringify({
    text:
      '先看 packages/plugin/src/client/page.tsx 和 packages/core/src/markdown.ts 里的 formatTokens，' +
      '把它收进 packages/core/src/format.ts 并导出，两处改为复用（删掉本地那份），' +
      '补三个单测（1.2k / 3.4M / 999），最后跑 pnpm test 确认全绿。只做这件事，不要改别的文件。'
  })
})
if (!said.ok) throw new Error('发送失败: ' + JSON.stringify(said.data))
console.log(`对话耗时 ${((Date.now() - started) / 1000).toFixed(1)}s，产生 ${said.data.messages?.length ?? 0} 条消息`)

for (const m of said.data.messages ?? []) {
  if (m.kind === 'tool') console.log('  tool: ' + m.text.slice(0, 100))
}
const bot = (said.data.messages ?? []).filter((m) => m.kind === 'bot').at(-1)
if (bot) console.log('\nBot 结论：\n' + bot.text.slice(0, 800))

const delivered = await json(`/dshbot/api/rooms/${room.id}/deliver`, { method: 'POST', body: '{}' })
if (!delivered.ok) throw new Error('验收失败: ' + JSON.stringify(delivered.data))
const delivery = delivered.data.delivery
console.log('\n' + delivery.summary)
for (const check of delivery.checks) {
  console.log(`  [${check.verdict}] ${check.point}`)
  console.log(`        ${check.reason.slice(0, 160)}`)
}
console.log('变更文件: ' + (delivery.changedFiles.join(', ') || '（无）'))
