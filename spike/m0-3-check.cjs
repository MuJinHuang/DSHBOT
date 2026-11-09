/**
 * M0-3 端到端取证：在房间页里发一条消息，等 Bot 回话，截图。
 *
 * 用法：node m0-3-check.cjs <url> <out.png> [房间名]
 */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9334
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const url = process.argv[2]
const out = process.argv[3]
const roomName = process.argv[4] || '改个错别字'
const profile = path.join(os.tmpdir(), 'edge-m03-' + Date.now())

const child = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--window-size=1440,900', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'
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
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push((msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(' '))
    }
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

  console.log('open panel:', await evalJs(`(() => {
    const leaf = [...document.querySelectorAll('*')].find(
      (e) => e.childElementCount === 0 && (e.textContent || '').trim() === '\\u{1F3E0}')
    if (!leaf) return 'icon not found'
    ;(leaf.closest('button') || leaf.parentElement).click()
    return 'ok'
  })()`))
  await sleep(2500)

  console.log('select room:', await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes(${JSON.stringify(roomName)}))
    if (!b) return 'room not found'
    b.click(); return 'ok'
  })()`))
  await sleep(1500)

  console.log('type:', await evalJs(`(() => {
    const input = [...document.querySelectorAll('input')].find((x) => (x.placeholder || '').includes('说点什么'))
    if (!input) return 'composer not found'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '用一句话说明你是谁，不要调用工具')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`))
  await sleep(500)

  console.log('send:', await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '发送')
    if (!b) return 'send button not found'
    if (b.disabled) return 'disabled'
    b.click(); return 'clicked'
  })()`))

  // 等 Bot 回话
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    const done = await evalJs(`(() => {
      const t = document.body.innerText || ''
      return t.includes('Bot 正在处理') ? 'busy' : 'idle'
    })()`)
    if (done === 'idle' && i > 1) break
  }
  await sleep(800)

  console.log('page:', await evalJs(`(document.body.innerText || '').replace(/\\n+/g, ' | ').slice(0, 600)`))

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log('\nconsole:', logs.length ? logs.join(' ;; ') : '(none)')

  ws.close()
  cleanup(0)
}

main().catch((e) => { console.error('FAILED:', e.message); cleanup(1) })
