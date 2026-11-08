/**
 * S0-1 取证脚本：用 CDP 驱动无头 Edge，打开 hello 页面，
 * 收集控制台消息并截图。只用 Node 内置能力（fetch / WebSocket）。
 *
 * 用法：node cdp-shot.js <url> <out.png>
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const url = process.argv[2]
const out = process.argv[3]
if (!url || !out) {
  console.error('usage: node cdp-shot.js <url> <out.png>')
  process.exit(2)
}

const profile = path.join(os.tmpdir(), 'edge-cdp-' + Date.now())
const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    'about:blank'
  ],
  { stdio: 'ignore', windowsHide: true }
)

function cleanup(code) {
  try { child.kill() } catch {}
  setTimeout(() => {
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
    process.exit(code)
  }, 300)
}

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return await r.json()
    } catch {}
    await sleep(200)
  }
  throw new Error('devtools endpoint never came up')
}

async function main() {
  const version = await waitForDevtools()
  console.log('browser:', version.Browser)

  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  const target = await created.json()
  console.log('target:', target.id)

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  const pending = new Map()
  const logs = []
  let seq = 0

  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
      return
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? a.type)
        .join(' ')
      logs.push(`[${msg.params.type}] ${text}`)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails
      logs.push(`[exception] ${d.text} ${d.exception?.description || ''}`)
    }
  })

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 20000)
    })

  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(9000) // 等 SPA 起来、插件加载、自动切页

  // 首启会有「预览版说明」弹窗，先关掉，否则截到的是它
  const dismissed = await send('Runtime.evaluate', {
    expression: `(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '继续')
      if (b) { b.click(); return 'clicked 继续' }
      return 'no modal'
    })()`,
    returnByValue: true
  })
  console.log('modal:', dismissed.result?.result?.value)
  await sleep(2500)

  const probe = await send('Runtime.evaluate', {
    expression: `(() => {
      const t = document.body.innerText || ''
      return JSON.stringify({
        hasHelloTitle: t.includes('DSHBot · hello'),
        hasSidebarEntry: t.includes('Hello'),
        href: location.href,
        head: t.slice(0, 160)
      })
    })()`,
    returnByValue: true
  })
  console.log('probe1:', probe.result?.result?.value)

  // 自动切页可能被 SPA 的 URL 规范化抹掉，退而求其次：直接点侧栏里那个图标
  const icon = process.argv[4] || '\\u{1F6D6}'
  const clicked = await send('Runtime.evaluate', {
    expression: `(() => {
      const leaf = [...document.querySelectorAll('*')].find(
        (e) => e.childElementCount === 0 && (e.textContent || '').trim() === '${icon}'
      )
      if (!leaf) return 'icon not found'
      const btn = leaf.closest('button') || leaf.parentElement
      if (!btn) return 'no button'
      btn.click()
      return 'clicked ' + btn.tagName
    })()`,
    returnByValue: true
  })
  console.log('click:', clicked.result?.result?.value)
  await sleep(2000)

  const probe2 = await send('Runtime.evaluate', {
    expression: `(() => {
      const t = document.body.innerText || ''
      return JSON.stringify({
        hasHelloTitle: t.includes('DSHBot · hello'),
        head: t.slice(0, 200)
      })
    })()`,
    returnByValue: true
  })
  console.log('probe2:', probe2.result?.result?.value)

  // 点两次按钮，验证拿到的是宿主那份 React（hooks 能跑）
  for (let i = 0; i < 2; i++) {
    await send('Runtime.evaluate', {
      expression: `(() => {
        const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('点我验证'))
        if (b) { b.click(); return 'clicked' }
        return 'button not found'
      })()`,
      returnByValue: true
    })
    await sleep(400)
  }
  const probe3 = await send('Runtime.evaluate', {
    expression: `(() => {
      const t = document.body.innerText || ''
      const m = t.match(/React 正常，点了 \\d+ 次/)
      return JSON.stringify({ counterText: m ? m[0] : null })
    })()`,
    returnByValue: true
  })
  console.log('probe3:', probe3.result?.result?.value)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))

  console.log('\n--- console (%d) ---', logs.length)
  for (const l of logs.slice(0, 40)) console.log(l)

  ws.close()
  cleanup(0)
}

main().catch((e) => {
  console.error('FAILED:', e.message)
  cleanup(1)
})
