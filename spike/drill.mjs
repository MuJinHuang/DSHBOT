/**
 * `pnpm drill`：一条命令跑完「建房 → 派活 → 产出文件 → 验收通过」。
 *
 * 默认用**进程内假宿主**：不启动 DSH、不花 token，CI 也能跑。
 * 想打真实实例就加 `--port <端口>`（会真的调用模型，花 token）。
 *
 * 用法：
 *   pnpm drill
 *   pnpm drill -- --port 54873
 *   pnpm drill -- --keep      # 保留临时数据目录，便于查现场
 */
import http from 'node:http'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 演练产物文件名：验收就看它。 */
const ARTIFACT = 'drill-out.md'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * 假宿主模式：整条链在进程内跑，0 token。
 *
 * @param options.keep - 保留临时目录
 */
async function mockDrill(options = {}) {
  const { fakeCtx, makeDataDir, startApi } = await import('../tests/helpers/harness.mjs')
  const dataDir = makeDataDir()
  const workspace = mkdtempSync(join(tmpdir(), 'dshbot-drill-work-'))
  const ctx = fakeCtx({
    reply: `已生成 ${ARTIFACT}。`,
    onCreate: (cwd) => {
      writeFileSync(join(cwd, ARTIFACT), '# 演练产物\n\n由 pnpm drill 的假 agent 生成。\n', 'utf8')
    }
  })
  const api = await startApi(dataDir, ctx)

  try {
    const created = await api.api('rooms', {
      method: 'POST',
      body: JSON.stringify({
        name: 'pnpm drill',
        goal: '自动演练：产出一个文件并通过验收',
        acceptance: [`file:${ARTIFACT}`],
        workspaceDir: workspace
      })
    })
    assert(created.status === 201, `建房失败：${created.text}`)
    const roomId = created.data.room.id

    // 新房间默认是空的：显式建一只 Bot 再拉进来
    const bot = (
      await api.api('bots', {
        method: 'POST',
        body: JSON.stringify({
          name: '演练执行者',
          avatar: '🧪',
          persona: '按房间要求创建文件。',
          instructions: '必须真的写文件，然后用一句话说明。'
        })
      })
    ).data.bot
    const added = await api.api(`rooms/${roomId}/members`, {
      method: 'POST',
      body: JSON.stringify({ defId: bot.id, role: 'worker' })
    })
    assert(added.status === 201, `拉人失败：${added.text}`)

    const said = await api.api(`rooms/${roomId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text: '请生成演练产物' })
    })
    assert(said.status === 200, `派活失败：${said.text}`)
    const botMessages = said.data.messages.filter((message) => message.kind === 'bot')
    assert(botMessages.length > 0, 'Bot 没有回话')
    assert(existsSync(join(workspace, ARTIFACT)), `Bot 没有真的写 ${ARTIFACT}`)

    const delivered = await api.api(`rooms/${roomId}/deliver`, {
      method: 'POST',
      body: '{}'
    })
    assert(delivered.status === 200, `验收失败：${delivered.text}`)
    const delivery = delivered.data.delivery
    assert(delivery.checks.length > 0, '验收点为空')
    assert(
      delivery.checks.every((check) => check.verdict === 'pass'),
      '验收没有全通过：' + delivery.checks.map((check) => `${check.point}=${check.verdict}`).join('；')
    )
    assert(delivery.changedFiles.includes(ARTIFACT), '验收没看到变更文件')

    return {
      mode: 'mock',
      roomId,
      checks: delivery.checks.length,
      changedFiles: delivery.changedFiles,
      summary: delivery.summary
    }
  } finally {
    await api.close()
    if (options.keep !== true) {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(workspace, { recursive: true, force: true })
    }
  }
}

/** 真实实例模式：用 http 而不是 fetch，避免长任务撞上 300s 头超时。 */
async function realDrill(options) {
  const port = options.port
  const workspace =
    options.workspace ??
    mkdtempSync(join(tmpdir(), 'dshbot-drill-live-'))

  const call = (method, path, body, timeoutMs = 900_000) =>
    new Promise((resolve, reject) => {
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
          res.on('data', (chunk) => chunks.push(chunk))
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

  const suffix = Date.now().toString(36)
  const botName = `演练执行者-${suffix}`
  const bot = (
    await call('POST', '/bots', {
      name: botName,
      avatar: '🧪',
      persona: '你负责按房间要求在工作区里真的创建文件。',
      instructions: '直接写文件，不要只描述；完成后用一句话说明写了什么。',
      agentPreset: 'standard'
    })
  ).bot

  const room = (
    await call('POST', '/rooms', {
      name: `pnpm drill ${suffix}`,
      goal: `在房间工作区创建一个 ${ARTIFACT} 文件`,
      acceptance: [`file:${ARTIFACT}`],
      workspaceDir: workspace,
      mode: 'auto'
    })
  ).room
  await call('POST', `/rooms/${room.id}/members`, { defId: bot.id, role: 'worker' })

  await call('POST', `/rooms/${room.id}/messages`, {
    text: `@${botName} 请在工作区创建 ${ARTIFACT}，内容随意，但文件必须真的存在。`
  })
  const delivery = (await call('POST', `/rooms/${room.id}/deliver`, {})).delivery
  assert(
    delivery.checks.every((check) => check.verdict === 'pass'),
    '验收没有全通过：' + delivery.checks.map((check) => `${check.point}=${check.verdict}`).join('；')
  )
  return {
    mode: 'live',
    port,
    roomId: room.id,
    checks: delivery.checks.length,
    changedFiles: delivery.changedFiles,
    summary: delivery.summary
  }
}

/**
 * 跑一次演练。
 *
 * @param options.port - 给了就打真实实例；不给了用假宿主
 * @param options.keep - 保留临时目录
 */
export async function runDrill(options = {}) {
  return options.port === undefined ? mockDrill(options) : realDrill(options)
}

/** 命令行入口。 */
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const argv = process.argv.slice(2)
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--port') {
      index += 1
      options.port = Number(argv[index])
    } else if (arg === '--keep') {
      options.keep = true
    } else if (arg === '--workspace') {
      index += 1
      options.workspace = argv[index]
    }
  }
  runDrill(options)
    .then((result) => {
      console.log(`drill ok (${result.mode})`)
      console.log(`  房间：${result.roomId}`)
      console.log(`  验收：${result.checks} 条全过；${result.summary}`)
      console.log(`  变更文件：${result.changedFiles.join('、') || '（无）'}`)
    })
    .catch((error) => {
      console.error('drill 失败：' + (error instanceof Error ? error.message : String(error)))
      process.exitCode = 1
    })
}
