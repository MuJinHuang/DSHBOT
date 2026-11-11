/**
 * 用 CDP 点开「Bot 库」tab 再截图，验证独立库页面。
 *
 * 用法：node spike/shot-library.mjs <url> <out.png>
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9337
const [, , url, out] = process.argv
const profile = path.join(os.tmpdir(), 'edge-library-' + Date.now())
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1440,900',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    'about:blank'
  ],
  { stdio: 'ignore', windowsHide: true }
)

const cleanup = (code) => {
  try {
    child.kill()
  } catch {}
  setTimeout(() => {
    try {
      fs.rmSync(profile, { recursive: true, force: true })
    } catch {}
    process.exit(code)
  }, 300)
}

try {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (r.ok) break
    } catch {}
    await sleep(200)
  }
  const created = await fetch(
    `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' }
  )
  const target = await created.json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.addEventListener('open', res)
    ws.addEventListener('error', rej)
  })

  const pending = new Map()
  let seq = 0
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
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

  // 侧栏进房间页
  await evalJs(`(() => {
    const leaf=[...document.querySelectorAll('*')].find(e=>e.childElementCount===0 && (e.textContent||'').trim()==='\\u{1F3E0}')
    if(leaf) (leaf.closest('button')||leaf.parentElement).click()
  })()`)
  await sleep(2500)

  // 点「Bot 库」tab
  const clicked = await evalJs(`(() => {
    const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Bot 库')
    if(b){ b.click(); return true }
    return false
  })()`)
  console.log('clicked Bot 库 tab:', clicked)
  await sleep(1500)

  const shot = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'))
  console.log('saved', out)
  ws.close()
  cleanup(0)
} catch (error) {
  console.error('FAILED:', error.message)
  cleanup(1)
}
