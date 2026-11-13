/**
 * 真实模型 DAG 验收（会花 token）。
 *
 * 前提：已经有一个装好本插件的 DSH 实例在跑：
 *   $env:DSHBOT_DATA_DIR="$env:TEMP\dshbot-live-dag"; dsh --profile dshbot-dev --port 54873 --no-open
 *   node spike/live-dag-check.mjs --port 54873
 *
 * 流程：建总管 + 两个执行者 → 总管出计划 → 强制 A→B 依赖 → 批准执行 →
 * 验证 a.md / b.md 真的写出来 → 交付验收。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const port = option('--port', '54873')
const base = `http://127.0.0.1:${port}/dshbot/api`
const workspace = mkdtempSync(join(tmpdir(), 'dshbot-live-dag-'))

async function api(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(300_000)
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data, text }
}

const post = (path, body) =>
  api(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

function log(message) {
  console.log(`[live] ${message}`)
}

async function main() {
  log(`workspace=${workspace}`)
  const health = await api('/health')
  if (health.status !== 200) throw new Error('插件 API 不可用：先启动 DSH')

  const host = (
    await post('/bots', {
      name: '阿岚',
      avatar: '🧭',
      persona:
        '你是本房间的总管：只做拆活和派活，不自己动手。把活拆成两件，用 @名字 指派，有依赖时在行末写 [依赖:@名字]。',
      instructions: '只输出派活行，不要解释；必须真的用 @老周 和 @小柯。',
      agentPreset: 'standard'
    })
  ).data.bot
  const writer = (
    await post('/bots', {
      name: '老周',
      avatar: '🛠',
      persona: '你负责写文件。只做分给你的那一件事，写完一句话汇报。',
      instructions: '用文件工具真的写入，不要只在回复里说。',
      agentPreset: 'standard'
    })
  ).data.bot
  const follower = (
    await post('/bots', {
      name: '小柯',
      avatar: '📝',
      persona: '你负责基于上游产物写文件。只做分给你的那一件事。',
      instructions: '先确认上游文件存在，再写入；不要代写上游。',
      agentPreset: 'standard'
    })
  ).data.bot

  const room = (
    await post('/rooms', {
      name: '真实 DAG 验收',
      goal: '先写 a.md，再基于 a.md 写 b.md',
      acceptance: ['file:a.md', 'file:b.md'],
      workspaceDir: workspace,
      mode: 'confirm'
    })
  ).data.room
  log(`room=${room.id}`)

  for (const [def, role] of [
    [host, 'host'],
    [writer, 'worker'],
    [follower, 'worker']
  ]) {
    const added = await post(`/rooms/${room.id}/members`, { defId: def.id, role })
    if (added.status !== 201) throw new Error(`拉人失败：${added.text}`)
  }

  const said = await post(`/rooms/${room.id}/messages`, {
    text: '请派两件有依赖的活：老周先写 a.md（只写 A）；小柯等老周完成后，基于 a.md 写 b.md（写 A+B）。只输出两行派活行，用 at 符号加名字点名；小柯那行末尾按系统要求加依赖标记。'
  })
  if (said.status !== 200) throw new Error(`派活失败：${said.text}`)
  const rooms = await api('/rooms')
  const fresh = rooms.data.rooms.find((item) => item.id === room.id)
  const plan = fresh?.pendingPlan
  if (plan === undefined) {
    log('总管没有出计划，消息如下：')
    for (const message of said.data.messages ?? []) log(`  [${message.kind}] ${message.text}`)
    throw new Error('没有待确认计划')
  }

  const itemA = plan.items.find((item) => item.name.includes('老周'))
  const itemB = plan.items.find((item) => item.name.includes('小柯'))
  if (itemA === undefined || itemB === undefined) {
    throw new Error('计划里没有老周/小柯：' + plan.items.map((item) => item.name).join('、'))
  }
  log(`plan: ${plan.items.map((item) => item.name).join(' / ')}`)

  const approved = await post(`/rooms/${room.id}/plan`, {
    action: 'approve',
    itemIds: plan.items.map((item) => item.id),
    dependencies: { [itemB.id]: [itemA.id] }
  })
  if (approved.status !== 200) throw new Error(`批准失败：${approved.text}`)
  log('执行完成，开始验收')

  const delivered = await post(`/rooms/${room.id}/deliver`, {})
  if (delivered.status !== 200) throw new Error(`验收失败：${delivered.text}`)
  const delivery = delivered.data.delivery
  log(`验收：${delivery.summary}`)
  log(`文件：${delivery.changedFiles.join('、')}`)

  const fileA = join(workspace, 'a.md')
  const fileB = join(workspace, 'b.md')
  if (!existsSync(fileA) || !existsSync(fileB)) {
    throw new Error('a.md / b.md 没有落盘')
  }
  log(`a.md=${readFileSync(fileA, 'utf8').trim().slice(0, 80)}`)
  log(`b.md=${readFileSync(fileB, 'utf8').trim().slice(0, 80)}`)
  const failed = delivery.checks.filter((check) => check.verdict !== 'pass')
  if (failed.length > 0) throw new Error(`验收未全过：${JSON.stringify(failed)}`)
  log('真实 DAG 验收通过')
}

main()
  .catch((error) => {
    console.error('[live] 失败：' + (error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  })
  .finally(() => {
    rmSync(workspace, { recursive: true, force: true })
  })
