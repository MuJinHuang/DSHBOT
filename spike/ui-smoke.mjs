/**
 * 真实 UI 冒烟：启动一个隔离的 DSH 实例，用无头 Edge 点一遍关键路径。
 *
 * 这不是 mock：DSH 进程、插件、页面、浏览器都是真的，只是数据目录是临时的、
 * 且不调用模型（只建房/搜索，不发消息）。
 *
 * 用法：
 *   pnpm smoke:ui
 *   pnpm smoke:ui -- --port 54880 --profile dshbot-dev
 *   pnpm smoke:ui -- --browser "C:\path\to\msedge.exe" --keep
 *
 * 前提：dsh 命令可用（或设 DSHBOT_DSH_CLI），profile 已装本插件。
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const has = (name) => args.includes(name)

const port = Number(option('--port', '54880'))
const profile = option('--profile', 'dshbot-dev')
const keep = has('--keep')
const cdpPort = Number(option('--cdp-port', '9343'))
const dataDir = mkdtempSync(join(tmpdir(), 'dshbot-ui-smoke-'))
const browserProfile = mkdtempSync(join(tmpdir(), 'dshbot-ui-browser-'))

function findBrowser() {
  const fromEnv = process.env.DSHBOT_BROWSER
  if (fromEnv !== undefined && existsSync(fromEnv)) return fromEnv
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ]
      : ['/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium']
  return candidates.find((path) => existsSync(path))
}

function stopTree(pid) {
  if (pid === undefined) return
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      process.kill(pid, 'SIGTERM')
    }
  } catch {
    /* 已经退出 */
  }
}

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch {
      /* 再等 */
    }
    await sleep(300)
  }
  throw new Error(`等待超时：${label}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/** 起 DSH，等它打印 token 和 /health。 */
async function startDsh() {
  const dsh = process.env.DSHBOT_DSH_CLI ?? 'dsh'
  const child = spawn(
    dsh,
    ['--profile', profile, '--port', String(port), '--no-open'],
    {
      env: { ...process.env, DSHBOT_DATA_DIR: dataDir },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  )
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })

  const token = await waitFor(
    () => output.match(/token=([A-Za-z0-9_-]+)/)?.[1],
    30_000,
    'DSH 启动并打印 token'
  )
  const health = await waitFor(
    () => fetch(`http://127.0.0.1:${port}/dshbot/api/health`).then((res) => res.ok),
    30_000,
    '插件 /health'
  )
  assert(health, '插件没有挂载；profile 里装了吗？')
  return { child, token, output: () => output }
}

/** 起无头浏览器与 CDP 会话。 */
async function startBrowser() {
  const browser = findBrowser()
  assert(browser !== undefined, '找不到 Edge/Chrome，可用 DSHBOT_BROWSER 指定')
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--window-size=1440,900',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${browserProfile}`,
      'about:blank'
    ],
    { stdio: 'ignore', windowsHide: true }
  )
  await waitFor(
    () => fetch(`http://127.0.0.1:${cdpPort}/json/version`).then((res) => res.ok),
    20_000,
    '浏览器 DevTools'
  )
  return child
}

async function connectCdp(url) {
  const created = await fetch(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' }
  )
  const target = await created.json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  const pending = new Map()
  let seq = 0
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    return result.result?.result?.value
  }
  return { ws, send, evaluate }
}

async function main() {
  console.log(`[smoke] data=${dataDir}`)
  const dsh = await startDsh()
  let browserPid
  let cdp
  try {
    browserPid = (await startBrowser()).pid
    const url = `http://127.0.0.1:${port}/?token=${dsh.token}`
    cdp = await connectCdp(url)
    const { send, evaluate } = cdp
    await send('Runtime.enable')
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false
    })
    const { writeFileSync } = await import('node:fs')
    const capture = async (name) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(`spike/smoke-${name}.png`, Buffer.from(shot.result.data, 'base64'))
    }
    await sleep(8000)

    // 首启可能弹“预览版说明”
    await evaluate(
      `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='继续'); if(b) b.click() })()`
    )
    // 侧栏 🏠
    await evaluate(
      `(() => { const leaf=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && (e.textContent||'').trim()==='\\u{1F3E0}'); if(leaf) (leaf.closest('button')||leaf.parentElement).click() })()`
    )
    await sleep(2500)

    const empty = await evaluate(`document.body.innerText.includes('创建示例房间')`)
    assert(empty === true, '空状态没有出现「创建示例房间」')
    await capture('1-empty')
    console.log('[smoke] 空状态 OK')

    const clicked = await evaluate(
      `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='创建示例房间'); if(!b) return 'not found'; b.click(); return 'clicked' })()`
    )
    assert(clicked === 'clicked', '点不到「创建示例房间」')
    await sleep(3000)
    const text = await evaluate(`document.body.innerText`)
    assert(text.includes('示例：电源模块交付'), '示例房间没有出现')
    assert(text.includes('阿岚') && text.includes('老周') && text.includes('小柯'), '示例成员不齐')
    await capture('2-room')
    console.log('[smoke] 示例房间 OK')

    // 搜索
    await evaluate(`(() => {
      const input=[...document.querySelectorAll('input')].find(i=>(i.placeholder||'').includes('搜索本房间消息'))
      if(!input) return
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set
      setter.call(input,'示例')
      input.dispatchEvent(new Event('input',{bubbles:true}))
      input.dispatchEvent(new Event('change',{bubbles:true}))
    })()`)
    await sleep(400)
    await evaluate(
      `(() => { const bs=[...document.querySelectorAll('button')].filter(x=>(x.textContent||'').trim()==='搜索'); const b=bs[bs.length-1]; if(b) b.click() })()`
    )
    await sleep(1500)
    const searched = await evaluate(`document.body.innerText.includes('搜索「示例」')`)
    assert(searched === true, '搜索没有返回结果面板')
    await capture('3-search')
    console.log('[smoke] 消息搜索 OK')

    // Bot 库
    await evaluate(
      `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Bot 库'); if(b) b.click() })()`
    )
    await sleep(1500)
    const library = await evaluate(`document.body.innerText.includes('Bot 库')`)
    assert(library === true, 'Bot 库页面没打开')
    // 模型下拉是新功能，冒烟里确认它真的渲染出来
    const hasModelSelect = await evaluate(
      `document.body.innerText.includes('模型：跟随 DSH 默认')`
    )
    if (hasModelSelect !== true) {
      await evaluate(
        `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='+ 新建 Bot'); if(b) b.click() })()`
      )
      await sleep(800)
    }
    const modelReady = await evaluate(
      `document.body.innerText.includes('模型：跟随 DSH 默认')`
    )
    assert(modelReady === true, 'Bot 表单没有渲染模型下拉')
    await capture('4-library')
    console.log('[smoke] Bot 库 + 模型下拉 OK')

    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 264, y: 0, width: 1180, height: 900, scale: 1 }
    })
    writeFileSync('spike/ui-smoke.png', Buffer.from(shot.result.data, 'base64'))
    console.log('[smoke] 通过，截图 spike/ui-smoke.png + spike/smoke-1..4.png')
  } catch (error) {
    const body = cdp === undefined ? '' : await cdp.evaluate('document.body.innerText.slice(0, 1200)')
    console.error('[smoke] 失败：' + (error instanceof Error ? error.message : String(error)))
    if (body) console.error('[smoke] 页面文字：\n' + body)
    console.error('[smoke] DSH 输出：\n' + dsh.output().slice(-2000))
    process.exitCode = 1
  } finally {
    cdp?.ws.close()
    stopTree(browserPid)
    stopTree(dsh.child.pid)
    if (!keep) {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(browserProfile, { recursive: true, force: true })
    }
  }
}

main().catch((error) => {
  console.error('[smoke] 启动失败：' + (error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
})
