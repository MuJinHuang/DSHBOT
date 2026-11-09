/** 只截图，不发消息。用法：node shot-only.cjs <url> <out.png> [房间名] */
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9336
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const url = process.argv[2]
const out = process.argv[3]
const roomName = process.argv[4]
const profile = path.join(os.tmpdir(), 'edge-shotonly-' + Date.now())

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

async function main() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) break
    } catch {}
    await sleep(200)
  }
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  const target = await created.json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })

  const pending = new Map()
  let seq = 0
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq
      pending.set(id, res)
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true })
    return r.result?.result?.value
  }

  await send('Runtime.enable')
  await send('Page.enable')
  await sleep(8000)

  await evalJs(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='继续'); if(b) b.click() })()`)
  await evalJs(`(() => {
    const leaf=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && (e.textContent||'').trim()==='\\u{1F3E0}')
    if(leaf) (leaf.closest('button')||leaf.parentElement).click()
  })()`)
  await sleep(2500)

  if (roomName) {
    await evalJs(`(() => {
      const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes(${JSON.stringify(roomName)}))
      if(b) b.click()
    })()`)
    await sleep(1500)
  }

  await evalJs(`(() => {
    const sc = [...document.querySelectorAll('div')].filter(
      (d) => d.scrollHeight > d.clientHeight + 80 && getComputedStyle(d).overflowY !== 'visible'
    )
    for (const d of sc) d.scrollTop = d.scrollHeight
    return sc.length
  })()`)
  await sleep(500)
  await sleep(500)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log('saved', out)
  ws.close()
  cleanup(0)
}

main().catch((e) => { console.error('FAILED:', e.message); cleanup(1) })
