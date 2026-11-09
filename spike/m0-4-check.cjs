/**
 * M0-4 取证：发一条会触发工具的指令，展开工具行，截图。
 *
 * 用法：node m0-4-check.cjs <url> <out.png> <房间名> <提示词>
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9335
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const url = process.argv[2]
const out = process.argv[3]
const roomName = process.argv[4] || '看看项目'
const prompt = process.argv[5] || '列出项目根目录的前 3 个条目，必须用工具查'
const profile = path.join(os.tmpdir(), 'edge-m04-' + Date.now())

const child = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--window-size=1440,900',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
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

async function waitDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) return r.json()
    } catch {}
    await sleep(200)
  }
  throw new Error('devtools never came up')
}

async function main() {
  await waitDevtools()
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  const target = await created.json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

  const pending = new Map()
  let seq = 0
  const logs = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return }
    if (msg.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + msg.params.exceptionDetails.text)
  })

  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++seq
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)) } }, 25000)
    })

  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(8000)

  await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '继续')
    if (b) b.click()
  })()`)

  console.log('panel:', await evalJs(`(() => {
    const leaf = [...document.querySelectorAll('*')].find(
      (e) => e.childElementCount === 0 && (e.textContent || '').trim() === '\\u{1F3E0}')
    if (!leaf) return 'icon not found'
    ;(leaf.closest('button') || leaf.parentElement).click()
    return 'ok'
  })()`))
  await sleep(2500)

  console.log('room:', await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(${JSON.stringify(roomName)}))
    if (!b) return 'not found'
    b.click(); return 'ok'
  })()`))
  await sleep(1200)

  console.log('type:', await evalJs(`(() => {
    const input = [...document.querySelectorAll('input')].find((x) => (x.placeholder || '').includes('说点什么'))
    if (!input) return 'composer not found'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(prompt)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`))
  await sleep(400)

  console.log('send:', await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '发送')
    if (!b) return 'not found'
    if (b.disabled) return 'disabled'
    b.click(); return 'clicked'
  })()`))

  for (let i = 0; i < 60; i++) {
    await sleep(1000)
    const state = await evalJs(`(() => (document.body.innerText || '').includes('Bot 正在处理') ? 'busy' : 'idle')()`)
    if (state === 'idle' && i > 2) break
  }
  await sleep(600)

  // 展开第一个工具行
  console.log('expand:', await evalJs(`(() => {
    const rows = [...document.querySelectorAll('button')].filter((x) => (x.textContent || '').includes('▸'))
    if (rows.length === 0) return 'no tool row'
    rows[0].click()
    return 'expanded ' + rows.length
  })()`))
  await sleep(600)

  console.log('tool rows:', await evalJs(`(() => {
    const rows = [...document.querySelectorAll('button')].filter((x) => /[▸▾]/.test(x.textContent || ''))
    return rows.length + ' | ' + rows.map((r) => (r.textContent || '').slice(0, 60)).join(' ;; ')
  })()`))

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log('console:', logs.length ? logs.join(' ;; ') : '(none)')

  ws.close()
  cleanup(0)
}

main().catch((e) => { console.error('FAILED:', e.message); cleanup(1) })
