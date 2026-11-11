/**
 * 在**桌面端实例**上跑一次完整的岗位化协作测试。
 *
 * 场景：总管 + 硬件工程师 + 文档编辑，做一个硬件开发流程 + 文档。
 *
 * 用法：node spike/desktop-test.mjs <port> [token]
 */
import http from 'node:http'
import { mkdirSync } from 'node:fs'

const [, , portArg, tokenArg] = process.argv
const port = Number(portArg ?? 59565)
const base = `http://127.0.0.1:${port}`
const query = tokenArg ? `?token=${tokenArg}` : ''

/** 用 http 而不是 fetch：多 Bot 一轮可能超过 fetch 默认的 300s 头超时。 */
function call(method, path, body, timeoutMs = 900_000) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8')
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/dshbot/api' + path,
        method,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': payload.length }
          : {},
        timeout: timeoutMs
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`${method} ${path} → ${res.statusCode} ${text}`))
            return
          }
          resolve(text === '' ? undefined : JSON.parse(text))
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error(`${path} 超时`)))
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const bots = [
  {
    name: '阿岚',
    avatar: '🧭',
    persona: '技术项目经理，擅长拆解目标、识别风险、把活分给对的人。不亲自写文档，也不做硬件计算。',
    expertise: '拆解与统筹',
    instructions: '派活时写清交付物、验收口径和截止；只派需要动手的活。',
    agentPreset: 'standard'
  },
  {
    name: '老周',
    avatar: '🛠',
    persona: '资深硬件工程师，做过十年电源与热设计，习惯先算最坏情况。',
    expertise: '电源设计、热设计',
    instructions: '先给结论，再列风险与验证方法；参数必须带单位和容差。',
    agentPreset: 'standard'
  },
  {
    name: '小柯·文档',
    avatar: '📝',
    persona: '技术文档编辑，擅长把工程材料写成给非技术读者看的说明，重视结构与术语一致。',
    expertise: '技术写作、结构化',
    instructions: '用一句话总评开头；正文分章节；关键参数用表格；不编造未给出的数据。',
    agentPreset: 'standard'
  }
]

console.log('=== 1. 往库里建三个 Bot（已存在则复用）===')
const existing = (await call('GET', '/bots')).bots ?? []
const created = []
for (const bot of bots) {
  const found = existing.find((item) => item.name === bot.name)
  if (found !== undefined) {
    created.push(found)
    console.log(`  ${found.avatar} ${found.name}｜${found.expertise}（已存在）`)
    continue
  }
  const result = await call('POST', '/bots', bot)
  created.push(result.bot)
  console.log(`  ${result.bot.avatar} ${result.bot.name}｜${result.bot.expertise}`)
}

console.log('\n=== 2. 建演示工作区并建房 ===')
const workspace = `${process.env.USERPROFILE}\\.dsh\\dshbot\\demo-hardware`
mkdirSync(workspace, { recursive: true })
const roomResult = await call('POST', '/rooms', {
  name: '硬件开发流程',
  goal: '为一块 5V/3A 供电模块产出硬件开发流程，并写成一份可交付的说明文档',
  acceptance: [
    'file:硬件开发流程.md',
    "cmd:node -e \"const fs=require('fs');const s=fs.readFileSync('硬件开发流程.md','utf8');process.exit(s.length>800?0:1)\"",
    '文档覆盖电源、结构与散热、认证三部分'
  ],
  workspaceDir: workspace,
  mode: 'confirm'
})
const room = roomResult.room
console.log(`  房间：${room.name}（${room.id}）`)
console.log(`  工作区：${room.workspaceDir}`)
console.log(`  验收：${room.acceptance.join(' | ')}`)

console.log('\n=== 3. 从库里拉人 ===')
for (const [index, bot] of created.entries()) {
  const role = index === 0 ? 'host' : 'worker'
  try {
    await call('POST', `/rooms/${room.id}/members`, { defId: bot.id, role })
    console.log(`  ${bot.name} → ${role === 'host' ? '总管' : '执行'}`)
  } catch (error) {
    console.log(`  ${bot.name} 跳过：${String(error.message).slice(0, 60)}`)
  }
}

console.log('\n=== 4. 发任务（confirm 模式：只出计划）===')
const started = Date.now()
const said = await call('POST', `/rooms/${room.id}/messages`, {
  text: '帮我做一个 5V/3A 供电模块的硬件开发流程，并写一份详细文档。老周负责硬件部分，小柯负责把流程写成文档，写完互相看一眼。'
})
console.log(`  用时 ${((Date.now() - started) / 1000).toFixed(1)}s，产生 ${said.messages.length} 条消息`)

const afterSay = await call('GET', `/rooms/${room.id}`)
const plan = afterSay.room.pendingPlan
if (plan === undefined) {
  console.log('  ⚠ 没有生成计划（总管可能直接干了，或没派活）')
  for (const message of said.messages.filter((m) => m.kind === 'bot')) {
    console.log('  总管说：' + message.text.replace(/\s+/g, ' ').slice(0, 300))
  }
} else {
  console.log(`  计划 ${plan.items.length} 件：`)
  for (const item of plan.items) {
    console.log(`    → ${item.name}：${item.task.replace(/\s+/g, ' ').slice(0, 90)}`)
  }
}

if (plan !== undefined) {
  console.log('\n=== 5. 批准并执行 ===')
  const approved = await call('POST', `/rooms/${room.id}/plan`, { action: 'approve' })
  console.log(`  执行完，新增 ${approved.messages.length} 条消息`)
  for (const message of approved.messages.filter((m) => m.kind === 'bot')) {
    console.log(`  [${message.botId}] ${message.text.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
}

console.log('\n=== 6. 验收 ===')
const delivered = await call('POST', `/rooms/${room.id}/deliver`, {})
const delivery = delivered.delivery
console.log('  ' + delivery.summary)
for (const check of delivery.checks) {
  console.log(`  [${check.verdict}] ${check.point}`)
  console.log(`        ${check.reason.slice(0, 120)}`)
}
console.log('  变更文件：' + (delivery.changedFiles.join('、') || '（无）'))
console.log(`\n打开 GUI：${base}/${query}`)
